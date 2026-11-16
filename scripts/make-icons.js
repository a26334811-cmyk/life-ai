/* Generates the app icons (no image library needed): node scripts/make-icons.js
   Output: icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png, icons/apple-touch-icon.png */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BLUE = [23, 99, 219];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* A timer ring with a check mark. `scale` shrinks the glyph for maskable icons (safe zone),
   `radius` rounds the square background (0 = full bleed). */
function render(size, { scale, radius }) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
          // background (rounded square)
          let inside = true;
          if (radius > 0) {
            const cx = Math.min(Math.max(u, radius), 1 - radius), cy = Math.min(Math.max(v, radius), 1 - radius);
            inside = Math.hypot(u - cx, v - cy) <= radius;
          }
          if (!inside) continue;
          bg++;
          const gx = (u - 0.5) / scale + 0.5, gy = (v - 0.5) / scale + 0.5;
          const ring = Math.abs(Math.hypot(gx - 0.5, gy - 0.5) - 0.3) <= 0.04;
          const check = Math.min(
            distToSegment(gx, gy, 0.36, 0.5, 0.46, 0.6),
            distToSegment(gx, gy, 0.46, 0.6, 0.65, 0.39)) <= 0.033;
          if (ring || check) fg++;
        }
      }
      const total = SS * SS, i = (y * size + x) * 4;
      const alpha = bg / total, mix = bg ? fg / bg : 0;
      rgba[i] = Math.round(BLUE[0] + (WHITE[0] - BLUE[0]) * mix);
      rgba[i + 1] = Math.round(BLUE[1] + (WHITE[1] - BLUE[1]) * mix);
      rgba[i + 2] = Math.round(BLUE[2] + (WHITE[2] - BLUE[2]) * mix);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { scale: 1, radius: 0.22 }],
  ['icon-512.png', 512, { scale: 1, radius: 0.22 }],
  ['icon-maskable-512.png', 512, { scale: 0.72, radius: 0 }],
  ['apple-touch-icon.png', 180, { scale: 0.9, radius: 0 }]
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, render(size, opts)));
  console.log('wrote icons/' + name);
}
