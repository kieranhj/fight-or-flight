// Generates the PWA PNG icons (192, 512, 512-maskable) from a simple flat design:
// a dark navy rounded background with a sky-blue aircraft glyph. Dependency-free
// PNG encoding via Node's zlib so we don't pull in an image library.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = [15, 23, 42] // #0f172a slate-900
const FG = [56, 189, 248] // #38bdf8 sky-400

// CRC32 for PNG chunks.
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

// Aircraft glyph: signed-distance-ish test against a stylized plane in unit space.
function isPlane(u, v) {
  // u,v in [-1,1], origin centre. Nose up.
  const x = Math.abs(u)
  // fuselage
  if (x < 0.08 && v > -0.78 && v < 0.62) return true
  // nose taper
  if (x < 0.08 * (1 - (v - 0.4) / 0.4) && v >= 0.62 && v < 0.82) return true
  // main wings (swept slightly back)
  if (v > -0.16 && v < 0.06 && x < 0.78 - (0.06 - v) * 0.0) {
    const wingThick = 0.16 - x * 0.16
    if (Math.abs(v + 0.05 + x * 0.18) < wingThick) return true
  }
  // tailplane
  if (v < -0.5 && v > -0.74) {
    const tThick = 0.1 - x * 0.18
    if (x < 0.42 && Math.abs(v + 0.6 + x * 0.12) < tThick) return true
  }
  return false
}

function makePNG(size, padding) {
  // padding: fraction of half-size kept clear around the glyph (maskable wants more).
  const radius = size * 0.22
  const rowBytes = size * 4
  const raw = Buffer.alloc((rowBytes + 1) * size)
  const scale = 1 - padding
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0 // filter type 0
    for (let x = 0; x < size; x++) {
      // rounded-rect background mask
      const cx = Math.min(x, size - 1 - x)
      const cy = Math.min(y, size - 1 - y)
      let inBg = true
      if (cx < radius && cy < radius) {
        const dx = radius - cx
        const dy = radius - cy
        inBg = dx * dx + dy * dy <= radius * radius
      }
      const u = ((x / (size - 1)) * 2 - 1) / scale
      const v = -(((y / (size - 1)) * 2 - 1) / scale)
      const fg = inBg && isPlane(u, v)
      const [r, g, b] = fg ? FG : BG
      const o = y * (rowBytes + 1) + 1 + x * 4
      raw[o] = inBg ? r : 0
      raw[o + 1] = inBg ? g : 0
      raw[o + 2] = inBg ? b : 0
      raw[o + 3] = inBg ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  { file: 'icon-192.png', size: 192, padding: 0.18 },
  { file: 'icon-512.png', size: 512, padding: 0.18 },
  { file: 'icon-512-maskable.png', size: 512, padding: 0.32 },
]
for (const t of targets) {
  writeFileSync(join(outDir, t.file), makePNG(t.size, t.padding))
  console.log('wrote', t.file)
}
