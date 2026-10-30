import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function makePng(width, height, rgbaBuffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits per sample
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT: Scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 4 + 1)] = 0; // Filter None
    rgbaBuffer.copy(
      scanlines,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const compressed = zlib.deflateSync(scanlines);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function generateAssets() {
  const assetsDir = path.resolve('apps/mobile/assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // 1. App Icon: 512x512
  const iconW = 512, iconH = 512;
  const iconBuf = Buffer.alloc(iconW * iconH * 4);
  for (let y = 0; y < iconH; y++) {
    for (let x = 0; x < iconW; x++) {
      const idx = (y * iconW + x) * 4;
      const dx = x - iconW / 2;
      const dy = y - iconH / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Deep dark/violet gradient background
      let r = 23, g = 21, b = 31, a = 255;
      if (dist < 220) {
        // Rounded brand background
        const grad = Math.min(1, Math.max(0, (y + 100) / 400));
        r = Math.round(116 * (1 - grad) + 90 * grad); // Violet #7444E8
        g = Math.round(68 * (1 - grad) + 47 * grad);
        b = Math.round(232 * (1 - grad) + 199 * grad);

        // Center stylized T emblem:
        // Horizontal bar
        if (Math.abs(dy + 40) < 25 && Math.abs(dx) < 110) {
          r = 255; g = 201; b = 60; // Yellow #FFC93C
        }
        // Vertical stem
        if (dy >= -40 && dy < 100 && Math.abs(dx) < 25) {
          r = 45; g = 190; b = 116; // Mint #2DBE74
        }
      }
      iconBuf[idx] = r;
      iconBuf[idx + 1] = g;
      iconBuf[idx + 2] = b;
      iconBuf[idx + 3] = a;
    }
  }
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), makePng(iconW, iconH, iconBuf));

  // 2. Adaptive Icon Foreground: 512x512 with transparent background
  const adaptBuf = Buffer.alloc(iconW * iconH * 4);
  for (let y = 0; y < iconH; y++) {
    for (let x = 0; x < iconW; x++) {
      const idx = (y * iconW + x) * 4;
      const dx = x - iconW / 2;
      const dy = y - iconH / 2;
      let r = 0, g = 0, b = 0, a = 0;

      // Stylized T Emblem
      if (Math.abs(dy + 40) < 28 && Math.abs(dx) < 120) {
        r = 255; g = 201; b = 60; a = 255; // Yellow #FFC93C
      }
      if (dy >= -40 && dy < 110 && Math.abs(dx) < 28) {
        r = 45; g = 190; b = 116; a = 255; // Mint #2DBE74
      }
      adaptBuf[idx] = r;
      adaptBuf[idx + 1] = g;
      adaptBuf[idx + 2] = b;
      adaptBuf[idx + 3] = a;
    }
  }
  fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), makePng(iconW, iconH, adaptBuf));

  // 3. Splash Screen: 600x1000
  const splashW = 600, splashH = 1000;
  const splashBuf = Buffer.alloc(splashW * splashH * 4);
  for (let y = 0; y < splashH; y++) {
    for (let x = 0; x < splashW; x++) {
      const idx = (y * splashW + x) * 4;
      const dx = x - splashW / 2;
      const dy = y - splashH / 2;

      // Warm-white background #FAF9FC
      let r = 250, g = 249, b = 252, a = 255;

      // Center logo mark
      if (Math.abs(dy + 30) < 20 && Math.abs(dx) < 80) {
        r = 116; g = 68; b = 232; // Violet #7444E8
      }
      if (dy >= -30 && dy < 80 && Math.abs(dx) < 18) {
        r = 45; g = 190; b = 116; // Mint #2DBE74
      }

      splashBuf[idx] = r;
      splashBuf[idx + 1] = g;
      splashBuf[idx + 2] = b;
      splashBuf[idx + 3] = a;
    }
  }
  fs.writeFileSync(path.join(assetsDir, 'splash.png'), makePng(splashW, splashH, splashBuf));

  // 4. Favicon: 48x48
  const favW = 48, favH = 48;
  const favBuf = Buffer.alloc(favW * favH * 4);
  for (let y = 0; y < favH; y++) {
    for (let x = 0; x < favW; x++) {
      const idx = (y * favW + x) * 4;
      favBuf[idx] = 116;
      favBuf[idx + 1] = 68;
      favBuf[idx + 2] = 232;
      favBuf[idx + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(assetsDir, 'favicon.png'), makePng(favW, favH, favBuf));

  console.log('Successfully generated assets: icon.png, adaptive-icon.png, splash.png, favicon.png');
}

generateAssets();
