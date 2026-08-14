import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

// This is a local N -> N+1 acceptance test. It never contacts a provider and
// never reads a credential. The active server root is switched only after the
// first service worker controls the page.
const dist = resolve(process.cwd(), 'dist');
assert.ok(existsSync(join(dist, 'index.html')), 'Run npm run build before qa:pwa-update');
const tempRoot = await mkdtemp(join(tmpdir(), 'idp-lab-pwa-update-'));
const v1 = join(tempRoot, 'v1');
const v2 = join(tempRoot, 'v2');
await cp(dist, v1, { recursive: true });
await cp(dist, v2, { recursive: true });

const indexV2 = await readFile(join(v2, 'index.html'), 'utf8');
await writeFile(join(v1, 'index.html'), indexV2.replace('</head>', '<meta name="pwa-test-version" content="v1"></head>'));
await writeFile(join(v2, 'index.html'), indexV2.replace('</head>', '<meta name="pwa-test-version" content="v2"></head>'));

// Workbox uses the revision list to decide whether a new worker is waiting.
// Change one revision in the isolated N+1 copy; production assets remain
// immutable and no generated file in the repository is modified.
const swV2 = await readFile(join(v2, 'sw.js'), 'utf8');
const revisionMatch = swV2.match(/url:"index\.html",revision:"([a-f0-9]+)"/i);
assert.ok(revisionMatch, 'Generated service worker should contain revisioned precache entries');
const changedRevision = `${revisionMatch[1].slice(0, -1)}${revisionMatch[1].endsWith('0') ? '1' : '0'}`;
await writeFile(join(v2, 'sw.js'), swV2.replace(revisionMatch[1], changedRevision));

let activeRoot = v1;
const contentTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const file = normalize(join(activeRoot, relative));
    if (!file.startsWith(`${activeRoot}${sep}`) && file !== join(activeRoot, 'index.html')) { response.writeHead(400); response.end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/`;
const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A first install does not control the initial navigation. Reload once so
  // version N is genuinely active before the N+1 update is introduced.
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'Version N should control the page before update testing');
  assert.equal(await page.locator('#pwaUpdateBanner').isVisible(), false, 'N+1 prompt should be hidden before an update exists');

  activeRoot = v2;
  await page.evaluate(() => navigator.serviceWorker.ready.then((registration) => registration.update()));
  await page.waitForFunction(() => !document.querySelector('#pwaUpdateBanner')?.hidden, null, { timeout: 20000 });
  assert.equal(await page.locator('#pwaUpdateButton').isDisabled(), false, 'Update action should be enabled before confirmation');
  await page.locator('#pwaUpdateButton').click();
  await page.waitForFunction(() => !document.querySelector('#pwaUpdateOverlay')?.hidden, null, { timeout: 3000 });
  try {
    await page.waitForFunction(() => document.querySelector('meta[name="pwa-test-version"]')?.content === 'v2', null, { timeout: 20000 });
  } catch (error) {
    const diagnostics = await page.evaluate(async () => ({
      url: location.href,
      version: document.querySelector('meta[name="pwa-test-version"]')?.content || 'none',
      bannerHidden: document.querySelector('#pwaUpdateBanner')?.hidden,
      overlayHidden: document.querySelector('#pwaUpdateOverlay')?.hidden,
      registration: await navigator.serviceWorker.ready.then((registration) => ({ waiting: Boolean(registration.waiting), active: registration.active?.scriptURL || '', controller: navigator.serviceWorker.controller?.scriptURL || '' })),
      caches: await caches.keys()
    }));
    console.error('PWA update diagnostics:', JSON.stringify(diagnostics));
    throw error;
  }
  assert.deepEqual(errors, [], `PWA update browser errors: ${errors.join(' | ')}`);
  await context.close();
  console.log('PWA prompt update N→N+1: pass');
  console.log('Update loader and retry UI contract: pass');
} finally {
  await browser.close();
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(tempRoot, { recursive: true, force: true });
}
