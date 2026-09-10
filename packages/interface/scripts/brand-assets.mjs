// SPDX-License-Identifier: Apache-2.0

// Draws the OCF IMS mark and writes the app's brand assets (plan 09o, slice
// 3a.4). Run it from packages/interface:
//
//     node scripts/brand-assets.mjs
//
// The mark is the app's one memorable idea reduced to a glyph: a rail on the
// left — the incident-number column — and three ledger lines beside it, ragged
// at the right the way a list of summaries is. No text, so it survives being
// 16 px in a browser tab. The colours are the tokens' `primary` and
// `onPrimary`; nothing here invents one.
//
// Pure Node: rounded rectangles rasterised with 4x4 supersampling, deflated
// with zlib, wrapped in a PNG. No image dependency to install or audit.

import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const PRIMARY = [0x24, 0x57, 0xa6]; // colors.light.primary
const ON_PRIMARY = [0xff, 0xff, 0xff]; // colors.light.onPrimary

// The mark, on its own 600 x 468 grid: the rail, then three lines.
const MARK = { w: 600, h: 468 };
const SHAPES = [
  { x: 0, y: 0, w: 88, h: 468, r: 20 },
  { x: 196, y: 0, w: 404, h: 96, r: 20 },
  { x: 196, y: 186, w: 268, h: 96, r: 20 },
  { x: 196, y: 372, w: 344, h: 96, r: 20 },
];

function insideRoundRect(px, py, s) {
  const x0 = s.x;
  const y0 = s.y;
  const x1 = s.x + s.w;
  const y1 = s.y + s.h;
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const r = s.r;
  const cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px;
  const cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** @returns coverage 0..1 of the mark at this device pixel. */
function coverage(px, py, scale, offX, offY) {
  const N = 4;
  let hits = 0;
  for (let sy = 0; sy < N; sy++) {
    for (let sx = 0; sx < N; sx++) {
      const mx = (px + (sx + 0.5) / N - offX) / scale;
      const my = (py + (sy + 0.5) / N - offY) / scale;
      if (SHAPES.some((s) => insideRoundRect(mx, my, s))) hits++;
    }
  }
  return hits / (N * N);
}

/**
 * @param size square edge in px
 * @param fraction how much of the edge the mark's width may take
 * @param ink the mark's colour
 * @param ground the background colour, or null for transparency
 */
function draw(size, fraction, ink, ground) {
  const scale = (size * fraction) / MARK.w;
  const offX = (size - MARK.w * scale) / 2;
  const offY = (size - MARK.h * scale) / 2;
  const px = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    px[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, scale, offX, offY);
      const i = row + 1 + x * 4;
      if (ground) {
        for (let c = 0; c < 3; c++) {
          px[i + c] = Math.round(ink[c] * a + ground[c] * (1 - a));
        }
        px[i + 3] = 255;
      } else {
        px[i] = ink[0];
        px[i + 1] = ink[1];
        px[i + 2] = ink[2];
        px[i + 3] = Math.round(a * 255);
      }
    }
  }
  return png(size, px);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const assets = [
  // The iOS / store icon: the platform masks the square itself.
  ["assets/icon.png", 1024, 0.62, ON_PRIMARY, PRIMARY],
  // Android's adaptive icon: foreground inside the 66% safe zone, on its own
  // background layer, plus the monochrome layer themed icons tint.
  ["assets/android-icon-foreground.png", 1024, 0.44, ON_PRIMARY, null],
  ["assets/android-icon-background.png", 1024, 0, PRIMARY, PRIMARY],
  ["assets/android-icon-monochrome.png", 1024, 0.44, ON_PRIMARY, null],
  // A browser tab, where the mark is 16 px across: filled, not transparent.
  ["assets/favicon.png", 96, 0.6, ON_PRIMARY, PRIMARY],
  // The splash mark (transparent; Expo composes it on the splash colour).
  ["assets/splash-icon.png", 1024, 0.5, PRIMARY, null],
];

for (const [path, size, fraction, ink, ground] of assets) {
  writeFileSync(path, draw(size, fraction, ink, ground));
  console.log(`${path} ${size}x${size}`);
}
