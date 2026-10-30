import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function verifyAllAssets() {
  console.log('--- AUDITING TATHASTU MEET BRAND ASSETS ---');
  let errors = 0;

  const checks = [
    // Web / PWA Assets
    { file: 'apps/web/public/favicon.ico', minSize: 1000 },
    { file: 'apps/web/public/favicon.svg', minSize: 1000 },
    { file: 'apps/web/public/icon.svg', minSize: 1000 },
    { file: 'apps/web/public/logo-symbol.svg', minSize: 1000 },
    { file: 'apps/web/public/favicon-16x16.png', w: 16, h: 16 },
    { file: 'apps/web/public/favicon-32x32.png', w: 32, h: 32 },
    { file: 'apps/web/public/favicon-48x48.png', w: 48, h: 48 },
    { file: 'apps/web/public/apple-touch-icon.png', w: 180, h: 180 },
    { file: 'apps/web/public/android-chrome-192x192.png', w: 192, h: 192 },
    { file: 'apps/web/public/android-chrome-512x512.png', w: 512, h: 512 },
    { file: 'apps/web/public/maskable-icon-512x512.png', w: 512, h: 512 },
    { file: 'apps/web/public/site.webmanifest', isJson: true },
    { file: 'apps/web/public/manifest.json', isJson: true },

    // Mobile / Expo Assets
    { file: 'apps/mobile/assets/icon.png', w: 1024, h: 1024 },
    { file: 'apps/mobile/assets/adaptive-icon.png', w: 1024, h: 1024, hasAlpha: true },
    { file: 'apps/mobile/assets/splash.png', w: 1284, h: 2778 },
    { file: 'apps/mobile/assets/favicon.png', w: 48, h: 48 },
    { file: 'apps/mobile/assets/logo-symbol.svg', minSize: 1000 },

    // Master Vector
    { file: 'packages/ui/src/assets/tathastu-meet-logo.svg', minSize: 1000 },

    // Android Native Launcher Mipmaps (Legacy, Adaptive FG, and Monochrome)
    { file: 'apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher.webp', w: 48, h: 48 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp', w: 48, h: 48 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp', w: 108, h: 108 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp', w: 108, h: 108 },

    { file: 'apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher.webp', w: 72, h: 72 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp', w: 72, h: 72 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp', w: 162, h: 162 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp', w: 162, h: 162 },

    { file: 'apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp', w: 96, h: 96 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp', w: 96, h: 96 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp', w: 216, h: 216 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp', w: 216, h: 216 },

    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp', w: 144, h: 144 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp', w: 144, h: 144 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp', w: 324, h: 324 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp', w: 324, h: 324 },

    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp', w: 192, h: 192 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp', w: 192, h: 192 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp', w: 432, h: 432 },
    { file: 'apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp', w: 432, h: 432 },

    // Play Store Icon
    { file: 'apps/mobile/android/app/playstore-icon-512.png', w: 512, h: 512 },
  ];

  for (const c of checks) {
    const fullPath = path.resolve(c.file);
    if (!fs.existsSync(fullPath)) {
      console.error(`MISSING: ${c.file}`);
      errors++;
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      console.error(`EMPTY FILE: ${c.file}`);
      errors++;
      continue;
    }

    if (c.w && c.h) {
      try {
        const meta = await sharp(fullPath).metadata();
        if (meta.width !== c.w || meta.height !== c.h) {
          console.error(`DIMENSION MISMATCH: ${c.file} expected ${c.w}x${c.h}, got ${meta.width}x${meta.height}`);
          errors++;
        }
        if (c.hasAlpha && !meta.hasAlpha) {
          console.error(`MISSING ALPHA: ${c.file} requires alpha transparency`);
          errors++;
        }
      } catch (err) {
        console.error(`FAILED TO READ IMAGE: ${c.file}`, err.message);
        errors++;
      }
    }

    if (c.isJson) {
      try {
        JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch (err) {
        console.error(`INVALID JSON: ${c.file}`);
        errors++;
      }
    }
  }

  // Check Android XML configurations
  const icLauncherXml = fs.readFileSync(path.resolve('apps/mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
  if (!icLauncherXml.includes('ic_launcher_foreground') || !icLauncherXml.includes('ic_launcher_monochrome')) {
    console.error('ic_launcher.xml missing foreground or monochrome tag');
    errors++;
  }

  const colorsXml = fs.readFileSync(path.resolve('apps/mobile/android/app/src/main/res/values/colors.xml'), 'utf8');
  if (!colorsXml.includes('#FFB300')) {
    console.error('colors.xml missing golden iconBackground color #FFB300');
    errors++;
  }

  if (errors === 0) {
    console.log(`\nALL ${checks.length} BRAND ASSETS AUDITED & VERIFIED SUCCESSFULLY!`);
  } else {
    console.error(`\nFAILED: ${errors} errors detected in brand assets.`);
    process.exit(1);
  }
}

verifyAllAssets().catch(err => {
  console.error(err);
  process.exit(1);
});
