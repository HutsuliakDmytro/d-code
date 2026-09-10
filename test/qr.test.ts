import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import {
  chooseVersion,
  encodeQr,
  formatBits,
  qrSvg,
  qrTargets,
  reedSolomon,
  versionBits
} from '../src/main/remote/qr'

/**
 * The reference implementation is a dev dependency only — it exists to prove
 * our encoder produces the same symbol, not to ship. A QR code that almost
 * works is a QR code nobody can scan, and there is no camera in a test run.
 */
async function reference(text: string): Promise<boolean[][]> {
  // Byte mode is forced: the library otherwise splits the input into mixed
  // numeric/alphanumeric segments to save a few modules, which our encoder
  // deliberately does not do. Comparing the two would be comparing formats.
  const segment = { data: text, mode: 'byte' } as unknown as QRCode.QRCodeSegment
  const qr = QRCode.create([segment], { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const data = qr.modules.data
  const rows: boolean[][] = []
  for (let row = 0; row < size; row++) {
    rows.push(Array.from({ length: size }, (_, col) => Boolean(data[row * size + col])))
  }
  return rows
}

describe('поле Галуа і Ріда-Соломона', () => {
  it('дає контрольні байти з прикладу стандарту', () => {
    // The worked example from the specification: "HELLO WORLD" в 1-M.
    const data = Uint8Array.from([
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17
    ])
    expect(Array.from(reedSolomon(data, 10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23
    ])
  })

  it('довжина залишку дорівнює замовленій', () => {
    for (const length of [10, 16, 18, 22, 24, 26]) {
      expect(reedSolomon(Uint8Array.from([1, 2, 3]), length)).toHaveLength(length)
    }
  })
})

describe('службові біти', () => {
  it('формат для рівня M збігається з таблицею стандарту', () => {
    // The specification lists all eight; a wrong one makes the symbol unreadable.
    const expected = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]
    for (let mask = 0; mask < 8; mask++) expect(formatBits(mask)).toBe(expected[mask])
  })

  it('версії 7–10 збігаються з таблицею стандарту', () => {
    expect(versionBits(7)).toBe(0b000111110010010100)
    expect(versionBits(8)).toBe(0b001000010110111100)
    expect(versionBits(9)).toBe(0b001001101010011001)
    expect(versionBits(10)).toBe(0b001010010011010011)
  })
})

describe('вибір версії', () => {
  it('короткий рядок вміщується у першу версію', () => {
    expect(chooseVersion(10)).toBe(1)
  })

  it('версія росте разом із даними', () => {
    expect(chooseVersion(14)).toBe(1)
    expect(chooseVersion(15)).toBe(2)
    expect(chooseVersion(200)).toBeGreaterThanOrEqual(9)
  })

  it('надто довгі дані — помилка, а не мовчазне обрізання', () => {
    expect(() => chooseVersion(400)).toThrow()
  })
})

describe('символ збігається з еталонною реалізацією', () => {
  const cases = [
    'HELLO WORLD',
    'http://192.168.1.100:8317/?c=123456',
    'https://random-words-here.trycloudflare.com/?c=ABCDEFGHJK',
    'https://d-code.example/?c=' + 'A'.repeat(60),
    'привіт, світ',
    'x'
  ]

  for (const text of cases) {
    it(`«${text.slice(0, 40)}»`, async () => {
      const ours = encodeQr(text)
      const theirs = await reference(text)

      expect(ours.length).toBe(theirs.length)
      expect(ours).toEqual(theirs)
    })
  }

  it('витримує довжини від 1 до 200 байтів', async () => {
    for (const length of [1, 13, 14, 27, 28, 55, 106, 122, 152, 180, 200]) {
      const text = 'a'.repeat(length)
      expect(encodeQr(text), `довжина ${length}`).toEqual(await reference(text))
    }
  })
})

describe('розмір символу', () => {
  it('версія 1 — 21 модуль', () => {
    expect(encodeQr('hi')).toHaveLength(21)
  })

  it('кожна наступна версія додає чотири модулі', () => {
    const size = encodeQr('a'.repeat(30)).length
    expect((size - 17) % 4).toBe(0)
  })
})

describe('qrTargets', () => {
  const lan = { url: 'http://192.168.1.5:8317', kind: 'lan' as const }
  const tailnet = { url: 'http://100.101.5.7:8317', kind: 'tailscale' as const }

  it('без тунелю віддає лише локальні адреси', () => {
    expect(qrTargets([lan])).toEqual([{ plainUrl: lan.url, label: 'lan' }])
  })

  it('адреса тунелю додається першою', () => {
    const targets = qrTargets([lan], 'https://abc.trycloudflare.com')
    expect(targets[0]).toEqual({ plainUrl: 'https://abc.trycloudflare.com', label: 'tunnel' })
    expect(targets).toHaveLength(2)
  })

  it('не знає нічого про провайдера — pinggy отримує QR так само', () => {
    // The whole point of the extraction: a new provider cannot be forgotten here.
    const url = 'https://zoxzf-176-110-103-252.run.pinggy-free.link'
    expect(qrTargets([lan], url)[0]).toEqual({ plainUrl: url, label: 'tunnel' })
  })

  it('порядок за досяжністю: тунель, tailnet, локальна', () => {
    const targets = qrTargets([lan, tailnet], 'https://abc.trycloudflare.com')
    expect(targets.map((entry) => entry.label)).toEqual(['tunnel', 'tailscale', 'lan'])
  })

  it('порожній вхід не вигадує адрес', () => {
    expect(qrTargets([])).toEqual([])
    expect(qrTargets([], undefined)).toEqual([])
  })

  it('кожна ціль кодується в реальний символ', () => {
    for (const target of qrTargets([lan, tailnet], 'https://zoxzf-176.run.pinggy-free.link')) {
      expect(() => qrSvg(`${target.plainUrl}/?c=ABCDEFGHJK`)).not.toThrow()
    }
  })
})

describe('qrSvg', () => {
  it('додає тиху зону з обох боків', () => {
    const modules = encodeQr('hi').length
    const svg = qrSvg('hi', 4)
    expect(svg).toContain(`viewBox="0 0 ${modules + 8} ${modules + 8}"`)
  })

  it('малює білу підкладку — без неї темна тема ламає сканування', () => {
    expect(qrSvg('hi')).toContain('fill="#fff"')
  })

  it('порожній рядок — помилка', () => {
    expect(() => qrSvg('')).toThrow()
  })
})
