// Plays every catalogue video in a real browser through the same embed the site uses.
// Run: PLAYWRIGHT_PATH=... node tests/embeds.mjs
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4197;
const BASE = `http://127.0.0.1:${PORT}/`;
const WORKERS = 4;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

// Playwright's Chromium has no H.264, so videos offered only in H.264 need a full browser.
// BROWSER_PATH points at one, and Playwright gives it a temporary profile.
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const boot = await browser.newPage();
await boot.goto(BASE);
const only = process.env.ONLY_IDS ? new Set(process.env.ONLY_IDS.split(/\s+/)) : null;
const videos = (await boot.evaluate(() => window.COGTUBE.videos.map((v) => ({ id: v.id, title: v.title }))))
  .filter((v) => !only || only.has(v.id));
await boot.close();

const results = [];
let next = 0;

async function probe(page, v) {
  await page.evaluate((id) => { location.hash = `#/watch/${id}`; }, v.id);
  await page.waitForSelector('#yt-frame', { timeout: 15000 });
  await page.waitForTimeout(1800);
  const frame = page.frames().find((f) => f.url().includes(`/embed/${v.id}`));
  if (!frame) return { status: 'no-frame' };
  const box = await page.locator('#yt-frame').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let last = {};
  for (let i = 0; i < 16; i += 1) {
    await page.waitForTimeout(700);
    last = await frame.evaluate(() => {
      const video = document.querySelector('video');
      const error = document.querySelector('.ytp-error');
      return {
        time: video ? video.currentTime : -1,
        error: error && getComputedStyle(error).display !== 'none' ? error.innerText.slice(0, 120) : '',
      };
    }).catch((e) => ({ time: -1, error: `eval: ${e.message.slice(0, 80)}` }));
    if (last.error) return { status: 'error', detail: last.error };
    if (last.time > 0.3) return { status: 'plays' };
  }
  return { status: 'no-progress', detail: JSON.stringify(last) };
}

async function worker() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE);
  while (next < videos.length) {
    const v = videos[next];
    next += 1;
    let outcome;
    try { outcome = await probe(page, v); } catch (e) { outcome = { status: 'exception', detail: e.message.slice(0, 120) }; }
    // A second try separates a flaky load from a video that truly fails.
    if (outcome.status !== 'plays') {
      try {
        await page.evaluate(() => { location.hash = '#/'; });
        await page.waitForTimeout(400);
        outcome = await probe(page, v);
      } catch { /* Keep the first outcome. */ }
    }
    const image = await page.evaluate((id) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => resolve(0);
      img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }), v.id);
    results.push({ ...v, ...outcome, image });
    if (results.length % 40 === 0) console.log(`${results.length}/${videos.length}`);
    await page.evaluate(() => { location.hash = '#/'; });
  }
  await context.close();
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close();
server.kill();

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1;
console.log('playback:', JSON.stringify(tally));
console.log('thumbnails under 320px:', results.filter((r) => r.image < 320).map((r) => r.id).join(' ') || 'none');
for (const r of results.filter((x) => x.status !== 'plays')) {
  console.log(`${r.status} ${r.id} ${r.title.slice(0, 50)} :: ${r.detail || ''}`);
}
