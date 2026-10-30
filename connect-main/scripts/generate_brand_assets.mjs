import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

/**
 * Tathastu Meet Master Vector Icon Generator
 * Generates production-ready SVG and PNG brand assets across Android, iOS, Web/PWA, and In-App surfaces.
 */

export function createMasterSvg({
  mode = 'full', // 'full' (gold canvas), 'foreground' (transparent for Android adaptive), 'symbol' (transparent standalone), 'monochrome' (flat white for Material You)
  size = 1024,
  safePadding = 0, // Inset percentage for Android adaptive icon safe zone
} = {}) {
  const scale = 1 - (safePadding * 2);
  const translate = 1024 * safePadding;

  if (mode === 'monochrome') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${translate}, ${translate}) scale(${scale})" fill="#FFFFFF">
    <!-- Left Panel Outline & Avatar -->
    <path d="M 136, 310 C 136, 255  165, 230  210, 245 L 396, 315 C 416, 322  428, 342  428, 364 L 428, 638 C 428, 660  416, 680  396, 687 L 210, 757 C 165, 772  136, 747  136, 692 Z" fill-opacity="0.85" />
    <circle cx="278" cy="435" r="56" fill="#FFFFFF" />
    <path d="M 196, 665 C 196, 580  226, 526  278, 526 C 330, 526  360, 580  360, 665 Z" fill="#FFFFFF" />

    <!-- Right Panel Outline & Avatar -->
    <path d="M 888, 310 C 888, 255  859, 230  814, 245 L 628, 315 C 608, 322  596, 342  596, 364 L 596, 638 C 596, 660  608, 680  628, 687 L 814, 757 C 859, 772  888, 747  888, 692 Z" fill-opacity="0.85" />
    <circle cx="746" cy="435" r="56" fill="#FFFFFF" />
    <path d="M 664, 665 C 664, 580  694, 526  746, 526 C 798, 526  828, 580  828, 665 Z" fill="#FFFFFF" />

    <!-- Center Sphere -->
    <circle cx="512" cy="355" r="54" fill="#FFFFFF" />

    <!-- Center 't' -->
    <path d="M 476, 420 C 476, 412  484, 408  494, 408 L 530, 408 C 540, 408  548, 412  548, 420 L 548, 456 C 572, 454  602, 442  616, 422 C 620, 416  628, 416  630, 424 C 630, 432  622, 448  608, 466 C 588, 490  562, 506  548, 508 L 548, 626 C 548, 664  570, 686  604, 682 C 616, 680  628, 668  634, 654 C 636, 648  644, 648  645, 654 C 642, 678  618, 712  580, 712 C 524, 712  476, 670  476, 612 L 476, 508 C 458, 506  426, 492  398, 466 C 386, 454  388, 440  398, 438 C 404, 436  412, 442  422, 452 C 440, 470  458, 474  476, 474 Z" fill="#FFFFFF" />
  </g>
</svg>`;
  }

  const bgLayer = mode === 'full' ? `
    <!-- Edge-to-edge golden amber background with rich lighting -->
    <rect width="1024" height="1024" fill="url(#canvasGrad)" />
    
    <!-- Top-center radiant highlight -->
    <radialGradient id="topRadiance" cx="50%" cy="16%" r="68%">
      <stop offset="0%" stop-color="#FFFDE7" stop-opacity="0.6" />
      <stop offset="30%" stop-color="#FFF176" stop-opacity="0.3" />
      <stop offset="65%" stop-color="#FFD54F" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#FFA000" stop-opacity="0" />
    </radialGradient>
    <rect width="1024" height="1024" fill="url(#topRadiance)" />

    <!-- Outer rim ambient depth -->
    <radialGradient id="edgeVignette" cx="50%" cy="50%" r="72%">
      <stop offset="55%" stop-color="#FFA000" stop-opacity="0" />
      <stop offset="82%" stop-color="#FF8F00" stop-opacity="0.22" />
      <stop offset="100%" stop-color="#E65100" stop-opacity="0.45" />
    </radialGradient>
    <rect width="1024" height="1024" fill="url(#edgeVignette)" />
  ` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background Canvas Gradient -->
    <linearGradient id="canvasGrad" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFDF00" />
      <stop offset="26%" stop-color="#FFC800" />
      <stop offset="68%" stop-color="#FFA000" />
      <stop offset="100%" stop-color="#F57C00" />
    </linearGradient>

    <!-- Left Panel Outer Frame Gradient (Golden Amber Rim) -->
    <linearGradient id="leftFrameGrad" x1="136" y1="220" x2="424" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFDE7" />
      <stop offset="22%" stop-color="#FFE082" />
      <stop offset="58%" stop-color="#FFB300" />
      <stop offset="100%" stop-color="#FF6F00" />
    </linearGradient>

    <!-- Left Panel Screen Interior Gradient (Warm Amber / Orange) -->
    <linearGradient id="leftScreenGrad" x1="150" y1="240" x2="410" y2="740" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFA726" />
      <stop offset="28%" stop-color="#FB8C00" />
      <stop offset="65%" stop-color="#E64A19" />
      <stop offset="100%" stop-color="#BF360C" />
    </linearGradient>

    <!-- Right Panel Outer Frame Gradient (Indigo / Lavender Rim) -->
    <linearGradient id="rightFrameGrad" x1="888" y1="220" x2="600" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#E8EAF6" />
      <stop offset="18%" stop-color="#C5CAE9" />
      <stop offset="48%" stop-color="#5C6BC0" />
      <stop offset="82%" stop-color="#283593" />
      <stop offset="100%" stop-color="#1A237E" />
    </linearGradient>

    <!-- Right Panel Screen Interior Gradient (Deep Midnight Indigo / Purple) -->
    <linearGradient id="rightScreenGrad" x1="874" y1="240" x2="614" y2="740" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#283593" />
      <stop offset="28%" stop-color="#1A237E" />
      <stop offset="68%" stop-color="#140E3E" />
      <stop offset="100%" stop-color="#0B0624" />
    </linearGradient>

    <!-- Center 't' Gradient: Polished 3D Gold -->
    <linearGradient id="tGrad" x1="495" y1="410" x2="525" y2="720" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFF9C4" />
      <stop offset="18%" stop-color="#FFD54F" />
      <stop offset="48%" stop-color="#FFB300" />
      <stop offset="78%" stop-color="#FF8F00" />
      <stop offset="100%" stop-color="#E65100" />
    </linearGradient>

    <!-- Center Sphere 3D Radial Highlight -->
    <radialGradient id="sphereRadial" cx="36%" cy="32%" r="66%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="24%" stop-color="#FFF9C4" />
      <stop offset="52%" stop-color="#FFCA28" />
      <stop offset="82%" stop-color="#FF8F00" />
      <stop offset="100%" stop-color="#D84315" />
    </radialGradient>

    <!-- Drop Shadows for Optical Depth -->
    <filter id="panelDropShadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#663300" flood-opacity="0.36" />
      <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#4D2200" flood-opacity="0.24" />
    </filter>

    <filter id="tDropShadow" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#592800" flood-opacity="0.45" />
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#3D1800" flood-opacity="0.32" />
    </filter>

    <filter id="avatarDropShadow" x="-14%" y="-14%" width="128%" height="128%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.22" />
    </filter>
  </defs>

  ${bgLayer}

  <!-- Master Artwork Group -->
  <g transform="translate(${translate}, ${translate}) scale(${scale})">

    <!-- 1. LEFT PARTICIPANT PANEL (GOLDEN ORANGE SCREEN) -->
    <g filter="url(#panelDropShadow)">
      <!-- Outer Bevel Frame -->
      <path d="
        M 136, 310
        C 136, 255  165, 230  210, 245
        L 396, 315
        C 416, 322  428, 342  428, 364
        L 428, 638
        C 428, 660  416, 680  396, 687
        L 210, 757
        C 165, 772  136, 747  136, 692
        Z
      " fill="url(#leftFrameGrad)" />

      <!-- Inner Recessed Screen Surface -->
      <path d="
        M 152, 320
        C 152, 276  175, 256  212, 268
        L 384, 332
        C 400, 338  410, 354  410, 372
        L 410, 630
        C 410, 648  400, 664  384, 670
        L 212, 734
        C 175, 746  152, 726  152, 682
        Z
      " fill="url(#leftScreenGrad)" />

      <!-- White Silhouette (Participant 1) -->
      <g filter="url(#avatarDropShadow)">
        <circle cx="278" cy="435" r="64" fill="#FFFFFF" />
        <path d="
          M 186, 678
          C 186, 574  222, 516  278, 516
          C 334, 516  368, 574  368, 678
          C 342, 695  212, 695  186, 678
          Z
        " fill="#FFFFFF" />
      </g>
    </g>

    <!-- 2. RIGHT PARTICIPANT PANEL (DEEP PURPLE / INDIGO SCREEN) -->
    <g filter="url(#panelDropShadow)">
      <!-- Outer Bevel Frame -->
      <path d="
        M 888, 310
        C 888, 255  859, 230  814, 245
        L 628, 315
        C 608, 322  596, 342  596, 364
        L 596, 638
        C 596, 660  608, 680  628, 687
        L 814, 757
        C 859, 772  888, 747  888, 692
        Z
      " fill="url(#rightFrameGrad)" />

      <!-- Inner Recessed Screen Surface -->
      <path d="
        M 872, 320
        C 872, 276  849, 256  812, 268
        L 640, 332
        C 624, 338  614, 354  614, 372
        L 614, 630
        C 614, 648  624, 664  640, 670
        L 812, 734
        C 849, 746  872, 726  872, 682
        Z
      " fill="url(#rightScreenGrad)" />

      <!-- Top-Right Specular Diamond Star Glint -->
      <g opacity="0.95">
        <path d="
          M 856, 262
          Q 856, 285  879, 285
          Q 856, 285  856, 308
          Q 856, 285  833, 285
          Q 856, 285  856, 262
          Z
        " fill="#FFFFFF" />
        <circle cx="856" cy="285" r="18" fill="#C5CAE9" opacity="0.6" filter="blur(3px)" />
        <circle cx="856" cy="285" r="6" fill="#FFFFFF" />
      </g>

      <!-- White Silhouette (Participant 2) -->
      <g filter="url(#avatarDropShadow)">
        <circle cx="746" cy="435" r="64" fill="#FFFFFF" />
        <path d="
          M 656, 678
          C 656, 574  690, 516  746, 516
          C 802, 516  838, 574  838, 678
          C 812, 695  682, 695  656, 678
          Z
        " fill="#FFFFFF" />
      </g>
    </g>

    <!-- 3. CENTER TATHASTU 't' & SPHERE -->
    <g filter="url(#tDropShadow)">
      <!-- Golden 3D Sphere -->
      <circle cx="512" cy="355" r="56" fill="url(#sphereRadial)" stroke="#E65100" stroke-width="2.5" />

      <!-- Lowercase 't' with Sweeping Crossbar & Hooked Tail -->
      <path d="
        M 476, 420
        C 476, 412  484, 408  494, 408
        L 530, 408
        C 540, 408  548, 412  548, 420
        L 548, 456
        C 572, 454  602, 442  616, 422
        C 620, 416  628, 416  630, 424
        C 630, 432  622, 448  608, 466
        C 588, 490  562, 506  548, 508
        L 548, 626
        C 548, 664  570, 686  604, 682
        C 616, 680  628, 668  634, 654
        C 636, 648  644, 648  645, 654
        C 642, 678  618, 712  580, 712
        C 524, 712  476, 670  476, 612
        L 476, 508
        C 458, 506  426, 492  398, 466
        C 386, 454  388, 440  398, 438
        C 404, 436  412, 442  422, 452
        C 440, 470  458, 474  476, 474
        Z
      " fill="url(#tGrad)" stroke="#E65100" stroke-width="3.5" stroke-linejoin="round" />
    </g>

  </g>
</svg>`;
}

// Utility: Build multi-size Windows/Browser .ico binary
function createIco(images) {
  const count = images.length;
  const headerLen = 6;
  const dirEntryLen = 16;
  let offset = headerLen + dirEntryLen * count;

  const header = Buffer.alloc(headerLen);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = ICO format
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntryLen);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.buffer.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map(img => img.buffer)]);
}

// Generate the complete asset suite
export async function generateAllAssets() {
  console.log('Generating Tathastu Meet Master Brand Assets...');

  // Paths
  const masterSvgPath = path.resolve('packages/ui/src/assets/tathastu-meet-logo.svg');
  const webPublicDir = path.resolve('apps/web/public');
  const mobileAssetsDir = path.resolve('apps/mobile/assets');
  const androidResDir = path.resolve('apps/mobile/android/app/src/main/res');

  // Ensure directories exist
  [
    path.dirname(masterSvgPath),
    webPublicDir,
    mobileAssetsDir,
    path.join(androidResDir, 'mipmap-mdpi'),
    path.join(androidResDir, 'mipmap-hdpi'),
    path.join(androidResDir, 'mipmap-xhdpi'),
    path.join(androidResDir, 'mipmap-xxhdpi'),
    path.join(androidResDir, 'mipmap-xxxhdpi'),
    path.join(androidResDir, 'drawable-mdpi'),
    path.join(androidResDir, 'drawable-hdpi'),
    path.join(androidResDir, 'drawable-xhdpi'),
    path.join(androidResDir, 'drawable-xxhdpi'),
    path.join(androidResDir, 'drawable-xxxhdpi'),
  ].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // 1. Master SVGs
  const fullMasterSvg = createMasterSvg({ mode: 'full' });
  const symbolMasterSvg = createMasterSvg({ mode: 'symbol' });
  const adaptiveForegroundSvg = createMasterSvg({ mode: 'foreground', safePadding: 0.15 });
  const monochromeSvg = createMasterSvg({ mode: 'monochrome', safePadding: 0.15 });

  // Save SVGs
  fs.writeFileSync(masterSvgPath, fullMasterSvg);
  fs.writeFileSync(path.join(webPublicDir, 'icon.svg'), fullMasterSvg);
  fs.writeFileSync(path.join(webPublicDir, 'favicon.svg'), fullMasterSvg);
  fs.writeFileSync(path.join(webPublicDir, 'logo-symbol.svg'), symbolMasterSvg);
  fs.writeFileSync(path.join(mobileAssetsDir, 'logo-symbol.svg'), symbolMasterSvg);

  console.log('Saved Master SVGs.');

  // Pre-render master 1024x1024 buffers
  const full1024Buffer = await sharp(Buffer.from(fullMasterSvg)).png().toBuffer();
  const adaptiveFg1024Buffer = await sharp(Buffer.from(adaptiveForegroundSvg)).png().toBuffer();
  const symbol1024Buffer = await sharp(Buffer.from(symbolMasterSvg)).png().toBuffer();
  const monochrome1024Buffer = await sharp(Buffer.from(monochromeSvg)).png().toBuffer();

  // 2. Mobile / Expo Assets (`apps/mobile/assets/`)
  // icon.png: 1024x1024 opaque full-bleed for iOS and default fallback
  await sharp(full1024Buffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(mobileAssetsDir, 'icon.png'));

  // adaptive-icon.png: 1024x1024 transparent foreground safely inset for Android
  await sharp(adaptiveFg1024Buffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(mobileAssetsDir, 'adaptive-icon.png'));

  // splash.png: 1284x2778 splash screen with centered logo on #FAF9FC
  const splashLogo = await sharp(symbol1024Buffer)
    .resize(360, 360)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1284,
      height: 2778,
      channels: 4,
      background: { r: 250, g: 249, b: 252, alpha: 1 }, // #FAF9FC
    },
  })
    .composite([{ input: splashLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(mobileAssetsDir, 'splash.png'));

  // favicon.png: 48x48
  await sharp(full1024Buffer)
    .resize(48, 48)
    .png()
    .toFile(path.join(mobileAssetsDir, 'favicon.png'));

  console.log('Generated Expo mobile assets.');

  // 3. Android Native Launcher Resources (`apps/mobile/android/app/src/main/res/`)
  const densities = [
    { name: 'mdpi', size: 48, fgSize: 108 },
    { name: 'hdpi', size: 72, fgSize: 162 },
    { name: 'xhdpi', size: 96, fgSize: 216 },
    { name: 'xxhdpi', size: 144, fgSize: 324 },
    { name: 'xxxhdpi', size: 192, fgSize: 432 },
  ];

  for (const d of densities) {
    const mipmapDir = path.join(androidResDir, `mipmap-${d.name}`);
    const drawableDir = path.join(androidResDir, `drawable-${d.name}`);

    // A. ic_launcher.webp (Legacy square/squircle)
    await sharp(full1024Buffer)
      .resize(d.size, d.size)
      .webp({ quality: 100 })
      .toFile(path.join(mipmapDir, 'ic_launcher.webp'));

    // B. ic_launcher_round.webp (Legacy round)
    const circleMask = Buffer.from(
      `<svg width="${d.size}" height="${d.size}"><circle cx="${d.size/2}" cy="${d.size/2}" r="${d.size/2}" fill="#fff"/></svg>`
    );
    await sharp(full1024Buffer)
      .resize(d.size, d.size)
      .composite([{ input: circleMask, blend: 'dest-in' }])
      .webp({ quality: 100 })
      .toFile(path.join(mipmapDir, 'ic_launcher_round.webp'));

    // C. ic_launcher_foreground.webp (Adaptive Icon Foreground layer, 108dp)
    await sharp(adaptiveFg1024Buffer)
      .resize(d.fgSize, d.fgSize)
      .webp({ quality: 100 })
      .toFile(path.join(mipmapDir, 'ic_launcher_foreground.webp'));

    // D. ic_launcher_monochrome.webp (Android 13+ Themed Icons)
    await sharp(monochrome1024Buffer)
      .resize(d.fgSize, d.fgSize)
      .webp({ quality: 100 })
      .toFile(path.join(mipmapDir, 'ic_launcher_monochrome.webp'));

    // E. splashscreen_logo.png
    await sharp(symbol1024Buffer)
      .resize(Math.round(d.size * 1.5), Math.round(d.size * 1.5))
      .png()
      .toFile(path.join(drawableDir, 'splashscreen_logo.png'));
  }

  // Update Android color to warm gold: #FFB300
  const colorsXmlPath = path.join(androidResDir, 'values/colors.xml');
  const colorsXml = `<resources>
  <color name="splashscreen_background">#FAF9FC</color>
  <color name="iconBackground">#FFB300</color>
  <color name="colorPrimary">#F57C00</color>
  <color name="colorPrimaryDark">#FAF9FC</color>
</resources>
`;
  fs.writeFileSync(colorsXmlPath, colorsXml);

  // Play Store 512x512 Icon
  await sharp(full1024Buffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(androidResDir, '../../../playstore-icon-512.png'));
  await sharp(full1024Buffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(androidResDir, '../../../../playstore-icon-512.png'));

  console.log('Generated Android native launcher mipmap, monochrome & drawable assets.');

  // 4. Web & PWA Assets (`apps/web/public/`)
  const fav16 = await sharp(full1024Buffer).resize(16, 16).png().toBuffer();
  const fav32 = await sharp(full1024Buffer).resize(32, 32).png().toBuffer();
  const fav48 = await sharp(full1024Buffer).resize(48, 48).png().toBuffer();

  fs.writeFileSync(path.join(webPublicDir, 'favicon-16x16.png'), fav16);
  fs.writeFileSync(path.join(webPublicDir, 'favicon-32x32.png'), fav32);
  fs.writeFileSync(path.join(webPublicDir, 'favicon-48x48.png'), fav48);

  // Multi-resolution true ICO file (16, 32, 48)
  const multiIco = createIco([
    { width: 16, height: 16, buffer: fav16 },
    { width: 32, height: 32, buffer: fav32 },
    { width: 48, height: 48, buffer: fav48 },
  ]);
  fs.writeFileSync(path.join(webPublicDir, 'favicon.ico'), multiIco);

  // apple-touch-icon.png (180x180)
  await sharp(full1024Buffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(webPublicDir, 'apple-touch-icon.png'));

  // android-chrome-192x192.png
  await sharp(full1024Buffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(webPublicDir, 'android-chrome-192x192.png'));

  // android-chrome-512x512.png
  await sharp(full1024Buffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(webPublicDir, 'android-chrome-512x512.png'));

  // maskable-icon-512x512.png (with 15% safe padding)
  const maskableSvg = createMasterSvg({ mode: 'full', safePadding: 0.12 });
  await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(webPublicDir, 'maskable-icon-512x512.png'));

  // site.webmanifest & manifest.json
  const webManifest = {
    name: 'Tathastu Meet',
    short_name: 'Meet',
    description: 'Fast, high-fidelity real-time video meetings and collaboration.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFB300',
    theme_color: '#FFB300',
    icons: [
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };

  fs.writeFileSync(
    path.join(webPublicDir, 'site.webmanifest'),
    JSON.stringify(webManifest, null, 2)
  );
  fs.writeFileSync(
    path.join(webPublicDir, 'manifest.json'),
    JSON.stringify(webManifest, null, 2)
  );

  console.log('Generated Web & PWA assets and manifests.');
}

if (process.argv[1] && process.argv[1].endsWith('generate_brand_assets.mjs')) {
  generateAllAssets().catch(console.error);
}
