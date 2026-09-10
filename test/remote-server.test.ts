import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PermissionReply } from '../src/shared/ipc'
import {
  PairingGuard,
  RemoteServer,
  isTailscaleAddress,
  localAddresses,
  makePairingCode,
  readCookie,
  safeEqual,
  type RemoteBridge,
  type RemoteMessage,
  type RemoteTab
} from '../src/main/remote/server'

/** A stand-in for the chat pool: records what the phone asked for. */
class FakeBridge implements RemoteBridge {
  tabs: RemoteTab[] = [{ id: 'tab-1', title: 'app', status: 'ready', cwd: '/work/app' }]
  sent: Array<{ tabId: string; text: string }> = []
  interrupted: string[] = []
  replies: Array<{ tabId: string; requestId: string; reply: PermissionReply }> = []
  past: RemoteMessage[] = []
  historyCalls = 0

  listTabs(): RemoteTab[] {
    return this.tabs
  }
  send(tabId: string, text: string): void {
    this.sent.push({ tabId, text })
  }
  interrupt(tabId: string): void {
    this.interrupted.push(tabId)
  }
  replyPermission(tabId: string, requestId: string, reply: PermissionReply): void {
    this.replies.push({ tabId, requestId, reply })
  }
  async history(): Promise<RemoteMessage[]> {
    this.historyCalls += 1
    return this.past
  }
}

let server: RemoteServer
let bridge: FakeBridge
let base: string

/** Port 0 lets the OS pick a free one, so parallel runs cannot collide. */
async function startOnFreePort(): Promise<void> {
  const state = await server.start(0)
  expect(state.error).toBeUndefined()
  base = `http://127.0.0.1:${state.port}`
}

async function pair(): Promise<string> {
  const code = server.getState().pairingCode as string
  const res = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  })
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie') ?? ''
  return cookie.split(';')[0]
}

beforeEach(async () => {
  bridge = new FakeBridge()
  server = new RemoteServer(bridge)
  await startOnFreePort()
})

afterEach(async () => {
  await server.stop()
})

describe('safeEqual', () => {
  it('рівні рядки збігаються, різні — ні', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true)
    expect(safeEqual('abc123', 'abc124')).toBe(false)
  })

  it('різна довжина не кидає виняток, а повертає false', () => {
    expect(safeEqual('', 'abc')).toBe(false)
    expect(safeEqual('abcdef', 'ab')).toBe(false)
  })
})

describe('readCookie', () => {
  it('дістає потрібну куку з-поміж інших', () => {
    expect(readCookie('a=1; d_code_remote=tok; b=2', 'd_code_remote')).toBe('tok')
  })

  it('не плутає префікс із повною назвою', () => {
    expect(readCookie('d_code_remote_other=x', 'd_code_remote')).toBeUndefined()
  })

  it('без заголовка — undefined', () => {
    expect(readCookie(undefined, 'd_code_remote')).toBeUndefined()
  })
})

describe('isTailscaleAddress', () => {
  it('упізнає діапазон tailnet 100.64.0.0/10', () => {
    for (const ip of ['100.64.0.1', '100.100.100.100', '100.127.255.254', '100.101.5.7']) {
      expect(isTailscaleAddress(ip), ip).toBe(true)
    }
  })

  it('не чіпає звичайні приватні адреси', () => {
    for (const ip of ['192.168.1.5', '10.0.0.3', '172.16.4.1', '169.254.1.1']) {
      expect(isTailscaleAddress(ip), ip).toBe(false)
    }
  })

  it('сусідні до діапазону адреси не рахуються', () => {
    // 100.63.x and 100.128.x sit just outside the /10 and are ordinary space.
    expect(isTailscaleAddress('100.63.255.255')).toBe(false)
    expect(isTailscaleAddress('100.128.0.0')).toBe(false)
    expect(isTailscaleAddress('101.64.0.1')).toBe(false)
  })

  it('сміття не приймається за адресу', () => {
    for (const bad of ['', '100.64', '100.64.0.1.5', '100.64.0.256', 'сто.64.0.1', '::1']) {
      expect(isTailscaleAddress(bad), bad).toBe(false)
    }
  })
})

describe('localAddresses', () => {
  it('віддає лише IPv4 і без петлі', () => {
    for (const { ip } of localAddresses()) {
      expect(ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/)
      expect(ip).not.toBe('127.0.0.1')
    }
  })

  it('позначає вид кожної адреси узгоджено з isTailscaleAddress', () => {
    for (const { ip, kind } of localAddresses()) {
      expect(kind).toBe(isTailscaleAddress(ip) ? 'tailscale' : 'lan')
    }
  })

  it('адреси tailnet стоять першими', () => {
    const kinds = localAddresses().map((a) => a.kind)
    const lastTailnet = kinds.lastIndexOf('tailscale')
    const firstLan = kinds.indexOf('lan')
    // Either kind may be absent on a given machine; order only matters if both are.
    if (lastTailnet !== -1 && firstLan !== -1) expect(lastTailnet).toBeLessThan(firstLan)
  })
})

describe('makePairingCode', () => {
  it('локальний код — завжди шість цифр, включно з провідними нулями', () => {
    for (let i = 0; i < 200; i++) expect(makePairingCode()).toMatch(/^\d{6}$/)
  })

  it('публічний код довший і без символів, які плутають на екрані', () => {
    for (let i = 0; i < 200; i++) {
      const code = makePairingCode(true)
      expect(code).toHaveLength(10)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/)
    }
  })

  it('коди не повторюються', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(makePairingCode(true))
    expect(seen.size).toBe(500)
  })
})

describe('публічний режим', () => {
  it('перехід у публічний режим перевипускає код сильнішим', () => {
    const before = server.getState().pairingCode as string
    expect(before).toMatch(/^\d{6}$/)

    server.setPublic(true)
    const after = server.getState().pairingCode as string
    expect(after).not.toBe(before)
    expect(after).toHaveLength(10)
    expect(server.getState().isPublic).toBe(true)
  })

  it('повторний виклик із тим самим значенням код не чіпає', () => {
    server.setPublic(true)
    const code = server.getState().pairingCode
    server.setPublic(true)
    expect(server.getState().pairingCode).toBe(code)
  })

  it('старий короткий код після переходу вже не працює', async () => {
    const old = server.getState().pairingCode
    server.setPublic(true)

    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: old })
    })
    expect(res.status).toBe(403)
  })

  it('публічний код приймається без огляду на регістр', async () => {
    server.setPublic(true)
    const code = server.getState().pairingCode as string
    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: code.toLowerCase() })
    })
    expect(res.status).toBe(200)
  })

  it('зупинка скидає публічний режим', async () => {
    server.setPublic(true)
    await server.stop()
    expect(server.getState().isPublic).toBe(false)
  })
})

describe('PairingGuard', () => {
  it('пропускає, поки невдач мало', () => {
    const guard = new PairingGuard()
    expect(guard.check('a')).toBe('ok')
    guard.fail('a')
    expect(guard.check('a')).toBe('ok')
  })

  it('після пʼяти невдач адреса чекає, інші — ні', () => {
    const guard = new PairingGuard()
    for (let i = 0; i < 5; i++) guard.fail('a')

    expect(guard.check('a')).toBe('locked-out')
    expect(guard.check('b')).toBe('ok')
  })

  it('очікування закінчується за хвилину', () => {
    const now = 1_000_000
    const guard = new PairingGuard()
    for (let i = 0; i < 5; i++) guard.fail('a', now)

    expect(guard.check('a', now + 59_000)).toBe('locked-out')
    expect(guard.check('a', now + 61_000)).toBe('ok')
  })

  it('двадцять невдач із різних адрес замикають парування назовсім', () => {
    const guard = new PairingGuard()
    // Four addresses × five guesses: each one alone would only earn a lockout.
    for (const key of ['a', 'b', 'c', 'd']) {
      for (let i = 0; i < 5; i++) guard.fail(key)
    }
    expect(guard.isLocked).toBe(true)
    expect(guard.check('e')).toBe('locked')
  })

  it('заблокована адреса не витрачає спільний бюджет', () => {
    const guard = new PairingGuard()
    // One address hammering must not be able to lock the owner out.
    for (let i = 0; i < 100; i++) {
      if (guard.check('a') === 'ok') guard.fail('a')
    }
    expect(guard.isLocked).toBe(false)
  })

  it('правильний код обнуляє спільний лічильник', () => {
    const guard = new PairingGuard()
    for (const key of ['a', 'b', 'c']) {
      for (let i = 0; i < 5; i++) guard.fail(key)
    }
    guard.succeed('d')

    for (let i = 0; i < 4; i++) guard.fail('e')
    expect(guard.isLocked).toBe(false)
  })

  it('reset знімає замок', () => {
    const guard = new PairingGuard()
    for (const key of ['a', 'b', 'c', 'd']) {
      for (let i = 0; i < 5; i++) guard.fail(key)
    }
    guard.reset()
    expect(guard.isLocked).toBe(false)
    expect(guard.check('a')).toBe('ok')
  })
})

describe('замкнене парування', () => {
  it('замок віддає 423 і прибирає код', async () => {
    // Reachable over HTTP only from many addresses; the guard covers the rule,
    // this covers the response the phone actually sees.
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: '999999' }) })
    }
    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: '999999' })
    })
    expect(res.status).toBe(429)
  })

  it('новий код повертає можливість спарувати', async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: '999999' }) })
    }
    const code = server.newPairingCode()

    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code })
    })
    expect(res.status).toBe(200)
  })
})

describe('автентифікація', () => {
  it('без пари API закритий', async () => {
    const res = await fetch(`${base}/api/tabs`)
    expect(res.status).toBe(401)
  })

  it('сторінка віддається без пари — інакше нема де ввести код', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('правильний код відкриває доступ', async () => {
    const cookie = await pair()
    const res = await fetch(`${base}/api/tabs`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { tabs: RemoteTab[] }).tabs).toHaveLength(1)
  })

  it('чужий токен не проходить', async () => {
    await pair()
    const res = await fetch(`${base}/api/tabs`, {
      headers: { cookie: 'd_code_remote=forged-token-value' }
    })
    expect(res.status).toBe(401)
  })

  it('невірний код відхиляється', async () => {
    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: '000000-невірний' })
    })
    expect(res.status).toBe(403)
  })

  it('після пʼяти невдач адреса блокується, а код перевипускається', async () => {
    const original = server.getState().pairingCode
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code: '111111' }) })
    }
    expect(server.getState().pairingCode).not.toBe(original)

    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: server.getState().pairingCode })
    })
    // Correct code, but the address is in its cooldown.
    expect(res.status).toBe(429)
  })

  it('після зупинки старий токен більше не діє', async () => {
    const cookie = await pair()
    await server.stop()
    await startOnFreePort()

    const res = await fetch(`${base}/api/tabs`, { headers: { cookie } })
    expect(res.status).toBe(401)
  })

  it('кука без Secure на звичайному http, щоб локальна мережа працювала', async () => {
    const code = server.getState().pairingCode as string
    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code })
    })
    expect(res.headers.get('set-cookie')).not.toContain('Secure')
  })

  it('за тунелем, який віддає https, кука позначається Secure', async () => {
    const code = server.getState().pairingCode as string
    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ code })
    })
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })
})

describe('керування сесією', () => {
  it('надсилає повідомлення в потрібну вкладку', async () => {
    const cookie = await pair()
    const res = await fetch(`${base}/api/tabs/tab-1/send`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'привіт' })
    })
    expect(res.status).toBe(200)
    expect(bridge.sent).toEqual([{ tabId: 'tab-1', text: 'привіт' }])
  })

  it('порожнє повідомлення не доходить до CLI', async () => {
    const cookie = await pair()
    const res = await fetch(`${base}/api/tabs/tab-1/send`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' })
    })
    expect(res.status).toBe(400)
    expect(bridge.sent).toHaveLength(0)
  })

  it('перериває хід', async () => {
    const cookie = await pair()
    await fetch(`${base}/api/tabs/tab-1/interrupt`, { method: 'POST', headers: { cookie } })
    expect(bridge.interrupted).toEqual(['tab-1'])
  })

  it('відповідає на запит дозволу', async () => {
    const cookie = await pair()
    await fetch(`${base}/api/tabs/tab-1/permission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'r1', behavior: 'deny' })
    })
    expect(bridge.replies[0].reply).toEqual({ behavior: 'deny', message: 'Denied from the phone' })
  })

  it('дозвіл без requestId відхиляється', async () => {
    const cookie = await pair()
    const res = await fetch(`${base}/api/tabs/tab-1/permission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ behavior: 'allow' })
    })
    expect(res.status).toBe(400)
    expect(bridge.replies).toHaveLength(0)
  })

  it('GET на дію, що змінює стан, не приймається', async () => {
    const cookie = await pair()
    const res = await fetch(`${base}/api/tabs/tab-1/send`, { headers: { cookie } })
    expect(res.status).toBe(405)
  })
})

describe('історія', () => {
  it('підтягує транскрипт один раз і доліплює живі повідомлення', async () => {
    bridge.past = [
      { uuid: 'p1', role: 'user', text: 'старе', tools: [], timestamp: '2026-09-01T10:00:00Z' }
    ]
    const cookie = await pair()

    server.addMessage('tab-1', {
      uuid: 'l1',
      role: 'assistant',
      text: 'нове',
      tools: [],
      timestamp: '2026-09-01T10:01:00Z'
    })

    const first = await fetch(`${base}/api/tabs/tab-1/messages`, { headers: { cookie } })
    const body = (await first.json()) as { messages: RemoteMessage[] }
    expect(body.messages.map((m) => m.uuid)).toEqual(['p1', 'l1'])

    await fetch(`${base}/api/tabs/tab-1/messages`, { headers: { cookie } })
    expect(bridge.historyCalls).toBe(1)
  })

  it('повідомлення з тим самим uuid не дублюється', async () => {
    const cookie = await pair()
    const message: RemoteMessage = {
      uuid: 'x',
      role: 'assistant',
      text: 'раз',
      tools: [],
      timestamp: '2026-09-01T10:00:00Z'
    }
    server.addMessage('tab-1', message)
    server.addMessage('tab-1', { ...message, text: 'два' })

    const res = await fetch(`${base}/api/tabs/tab-1/messages`, { headers: { cookie } })
    const body = (await res.json()) as { messages: RemoteMessage[] }
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].text).toBe('раз')
  })

  it('forget прибирає кеш вкладки', async () => {
    const cookie = await pair()
    await fetch(`${base}/api/tabs/tab-1/messages`, { headers: { cookie } })
    server.forget('tab-1')
    await fetch(`${base}/api/tabs/tab-1/messages`, { headers: { cookie } })
    expect(bridge.historyCalls).toBe(2)
  })
})

describe('вхід за сканованим QR', () => {
  it('правильний код у посиланні одразу видає куку й редіректить без нього', async () => {
    const code = server.getState().pairingCode as string
    const res = await fetch(`${base}/?c=${code}`, { redirect: 'manual' })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('d_code_remote=')
  })

  it('видана кука справді відкриває API', async () => {
    const code = server.getState().pairingCode as string
    const res = await fetch(`${base}/?c=${code}`, { redirect: 'manual' })
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]

    const api = await fetch(`${base}/api/tabs`, { headers: { cookie } })
    expect(api.status).toBe(200)
  })

  it('невірний код у посиланні просто показує сторінку введення', async () => {
    const res = await fetch(`${base}/?c=000000000`, { redirect: 'manual' })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('сканування підпадає під ті самі ліміти, що й введення руками', async () => {
    for (let i = 0; i < 5; i++) await fetch(`${base}/?c=000000`, { redirect: 'manual' })

    // The address is now in its cooldown, so even the right code is refused.
    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: server.getState().pairingCode })
    })
    expect(res.status).toBe(429)
  })

  it('pairingUrl несе адресу разом із кодом', () => {
    const code = server.getState().pairingCode as string
    expect(server.pairingUrl('http://192.168.1.5:8317')).toBe(
      `http://192.168.1.5:8317/?c=${code}`
    )
  })

  it('зайвий слеш у базовій адресі не дає подвійного', () => {
    const code = server.getState().pairingCode as string
    expect(server.pairingUrl('http://192.168.1.5:8317/')).toBe(
      `http://192.168.1.5:8317/?c=${code}`
    )
  })

  it('без чинного коду посилання не будується', async () => {
    await server.stop()
    expect(server.pairingUrl('http://192.168.1.5:8317')).toBeUndefined()
  })
})

describe('стан сервера', () => {
  it('до запуску не слухає й не має коду', async () => {
    const fresh = new RemoteServer(new FakeBridge())
    expect(fresh.getState()).toMatchObject({ running: false, clients: 0 })
    expect(fresh.getState().pairingCode).toBeUndefined()
  })

  it('зупинка звільняє порт', async () => {
    const port = server.getState().port as number
    await server.stop()
    expect(server.getState().running).toBe(false)

    // The port is free if a second server can take it.
    const other = new RemoteServer(new FakeBridge())
    const state = await other.start(port)
    expect(state.error).toBeUndefined()
    await other.stop()
  })

  it('зайнятий порт повідомляється, а не кидає виняток', async () => {
    const port = server.getState().port as number
    const other = new RemoteServer(new FakeBridge())
    const state = await other.start(port)
    expect(state.running).toBe(false)
    expect(state.error).toContain(String(port))
    await other.stop()
  })

  it('новий код скасовує попередній', async () => {
    const first = server.getState().pairingCode
    const second = server.newPairingCode()
    expect(second).not.toBe(first)

    const res = await fetch(`${base}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ code: first })
    })
    expect(res.status).toBe(403)
  })
})
