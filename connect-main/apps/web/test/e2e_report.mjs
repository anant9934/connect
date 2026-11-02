// What each open page shows when a journey fails, since CI logs are not always readable.
export async function describePages(browser) {
  const lines = [];
  for (const page of await browser.pages()) {
    if (page.url() === 'about:blank') continue;
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '(page closed)');
    lines.push(`PAGE ${page.url()} :: ${text.replace(/\s+/g, ' ').slice(0, 350)}`);
  }
  return lines;
}
