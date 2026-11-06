// Draws images/icon.png (256x256): a shield holding a diff with added and removed lines.
// Pure Node, no dependencies, so the icon can be regenerated or tweaked: node scripts/make-icon.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const SS = 4; // supersampling per axis, for smooth edges

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const SHIELD = [
  [128, 22], [206, 44], [208, 112], [200, 152], [180, 188], [152, 214], [128, 230],
  [104, 214], [76, 188], [56, 152], [48, 112], [50, 44],
];
const inPolygon = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Colour at a point, or null for transparent. Later layers draw over earlier ones. */
function sample(x, y) {
  let color = null;
  if (inRoundRect(x, y, 0, 0, SIZE, SIZE, 56)) color = hex('#0f172a');
  if (inPolygon(x, y, SHIELD)) {
    const t = Math.min(1, Math.max(0, (y - 22) / 208));
    const top = hex('#3b82f6');
    const bottom = hex('#1e40af');
    color = [lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t)];
  }
  if (inRoundRect(x, y, 86, 76, 170, 170, 9)) color = hex('#f8fafc');
  if (inRoundRect(x, y, 98, 94, 158, 104, 4)) color = hex('#16a34a');
  if (inRoundRect(x, y, 98, 119, 158, 129, 4)) color = hex('#dc2626');
  if (inRoundRect(x, y, 98, 144, 138, 154, 4)) color = hex('#16a34a');
  return color;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // PNG filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, hit = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) { r += c[0]; g += c[1]; b += c[2]; hit++; }
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const total = SS * SS;
    if (hit > 0) {
      raw[o] = Math.round(r / hit);
      raw[o + 1] = Math.round(g / hit);
      raw[o + 2] = Math.round(b / hit);
      raw[o + 3] = Math.round((hit / total) * 255);
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'images', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
