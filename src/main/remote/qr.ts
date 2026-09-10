/**
 * A QR encoder, byte mode, error correction level M.
 *
 * Written out rather than pulled in as a dependency because what it has to
 * encode is one short URL, and the whole algorithm is a pure function of that
 * string — no I/O, no platform behaviour, nothing that drifts. Level M is the
 * usual choice for a code shown on a screen: it survives a fingerprint on the
 * display without inflating the module count the way Q or H would.
 *
 * Versions 1–10 are supported, which reaches 213 bytes — several times the
 * longest URL this app produces.
 */

interface BlockLayout {
  /** Error-correction codewords per block. */
  ecPerBlock: number
  /** [blockCount, dataCodewordsPerBlock] for each group. */
  groups: Array<[number, number]>
}

/** Block structure at level M. Straight from the standard's table. */
const LAYOUT_M: BlockLayout[] = [
  { ecPerBlock: 10, groups: [[1, 16]] },
  { ecPerBlock: 16, groups: [[1, 28]] },
  { ecPerBlock: 26, groups: [[1, 44]] },
  { ecPerBlock: 18, groups: [[2, 32]] },
  { ecPerBlock: 24, groups: [[2, 43]] },
  { ecPerBlock: 16, groups: [[4, 27]] },
  { ecPerBlock: 18, groups: [[4, 31]] },
  { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { ecPerBlock: 26, groups: [[4, 43], [1, 44]] }
]

/** Row/column centres of the alignment patterns, by version. */
const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50]
]

// ─── Galois field GF(256) ────────────────────────────────────────────────────

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)

{
  // The field is built on the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
  let value = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = value
    LOG[value] = i
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  // Doubling the exponent table lets multiplication skip a modulo.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** Reed-Solomon remainder: the error-correction codewords for one block. */
export function reedSolomon(data: Uint8Array, ecLength: number): Uint8Array {
  const generator = generatorPoly(ecLength)
  const remainder = new Uint8Array(ecLength)

  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.copyWithin(0, 1)
    remainder[ecLength - 1] = 0
    if (factor === 0) continue
    for (let i = 0; i < ecLength; i++) {
      remainder[i] ^= gfMul(generator[i + 1], factor)
    }
  }
  return remainder
}

// ─── Bit stream ──────────────────────────────────────────────────────────────

class BitBuffer {
  private bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }

  get length(): number {
    return this.bits.length
  }

  /** Pads to a byte boundary and returns the codewords. */
  toBytes(): Uint8Array {
    while (this.bits.length % 8 !== 0) this.bits.push(0)
    const bytes = new Uint8Array(this.bits.length / 8)
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >> 3] |= 0x80 >>> (i & 7)
    }
    return bytes
  }
}

function dataCapacity(version: number): number {
  const layout = LAYOUT_M[version - 1]
  return layout.groups.reduce((sum, [count, size]) => sum + count * size, 0)
}

/** Smallest version that holds this much data at level M. */
export function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version++) {
    // Mode indicator (4) + character count + payload, in bytes.
    const countBits = version < 10 ? 8 : 16
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8)
    if (needed <= dataCapacity(version)) return version
  }
  throw new Error('Too much data for a version 10 QR code')
}

/** Data codewords for `text`, padded and with error correction interleaved. */
function buildCodewords(text: string, version: number): Uint8Array {
  const payload = new TextEncoder().encode(text)
  const layout = LAYOUT_M[version - 1]
  const capacity = dataCapacity(version)

  const buffer = new BitBuffer()
  buffer.push(0b0100, 4) // byte mode
  buffer.push(payload.length, version < 10 ? 8 : 16)
  for (const byte of payload) buffer.push(byte, 8)

  // Terminator: up to four zero bits, fewer if the capacity ends sooner.
  buffer.push(0, Math.min(4, capacity * 8 - buffer.length))

  const data = Array.from(buffer.toBytes())
  // The standard's pad bytes, alternating, until the capacity is filled.
  const PAD = [0xec, 0x11]
  for (let i = 0; data.length < capacity; i++) data.push(PAD[i % 2])

  // Split into blocks, then interleave: the standard spreads each block's
  // codewords across the symbol so a smudge damages every block a little
  // rather than destroying one completely.
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0
  for (const [count, size] of layout.groups) {
    for (let i = 0; i < count; i++) {
      const block = Uint8Array.from(data.slice(offset, offset + size))
      offset += size
      dataBlocks.push(block)
      ecBlocks.push(reedSolomon(block, layout.ecPerBlock))
    }
  }

  const result: number[] = []
  const longest = Math.max(...dataBlocks.map((b) => b.length))
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i])
  }
  for (let i = 0; i < layout.ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i])
  }
  return Uint8Array.from(result)
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

/** -1 = free, 0/1 = set module. A separate flag marks function patterns. */
interface Canvas {
  size: number
  modules: Int8Array
  reserved: Uint8Array
}

function makeCanvas(version: number): Canvas {
  const size = version * 4 + 17
  return {
    size,
    modules: new Int8Array(size * size).fill(-1),
    reserved: new Uint8Array(size * size)
  }
}

function set(canvas: Canvas, row: number, col: number, dark: boolean, reserve = true): void {
  if (row < 0 || col < 0 || row >= canvas.size || col >= canvas.size) return
  canvas.modules[row * canvas.size + col] = dark ? 1 : 0
  if (reserve) canvas.reserved[row * canvas.size + col] = 1
}

function isReserved(canvas: Canvas, row: number, col: number): boolean {
  return canvas.reserved[row * canvas.size + col] === 1
}

function drawFinder(canvas: Canvas, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
      set(canvas, row + r, col + c, inRing || inCore)
    }
  }
}

function drawFunctionPatterns(canvas: Canvas, version: number): void {
  const last = canvas.size - 7
  drawFinder(canvas, 0, 0)
  drawFinder(canvas, 0, last)
  drawFinder(canvas, last, 0)

  // Timing patterns: alternating modules joining the finders.
  for (let i = 8; i < canvas.size - 8; i++) {
    set(canvas, 6, i, i % 2 === 0)
    set(canvas, i, 6, i % 2 === 0)
  }

  for (const row of ALIGNMENT[version - 1]) {
    for (const col of ALIGNMENT[version - 1]) {
      // Alignment patterns never overlap a finder.
      const nearFinder =
        (row <= 8 && col <= 8) || (row <= 8 && col >= canvas.size - 9) || (row >= canvas.size - 9 && col <= 8)
      if (nearFinder) continue
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          set(canvas, row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1)
        }
      }
    }
  }

  // Reserve exactly the format positions, and no more: row 6 and column 6 run
  // through this area carrying the timing patterns, and blanking them here is
  // the kind of off-by-one that produces a symbol no scanner will read.
  for (let i = 0; i <= 5; i++) {
    set(canvas, i, 8, false)
    set(canvas, 8, i, false)
  }
  set(canvas, 7, 8, false)
  set(canvas, 8, 8, false)
  set(canvas, 8, 7, false)
  for (let i = 0; i < 8; i++) set(canvas, 8, canvas.size - 1 - i, false)
  for (let i = 0; i < 7; i++) set(canvas, canvas.size - 7 + i, 8, false)

  // The module that is always dark sits just below that reserved strip, so it
  // is written last rather than being overwritten by it.
  set(canvas, canvas.size - 8, 8, true)

  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >> i) & 1) === 1
      const row = Math.floor(i / 3)
      const col = canvas.size - 11 + (i % 3)
      set(canvas, row, col, bit)
      set(canvas, col, row, bit)
    }
  }
}

/** Version information: six data bits plus an 18-bit BCH remainder. */
export function versionBits(version: number): number {
  let remainder = version
  for (let i = 0; i < 12; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  }
  return ((version << 12) | remainder) >>> 0
}

/** Format information for level M and a mask, BCH-protected and masked. */
export function formatBits(mask: number): number {
  // Level M is 0b00, so the five data bits are just the mask number.
  const data = mask
  let remainder = data
  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  }
  return (((data << 10) | remainder) ^ 0x5412) >>> 0
}

/**
 * Writes the 15 format bits twice.
 *
 * The two copies are laid out so that losing a whole corner still leaves one
 * readable — which is why the mapping is this irregular rather than two tidy
 * lines. Bit 0 is the least significant.
 */
function drawFormat(canvas: Canvas, mask: number): void {
  const bits = formatBits(mask)
  const bit = (i: number): boolean => ((bits >> i) & 1) === 1
  const last = canvas.size - 1

  // First copy: down the left of the top-left finder, then along the top.
  for (let i = 0; i <= 5; i++) set(canvas, i, 8, bit(i))
  set(canvas, 7, 8, bit(6))
  set(canvas, 8, 8, bit(7))
  set(canvas, 8, 7, bit(8))
  for (let i = 9; i < 15; i++) set(canvas, 8, 14 - i, bit(i))

  // Second copy: along the top right, then down the left edge.
  for (let i = 0; i < 8; i++) set(canvas, 8, last - i, bit(i))
  for (let i = 8; i < 15; i++) set(canvas, canvas.size - 15 + i, 8, bit(i))
}

/** The mask condition for a module, as defined by the standard. */
function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/**
 * Lays the codewords out and applies the mask in one pass.
 *
 * Placement runs in two-column strips from the bottom right, snaking upward
 * and downward, skipping the vertical timing column and every reserved module.
 */
function placeData(canvas: Canvas, codewords: Uint8Array, mask: number): void {
  let bitIndex = 0
  let upward = true

  for (let right = canvas.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is not part of a strip.
    if (right === 6) right = 5

    for (let step = 0; step < canvas.size; step++) {
      const row = upward ? canvas.size - 1 - step : step
      for (const col of [right, right - 1]) {
        if (isReserved(canvas, row, col)) continue

        const byte = codewords[bitIndex >> 3]
        const bit = bitIndex < codewords.length * 8 ? (byte >> (7 - (bitIndex & 7))) & 1 : 0
        bitIndex++

        set(canvas, row, col, (bit === 1) !== maskAt(mask, row, col), false)
      }
    }
    upward = !upward
  }
}

// ─── Mask selection ──────────────────────────────────────────────────────────

function dark(canvas: Canvas, row: number, col: number): boolean {
  return canvas.modules[row * canvas.size + col] === 1
}

/**
 * The standard's four penalty rules, summed. The mask with the lowest total
 * wins — it is what keeps a symbol from containing patterns a scanner would
 * mistake for a finder.
 */
export function penalty(canvas: Canvas): number {
  const n = canvas.size
  let score = 0

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (const byRow of [true, false]) {
    for (let a = 0; a < n; a++) {
      let run = 1
      let previous = byRow ? dark(canvas, a, 0) : dark(canvas, 0, a)
      for (let b = 1; b < n; b++) {
        const current = byRow ? dark(canvas, a, b) : dark(canvas, b, a)
        if (current === previous) {
          run++
          continue
        }
        if (run >= 5) score += run - 2
        previous = current
        run = 1
      }
      if (run >= 5) score += run - 2
    }
  }

  // Rule 2: every 2×2 block of one colour.
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const first = dark(canvas, row, col)
      if (
        first === dark(canvas, row, col + 1) &&
        first === dark(canvas, row + 1, col) &&
        first === dark(canvas, row + 1, col + 1)
      ) {
        score += 3
      }
    }
  }

  // Rule 3: the finder-like sequence 1:1:3:1:1 with four light modules beside it.
  const A = [true, false, true, true, true, false, true, false, false, false, false]
  const B = [false, false, false, false, true, false, true, true, true, false, true]
  for (const byRow of [true, false]) {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b + 11 <= n; b++) {
        let matchA = true
        let matchB = true
        for (let k = 0; k < 11; k++) {
          const value = byRow ? dark(canvas, a, b + k) : dark(canvas, b + k, a)
          if (value !== A[k]) matchA = false
          if (value !== B[k]) matchB = false
        }
        if (matchA) score += 40
        if (matchB) score += 40
      }
    }
  }

  // Rule 4: how far the proportion of dark modules strays from half.
  let darkCount = 0
  for (let i = 0; i < canvas.modules.length; i++) if (canvas.modules[i] === 1) darkCount++
  const percent = (darkCount * 100) / (n * n)
  score += Math.floor(Math.abs(percent - 50) / 5) * 10

  return score
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * A QR symbol as rows of booleans, dark = true. No quiet zone included.
 *
 * `forcedMask` exists for tests: the mask is normally chosen by score, and
 * pinning it is the only way to compare one specific symbol against a
 * reference implementation.
 */
export function encodeQr(text: string, forcedMask?: number): boolean[][] {
  if (!text) throw new Error('Nothing to encode')

  const version = chooseVersion(new TextEncoder().encode(text).length)
  const codewords = buildCodewords(text, version)

  const render = (mask: number): Canvas => {
    const canvas = makeCanvas(version)
    drawFunctionPatterns(canvas, version)
    placeData(canvas, codewords, mask)
    drawFormat(canvas, mask)
    return canvas
  }

  let best: Canvas | undefined
  if (forcedMask !== undefined) {
    best = render(forcedMask)
  } else {
    let bestScore = Infinity
    for (let mask = 0; mask < 8; mask++) {
      const canvas = render(mask)
      const score = penalty(canvas)
      if (score < bestScore) {
        bestScore = score
        best = canvas
      }
    }
  }

  const canvas = best as Canvas
  const rows: boolean[][] = []
  for (let row = 0; row < canvas.size; row++) {
    rows.push(Array.from({ length: canvas.size }, (_, col) => dark(canvas, row, col)))
  }
  return rows
}

/** One scannable entry point, before the symbol is drawn for it. */
export interface QrTarget {
  plainUrl: string
  label: 'lan' | 'tailscale' | 'tunnel'
}

/**
 * Every address worth offering as a QR, ordered by how far it reaches.
 *
 * The tunnel goes first whenever one is up, whichever provider produced it —
 * this deliberately knows nothing about Cloudflare or Pinggy, so adding a
 * provider can never leave its address without a code to scan.
 */
export function qrTargets(
  addresses: Array<{ url: string; kind: 'lan' | 'tailscale' }>,
  tunnelUrl?: string
): QrTarget[] {
  const targets: QrTarget[] = []
  if (tunnelUrl) targets.push({ plainUrl: tunnelUrl, label: 'tunnel' })

  for (const address of addresses) {
    targets.push({ plainUrl: address.url, label: address.kind })
  }
  // Tailnet addresses reach as far as a tunnel; local ones stop at the door.
  const rank = { tunnel: 0, tailscale: 1, lan: 2 }
  return targets.sort((a, b) => rank[a.label] - rank[b.label])
}

/**
 * An SVG of the symbol, sized in modules so the caller scales it with CSS.
 *
 * The quiet zone is part of the image rather than left to the layout: without
 * those four light modules many scanners simply do not see the code, and a
 * caller cannot be relied upon to remember that.
 */
export function qrSvg(text: string, quietZone = 4): string {
  const rows = encodeQr(text)
  const size = rows.length + quietZone * 2

  // One path for every dark module beats one rect each: the string stays small
  // enough to inline in a data URI.
  const path: string[] = []
  rows.forEach((row, y) => {
    row.forEach((isDark, x) => {
      if (isDark) path.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`)
    })
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${path.join('')}" fill="#000"/>` +
    `</svg>`
  )
}
