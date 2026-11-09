// The browser C++ compiler is cached by the lab worker and by the service worker under one
// versioned name. If the two disagree, the 105 MB download is stored twice or never reused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runner = readFileSync(new URL('../features/lab/runtimes/cppBrowser.ts', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const version = (src) => src.match(/const CLANG_VERSION = '([^']+)'/)?.[1];

test('service worker and runner pin the same compiler version', () => {
  assert.ok(version(runner), 'runner has a pinned version');
  assert.equal(version(sw), version(runner));
  assert.match(version(runner), /^\d/, 'a fixed version, never a tag like latest');
});

test('both cache under the same versioned name and base URL', () => {
  for (const src of [runner, sw]) {
    assert.match(src, /tm-clang-\$\{CLANG_VERSION\}/);
    assert.match(src, /https:\/\/cdn\.jsdelivr\.net\/npm\/@yowasp\/clang@\$\{CLANG_VERSION\}\/gen\//);
  }
});

test('the service worker keeps the compiler cache when it cleans up old caches', () => {
  assert.match(sw, /k !== CLANG\)/);
});

test('the service worker still never caches API responses or page HTML', () => {
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)[^\n]*return;/);
  assert.match(sw, /request\.mode === 'navigate'[\s\S]*?fetch\(request\)\.catch/);
});
