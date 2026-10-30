// Probe the deployed-style build in a real browser: which web mode is chosen, what the gate says,
// and which request answers 501 when "read from device" is attempted.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/insn/repos/stack/Axis/build';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]); if (url.startsWith('/axis/live')) url = url.slice('/axis/live'.length) || '/';
  let p = path.join(ROOT, url);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

await new Promise((r) => server.listen(8099, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const log = [];
page.on('console', (m) => log.push(`CONSOLE ${m.type()}: ${m.text()}`.slice(0, 300)));
page.on('response', (r) => { if (r.status() !== 200 || r.url().includes('/api/')) log.push(`API ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
page.on('requestfailed', (r) => log.push(`FAILED ${r.url().slice(0, 120)}`));

await page.goto('http://127.0.0.1:8099/axis/live/?mode=direct', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200));
console.log('URL', page.url());
console.log('SERIAL?', await page.evaluate(() => !!navigator.serial), 'MIDI?', await page.evaluate(() => 'requestMIDIAccess' in navigator));
console.log('TEXT:', body);
console.log('--- events');
console.log(log.join('\n').slice(0, 3000));
await browser.close();
server.close();
