import { describe, it, expect } from 'vitest'
import { tunnelCommand, type ResolvedTunnel } from '../src/main/remote/tunnel'

/** Narrows the result, failing the test if the provider refused to resolve. */
function resolved(value: ResolvedTunnel | string): ResolvedTunnel {
  expect(typeof value, typeof value === 'string' ? value : '').not.toBe('string')
  return value as ResolvedTunnel
}

describe('cloudflare', () => {
  it('вказує локальний порт і не оновлюється посеред сесії', () => {
    const { command, args } = resolved(tunnelCommand('cloudflare', 8317))
    expect(command).toBe('cloudflared')
    expect(args).toEqual(['tunnel', '--url', 'http://127.0.0.1:8317', '--no-autoupdate'])
  })

  it('чекає адресу лише на домені швидких тунелів', () => {
    const { pattern } = resolved(tunnelCommand('cloudflare', 8317))
    expect(pattern.test('https://weird-words-here.trycloudflare.com')).toBe(true)
    // A phishing link in the output must not be mistaken for our address.
    expect(pattern.test('https://example.com')).toBe(false)
  })
})

describe('pinggy', () => {
  it('йде через ssh на 443, бо 22 часто ріжуть', () => {
    const { command, args } = resolved(tunnelCommand('pinggy', 8317))
    expect(command).toBe('ssh')
    expect(args.slice(0, 2)).toEqual(['-p', '443'])
    expect(args).toContain('a.pinggy.io')
  })

  it('прокидає саме той порт, який просили', () => {
    const { args } = resolved(tunnelCommand('pinggy', 9000))
    expect(args).toContain('-R0:localhost:9000')
  })

  it('порожній пароль подається через SSH_ASKPASS, бо tty немає', () => {
    const { env } = resolved(tunnelCommand('pinggy', 8317))
    expect(env).toEqual({ SSH_ASKPASS: '/usr/bin/true', SSH_ASKPASS_REQUIRE: 'force' })
  })

  it('ключ хоста запамʼятовується, а не приймається будь-який', () => {
    const { args } = resolved(tunnelCommand('pinggy', 8317))
    // `no` would accept a swapped key silently; `accept-new` still complains.
    expect(args).toContain('StrictHostKeyChecking=accept-new')
    expect(args).not.toContain('StrictHostKeyChecking=no')
  })

  it('падає, якщо прокидання порту не вдалося', () => {
    // Without this ssh happily holds a connection that forwards nothing.
    expect(resolved(tunnelCommand('pinggy', 8317)).args).toContain('ExitOnForwardFailure=yes')
  })

  it('упізнає обидва домени, які видає сервіс', () => {
    const { pattern } = resolved(tunnelCommand('pinggy', 8317))
    expect(pattern.test('https://satbu-176-110-103-252.free.pinggy.net')).toBe(true)
    expect(pattern.test('https://zoxzf-176-110-103-252.run.pinggy-free.link')).toBe(true)
    expect(pattern.test('https://dashboard.pinggy.io')).toBe(false)
  })
})

describe('своя команда', () => {
  it('підставляє порт замість {port}', () => {
    const { command, args } = resolved(
      tunnelCommand('custom', 8317, 'ssh -R 80:localhost:{port} example.com')
    )
    expect(command).toBe('ssh')
    expect(args).toEqual(['-R', '80:localhost:8317', 'example.com'])
  })

  it('підставляє порт скрізь, де він згаданий', () => {
    const { args } = resolved(tunnelCommand('custom', 42, 'x --a {port} --b {port}'))
    expect(args).toEqual(['--a', '42', '--b', '42'])
  })

  it('зберігає лапки навколо аргументів із пробілами', () => {
    const { args } = resolved(tunnelCommand('custom', 1, 'run "/My Tools/t.sh" --flag'))
    expect(args).toEqual(['/My Tools/t.sh', '--flag'])
  })

  it('порожня команда — зрозуміла відмова, а не запуск нічого', () => {
    expect(tunnelCommand('custom', 8317)).toBe('No command set for the custom provider')
    expect(tunnelCommand('custom', 8317, '   ')).toBe('No command set for the custom provider')
  })

  it('приймає будь-яку https-адресу, бо вивід наперед невідомий', () => {
    const { pattern } = resolved(tunnelCommand('custom', 1, 'run'))
    expect(pattern.test('forwarding https://abc.example.org now')).toBe(true)
    expect(pattern.test('listening on http://abc.example.org')).toBe(false)
  })
})

describe('невідомий провайдер', () => {
  it('не запускає нічого', () => {
    const result = tunnelCommand('nope' as never, 8317)
    expect(result).toContain('Unknown tunnel provider')
  })
})
