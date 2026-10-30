import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');

describe('Tathastu Meet — SEO, AEO & Security Quality Gates', () => {
  test('1. Security Headers & Configuration in next.config.mjs', async () => {
    const configPath = path.join(webRoot, 'next.config.mjs');
    assert.ok(fs.existsSync(configPath), 'next.config.mjs must exist');
    const { default: nextConfig } = await import(`file://${configPath.replace(/\\/g, '/')}`);

    assert.equal(nextConfig.poweredByHeader, false, 'X-Powered-By must be disabled');
    assert.equal(nextConfig.productionBrowserSourceMaps, false, 'Browser source maps must be disabled in production');

    const headersList = await nextConfig.headers();
    assert.ok(Array.isArray(headersList), 'headers must return an array');

    // Root catch-all headers
    const rootHeaders = headersList.find((h) => h.source === '/:path*');
    assert.ok(rootHeaders, 'Root /:path* headers must be configured');
    const rootHeaderMap = Object.fromEntries(rootHeaders.headers.map((h) => [h.key, h.value]));

    assert.equal(rootHeaderMap['X-Content-Type-Options'], 'nosniff');
    assert.equal(rootHeaderMap['X-Frame-Options'], 'DENY');
    assert.equal(rootHeaderMap['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(rootHeaderMap['X-DNS-Prefetch-Control'], 'on');
    assert.ok(rootHeaderMap['Strict-Transport-Security']?.includes('max-age='), 'HSTS must be enabled');
    assert.ok(rootHeaderMap['Content-Security-Policy']?.includes("frame-ancestors 'none'"), 'CSP must deny frame ancestors');

    // Private /room/:path* headers
    const roomHeaders = headersList.find((h) => h.source === '/room/:path*');
    assert.ok(roomHeaders, 'Private /room/:path* headers must be configured');
    const roomHeaderMap = Object.fromEntries(roomHeaders.headers.map((h) => [h.key, h.value]));
    assert.ok(roomHeaderMap['X-Robots-Tag']?.includes('noindex'), '/room routes must enforce noindex');
    assert.ok(roomHeaderMap['Cache-Control']?.includes('no-store'), '/room routes must enforce private no-store cache');

    // Private /history/:path* headers
    const historyHeaders = headersList.find((h) => h.source === '/history/:path*');
    assert.ok(historyHeaders, 'Private /history/:path* headers must be configured');
    const historyHeaderMap = Object.fromEntries(historyHeaders.headers.map((h) => [h.key, h.value]));
    assert.ok(historyHeaderMap['X-Robots-Tag']?.includes('noindex'), '/history routes must enforce noindex');
    assert.ok(historyHeaderMap['Cache-Control']?.includes('no-store'), '/history routes must enforce private no-store cache');
  });

  test('2. Robots Directives in app/robots.ts', async () => {
    const robotsPath = path.join(webRoot, 'app', 'robots.ts');
    assert.ok(fs.existsSync(robotsPath), 'app/robots.ts must exist');
    const content = fs.readFileSync(robotsPath, 'utf8');

    assert.ok(content.includes("disallow: ["), 'robots.ts must define disallow rules');
    assert.ok(content.includes("'/room/'"), 'robots.ts must disallow /room/');
    assert.ok(content.includes("'/history'"), 'robots.ts must disallow /history');
    assert.ok(content.includes("'/api/'"), 'robots.ts must disallow /api/');
    assert.ok(content.includes("sitemap:"), 'robots.ts must link sitemap.xml');
  });

  test('3. Dynamic Sitemap in app/sitemap.ts', async () => {
    const sitemapPath = path.join(webRoot, 'app', 'sitemap.ts');
    assert.ok(fs.existsSync(sitemapPath), 'app/sitemap.ts must exist');
    const content = fs.readFileSync(sitemapPath, 'utf8');

    // Must include all approved public pages
    const expectedRoutes = [
      "path: ''",
      "path: '/features'",
      "path: '/security'",
      "path: '/rooms'",
      "path: '/rooms/research'",
      "path: '/rooms/projects'",
      "path: '/rooms/mentorship'",
      "path: '/use-cases/students'",
      "path: '/use-cases/researchers'",
      "path: '/use-cases/teams'",
      "path: '/compare/zoom-alternative'",
      "path: '/compare/google-meet-alternative'",
      "path: '/sign-in'",
      "path: '/sign-up'",
    ];

    for (const route of expectedRoutes) {
      assert.ok(content.includes(route), `sitemap must include route ${route}`);
    }

    // Must NOT contain private routes
    assert.ok(!content.includes("'/room'"), 'sitemap must NEVER include private meeting rooms');
    assert.ok(!content.includes("'/history'"), 'sitemap must NEVER include meeting history');
  });

  test('4. Root Layout Branding & Metadata Consistency', () => {
    const layoutPath = path.join(webRoot, 'app', 'layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf8');

    assert.ok(content.includes("default: 'Tathastu Meet | Video Meetings & Real-Time Collaboration'"));
    assert.ok(content.includes("template: '%s | Tathastu Meet'"));
    assert.ok(content.includes("siteName: 'Tathastu Meet'"));
    assert.ok(content.includes("application/ld+json"), 'JSON-LD structured data must be embedded in root layout');
    assert.ok(content.includes("SoftwareApplication"), 'SoftwareApplication schema must be present');
    assert.ok(content.includes("Organization"), 'Organization schema must be present');
  });

  test('5. Private Room & History Layout Metadata Protection', () => {
    const roomLayout = path.join(webRoot, 'app', 'room', 'layout.tsx');
    assert.ok(fs.existsSync(roomLayout), 'app/room/layout.tsx must exist');
    const roomContent = fs.readFileSync(roomLayout, 'utf8');
    assert.ok(roomContent.includes("index: false"), 'room layout must set robots.index to false');
    assert.ok(roomContent.includes("follow: false"), 'room layout must set robots.follow to false');

    const historyLayout = path.join(webRoot, 'app', 'history', 'layout.tsx');
    assert.ok(fs.existsSync(historyLayout), 'app/history/layout.tsx must exist');
    const historyContent = fs.readFileSync(historyLayout, 'utf8');
    assert.ok(historyContent.includes("index: false"), 'history layout must set robots.index to false');
  });

  test('6. Secret Scanning in Static Client Chunks', () => {
    const staticDir = path.join(webRoot, '.next', 'static');
    if (!fs.existsSync(staticDir)) {
      return; // Skip if build hasn't run yet
    }

    function scanFiles(dir) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanFiles(fullPath);
        } else if (file.endsWith('.js')) {
          const js = fs.readFileSync(fullPath, 'utf8');
          assert.ok(!js.includes('b0Sx4tcYmsOTfLuBdP668fMjgmQ6vi1ecGDYCAyJ4fuC'), 'LiveKit API secret leaked in client bundle!');
          assert.ok(!js.includes('APIthtswjdmJvEz'), 'LiveKit API key leaked in client bundle!');
        } else if (file.endsWith('.map')) {
          assert.fail(`Source map file found in production client bundle: ${file}`);
        }
      }
    }

    scanFiles(staticDir);
  });
});
