import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function testMasks() {
  const iconPath = path.resolve('apps/mobile/assets/icon.png');
  const iconBuf = fs.readFileSync(iconPath);
  const outDir = path.resolve('scripts/mask-tests');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const size = 512;
  const resized = await sharp(iconBuf).resize(size, size).toBuffer();

  // 1. Circular Mask (Pixel, stock Android)
  const circleSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#fff"/></svg>`
  );
  await sharp(resized)
    .composite([{ input: circleSvg, blend: 'dest-in' }])
    .png()
    .toFile(path.join(outDir, 'mask_circle_pixel.png'));

  // 2. Squircle Mask (Samsung One UI: squircle formula / rx,ry ~ 115px at 512)
  const squircleSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="115" ry="115" fill="#fff"/></svg>`
  );
  await sharp(resized)
    .composite([{ input: squircleSvg, blend: 'dest-in' }])
    .png()
    .toFile(path.join(outDir, 'mask_squircle_samsung.png'));

  // 3. Apple iOS Mask (22.37% continuous corner radius: rx=114px at 512)
  const iosSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="114" ry="114" fill="#fff"/></svg>`
  );
  await sharp(resized)
    .composite([{ input: iosSvg, blend: 'dest-in' }])
    .png()
    .toFile(path.join(outDir, 'mask_ios_squircle.png'));

  // 4. Rounded Square (OnePlus OxygenOS / Xiaomi MIUI: rx=85px at 512)
  const onePlusSvg = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="85" ry="85" fill="#fff"/></svg>`
  );
  await sharp(resized)
    .composite([{ input: onePlusSvg, blend: 'dest-in' }])
    .png()
    .toFile(path.join(outDir, 'mask_rounded_oneplus.png'));

  console.log('Generated mask test images in', outDir);
}

testMasks().catch(console.error);
