// Erzeugt die App-Icons als PNG nach public/ (ohne Abhängigkeiten).
// Motiv: grüner Ring mit weißem Zeiger auf Schwarz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Farbe eines Punkts (x, y in 0..1). `scale` verkleinert das Motiv für maskierbare Icons. */
function colorAt(x, y, scale) {
  const dx = (x - 0.5) / scale;
  const dy = (y - 0.5) / scale;
  const r = Math.hypot(dx, dy);
  if (r > 0.3 && r < 0.4) return [61, 220, 132];
  // Zeiger: von der Mitte nach rechts oben
  const ex = 0.17;
  const ey = -0.17;
  const t = Math.min(1, Math.max(0, (dx * ex + dy * ey) / (ex * ex + ey * ey)));
  if (Math.hypot(dx - ex * t, dy - ey * t) < 0.04) return [255, 255, 255];
  return [0, 0, 0];
}

function png(size, scale) {
  const ss = 3;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, scale);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      for (let k = 0; k < 3; k++) raw[row + 1 + x * 3 + k] = Math.round(acc[k] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bit-Tiefe
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.75],
  ['apple-touch-icon.png', 180, 0.9],
];
for (const [name, size, scale] of icons) {
  writeFileSync(join(out, name), png(size, scale));
  console.log(`public/${name}`);
}
