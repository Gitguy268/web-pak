// Makes the README pictures in docs/: screenshot.png (an archive open with a preview), compress.png,
// tools.png, themes.png and demo.webp. Needs a built app/, ImageMagick (magick) and img2webp.
// Run: npm run build && npm run capture
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const tmp = mkdtempSync(join(tmpdir(), 'web-pak-capture-'));
const port = 5600 + Math.floor(Math.random() * 300);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '-d', join(root, 'app')], { stdio: 'ignore' });

// a little project to compress: text, code, markdown and an image
const proj = join(tmp, 'holiday-photos'); mkdirSync(join(proj, 'notes'), { recursive: true });
copyFileSync(join(docs, 'logo.png'), join(proj, 'box.png'));
writeFileSync(join(proj, 'notes', 'packing-list.md'), '# Packing list\n\n- passport\n- **sun cream**\n- charger\n\n> Leave on Friday at 9.\n');
writeFileSync(join(proj, 'notes', 'itinerary.txt'), 'Day 1  Amsterdam → Utrecht\nDay 2  Utrecht → Den Bosch\nDay 3  Den Bosch → Maastricht\n'.repeat(4));
writeFileSync(join(proj, 'budget.json'), JSON.stringify({ trains: 84.5, hotels: 312, food: 150, museums: 46 }, null, 2));
writeFileSync(join(proj, 'convert.py'), 'def euros(cents: int) -> str:\n    # format cents as euros\n    return f"€{cents / 100:.2f}"\n\nprint(euros(1999))\n');

await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('#app:not([hidden])');
const frames = []; let fi = 0;
const frame = async (n = 1) => { for (let i = 0; i < n; i++) { const f = join(tmp, `f${String(fi++).padStart(3, '0')}.png`); await page.screenshot({ path: f }); frames.push(f); } };
const shot = (name) => page.screenshot({ path: join(tmp, name) });

await frame(6);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pickFolder')]);
await fc.setFiles(proj);
await page.waitForSelector('#v-compress:not([hidden])');
await page.selectOption('#oFormat', '7z');
await page.fill('#oPassword', 'blue-otter-lantern-42');
await page.check('#oNames'); await page.dispatchEvent('#oPassword', 'input');
await frame(8);
await shot('compress.png');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doCompress')]);
const archive = join(tmp, dl.suggestedFilename()); await dl.saveAs(archive);
await page.waitForTimeout(300); await frame(6);

await page.click('nav button[data-view="home"]');
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pickArchive')]);
await fc2.setFiles(archive);
await page.waitForSelector('dialog[open]'); await page.fill('dialog input[name="pw"]', 'blue-otter-lantern-42'); await frame(4);
await page.click('dialog button[value="ok"]');
await page.waitForSelector('#table tbody tr');
await page.click('#tree div:text-is("📁 holiday-photos")');
await page.waitForTimeout(200); await frame(4);
await page.click('#table tbody tr:has-text("box.png")'); await page.waitForSelector('#preview img'); await page.waitForTimeout(300); await frame(8);
await page.click('#tree div:text-is("📁 notes")'); await page.waitForTimeout(150);
await page.click('#table tbody tr:has-text("packing-list.md")'); await page.waitForSelector('#preview .md'); await frame(8);
await shot('screenshot.png');
await page.click('#tree div:text-is("📁 holiday-photos")'); await page.waitForTimeout(150);
await page.click('#table tbody tr:has-text("convert.py")'); await page.waitForSelector('#preview .tok-k'); await frame(8);

await page.click('nav button[data-view="tools"]'); await page.click('.tabs button[data-tab="sums"]');
const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('#sumPick')]);
await fc3.setFiles(archive);
await page.waitForSelector('#sumTable tr'); await frame(6);
await shot('tools.png');

// the four looks, home view
const looks = [];
for (const th of ['light', 'dark', 'keka', 'terminal']) {
  await page.selectOption('#themeSel', th); await page.click('nav button[data-view="compress"]'); await page.waitForTimeout(150);
  const f = join(tmp, `look-${th}.png`); await page.screenshot({ path: f }); looks.push(f);
}
await browser.close(); server.kill();

const m = (...a) => execFileSync('magick', a, { stdio: 'inherit' });
for (const n of ['screenshot', 'compress', 'tools']) m(join(tmp, `${n}.png`), '-resize', '1600x', '-strip', join(docs, `${n}.png`));
m('montage', ...looks, '-tile', '2x', '-geometry', '800x506+4+4', '-background', '#888', join(docs, 'themes.png'));
const small = frames.map(f => { const o = f.replace('.png', '-s.png'); m(f, '-resize', '900x', o); return o; });
execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '70', '-d', '160', ...small, '-o', join(docs, 'demo.webp')], { stdio: 'inherit' });

rmSync(tmp, { recursive: true, force: true });
console.log('docs/ updated');
