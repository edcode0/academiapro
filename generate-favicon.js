/**
 * Favicon generator for AcademiaPro
 * Generates favicon.ico (16x16, 32x32) and apple-touch-icon.png (180x180)
 * Uses only Node.js built-ins (zlib, fs)
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ──────────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(d.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])), 0);
  return Buffer.concat([len, t, d, crcBuf]);
}

// ── PNG Builder ────────────────────────────────────────────────────────────
function createPNG(size, drawFn) {
  const pixels = new Uint8Array(size * size * 3); // RGB

  // Fill background: #0f172a
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = 0x0f; pixels[i+1] = 0x17; pixels[i+2] = 0x2a;
  }

  // Draw function fills pixels
  drawFn(pixels, size);

  // Build raw scanlines (filter byte 0 = None + RGB rows)
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw.push(pixels[i], pixels[i+1], pixels[i+2]);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(raw), { level: 9 });

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Rect helper ───────────────────────────────────────────────────────────
function fillRect(pixels, size, x1, y1, x2, y2, r, g, b) {
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const i = (y * size + x) * 3;
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b;
    }
  }
}

// ── Rounded rect corner mask ───────────────────────────────────────────────
function applyRoundedMask(pixels, size, radius) {
  const BG_R = 0x00, BG_G = 0x00, BG_B = 0x00; // transparent → outside icon bg
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, radius - x, x - (size - 1 - radius));
      const dy = Math.max(0, radius - y, y - (size - 1 - radius));
      if (dx * dx + dy * dy > radius * radius) {
        const i = (y * size + x) * 3;
        // Set to transparent-ish (matching page bg won't matter in ICO)
        pixels[i] = 0xf8; pixels[i+1] = 0xf7; pixels[i+2] = 0xf4;
      }
    }
  }
}

// ── Draw "AP" scaled to given size (designed on 32x32 grid) ───────────────
function drawAP(pixels, size) {
  const s = size / 32; // scale factor
  const W = [255, 255, 255]; // white letters

  function r(x1, y1, x2, y2) {
    fillRect(pixels, size,
      Math.round(x1*s), Math.round(y1*s),
      Math.round(x2*s), Math.round(y2*s),
      W[0], W[1], W[2]);
  }

  // Letter A (x: 2-14, y: 7-25, stroke=3)
  r(2, 7, 5, 25);     // left vertical
  r(12, 7, 15, 25);   // right vertical
  r(2, 7, 15, 10);    // top bar
  r(2, 15, 15, 18);   // middle bar

  // Letter P (x: 17-30, y: 7-25, stroke=3)
  r(17, 7, 20, 25);   // left vertical
  r(17, 7, 27, 10);   // top bar
  r(27, 7, 30, 18);   // right bump
  r(17, 15, 27, 18);  // middle bar closing P
}

// ── Generate sizes ─────────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'public');

// 32×32 PNG
const png32 = createPNG(32, (pixels, size) => {
  drawAP(pixels, size);
  applyRoundedMask(pixels, size, 6);
});
fs.writeFileSync(path.join(outDir, 'favicon-32.png'), png32);
console.log('favicon-32.png created');

// 16×16 PNG
const png16 = createPNG(16, (pixels, size) => {
  drawAP(pixels, size);
  applyRoundedMask(pixels, size, 3);
});
fs.writeFileSync(path.join(outDir, 'favicon-16.png'), png16);
console.log('favicon-16.png created');

// 180×180 PNG (apple-touch-icon) — no rounded mask (iOS applies its own)
const png180 = createPNG(180, (pixels, size) => {
  drawAP(pixels, size);
});
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), png180);
console.log('apple-touch-icon.png created');

// ── Build .ico (RIFF-style: header + dir + PNG images) ────────────────────
// ICO format supports embedded PNG (Windows Vista+)
function buildICO(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = count * dirEntrySize;
  let offset = headerSize + dirSize;

  const header = Buffer.allocUnsafe(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type: ICO
  header.writeUInt16LE(count, 4); // count

  const dirs = pngBuffers.map((png, i) => {
    const sz = sizes[i];
    const dir = Buffer.allocUnsafe(16);
    dir[0] = sz >= 256 ? 0 : sz;  // width (0 = 256)
    dir[1] = sz >= 256 ? 0 : sz;  // height
    dir[2] = 0;   // color count
    dir[3] = 0;   // reserved
    dir.writeUInt16LE(1, 4);      // color planes
    dir.writeUInt16LE(32, 6);     // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += png.length;
    return dir;
  });

  return Buffer.concat([header, ...dirs, ...pngBuffers]);
}

const ico = buildICO([png16, png32], [16, 32]);
fs.writeFileSync(path.join(outDir, 'favicon.ico'), ico);
console.log('favicon.ico created (16x16 + 32x32)');

console.log('\nAll favicon files generated successfully in public/');
