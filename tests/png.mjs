import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Decode only the 8-bit RGB/RGBA PNGs produced by browser.screenshot. This keeps
// rendered-background contrast checks independent of extra graphics packages.
export function screenshotPixels(png) {
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(png[24], 8, 'Screenshot must be 8-bit');
  assert.ok([2, 6].includes(png[25]), 'Screenshot must be RGB or RGBA');
  assert.equal(png[28], 0, 'Screenshot must not be interlaced');
  const channels = png[25] === 6 ? 4 : 3;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    assert.ok(filter <= 4, 'Known PNG filter');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = left + up - upperLeft;
      const distances = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upperLeft)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : upperLeft;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
      pixels[y * stride + x] = (packed[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, at: (x, y) => {
    assert.ok(x >= 0 && x < width && y >= 0 && y < height);
    return [...pixels.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
  } };
}

export function contrastRatio(foreground, background) {
  const alpha = foreground[3] ?? 1;
  const composite = foreground.slice(0, 3).map((n, i) => alpha * n + (1 - alpha) * background[i]);
  const luminance = rgb => rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const a = luminance(composite); const b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
