// End-to-end test of the built app (app/) in Chromium: choose files, make an encrypted 7z, open it
// with the password, preview a file, extract everything, test it, hash a file, switch language
// and theme. Fails on console errors. Run: npm run build && npm run e2e
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'web-pak-e2e-'));
const port = 5200 + Math.floor(Math.random() * 400);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '-d', join(root, 'app')], { stdio: 'ignore' });
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); else if (process.env.VERBOSE) console.log('ok', msg); };
const has7zz = (() => { try { execFileSync('7zz', ['i'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// sample files
writeFileSync(join(tmp, 'hello.txt'), 'Hello from web-pak!\n'.repeat(50));
writeFileSync(join(tmp, 'notes.md'), '# Notes\n\n- one\n- **two**\n');
writeFileSync(join(tmp, 'data.json'), JSON.stringify({ spot: 'black lab', collar: 'red' }, null, 2));

let browser;
try {
  await new Promise(r => setTimeout(r, 600));
  browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('#app:not([hidden])');
  check(await page.title() === 'web-pak', 'title');

  // 1. choose files -> compress view
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pickFiles')]);
  await fc.setFiles(['hello.txt', 'notes.md', 'data.json'].map(f => join(tmp, f)));
  await page.waitForSelector('#v-compress:not([hidden])');
  check((await page.locator('#itemList li').count()) === 3, 'three items listed');

  // 2. encrypted 7z with hidden names
  await page.selectOption('#oFormat', '7z');
  await page.fill('#oName', 'e2e');
  await page.fill('#oPassword', 'pw-123');
  await page.check('#oNames');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#doCompress')]);
  const archive = join(tmp, dl.suggestedFilename());
  await dl.saveAs(archive);
  check(dl.suggestedFilename() === 'e2e.7z', `archive name ${dl.suggestedFilename()}`);
  if (has7zz) {
    check(execFileSync('7zz', ['t', '-ppw-123', archive]).toString().includes('Everything is Ok'), '7zz tests the archive');
    let leaked = true; try { execFileSync('7zz', ['l', '-pwrong', archive], { stdio: 'pipe' }); } catch { leaked = false; }
    check(!leaked, 'names are hidden without the password');
  }

  // 3. open it: password prompt, listing
  await page.click('nav button[data-view="home"]');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pickArchive')]);
  await fc2.setFiles(archive);
  await page.waitForSelector('dialog[open]');
  await page.fill('dialog input[name="pw"]', 'pw-123');
  await page.click('dialog button[value="ok"]');
  await page.waitForSelector('#archiveView:not([hidden])');
  await page.waitForSelector('#table tbody tr');
  check((await page.locator('#table tbody tr').count()) === 3, 'three entries in the archive');

  // 4. preview a text file and the markdown file
  await page.click('#table tbody tr:has-text("hello.txt")');
  await page.waitForSelector('#preview pre');
  check((await page.textContent('#preview pre')).includes('Hello from web-pak!'), 'text preview');
  await page.click('#table tbody tr:has-text("notes.md")');
  await page.waitForSelector('#preview .md li');
  check((await page.textContent('#preview .md')).includes('two'), 'markdown preview');

  // 5. test, then extract all (several files and no folder picked -> one stored zip)
  await page.click('#aTest');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('✓'));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#aExtract')]);
  const zip = join(tmp, dl2.suggestedFilename());
  await dl2.saveAs(zip);
  check(dl2.suggestedFilename() === 'e2e.zip', `extracted bundle ${dl2.suggestedFilename()}`);
  if (has7zz) {
    const out = join(tmp, 'x'); execFileSync('7zz', ['x', zip, `-o${out}`, '-y'], { stdio: 'ignore' });
    const hello = readFileSync(join(out, 'e2e', 'hello.txt'), 'utf8');
    check(hello === 'Hello from web-pak!\n'.repeat(50), 'extracted bytes match (inside a smart folder)');
  }

  // 6. checksum tool
  await page.click('nav button[data-view="tools"]');
  await page.click('.tabs button[data-tab="sums"]');
  const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('#sumPick')]);
  await fc3.setFiles(join(tmp, 'hello.txt'));
  await page.waitForSelector('#sumTable tr');
  const want = createHash('sha256').update(readFileSync(join(tmp, 'hello.txt'))).digest('hex');
  check((await page.textContent('#sumTable')).includes(want), 'SHA-256 matches Node');

  // 7. password generator, age keys, language and theme
  await page.click('.tabs button[data-tab="pw"]'); await page.click('#pwGen');
  check(((await page.textContent('#pwOut')) || '').length >= 20, 'password generated');
  await page.click('.tabs button[data-tab="keys"]'); await page.click('#keyGen');
  await page.waitForSelector('#keyOut code');
  check((await page.textContent('#keyOut code')).startsWith('age1'), 'age public key');
  await page.selectOption('#langSel', 'nl');
  check((await page.textContent('nav button[data-view="compress"]')) === 'Comprimeren', 'Dutch labels');
  await page.selectOption('#langSel', 'en');
  for (const th of ['dark', 'keka', 'terminal', 'light']) { await page.selectOption('#themeSel', th); check(await page.evaluate(() => document.documentElement.dataset.theme) === th, `theme ${th}`); }

  // 8. tar.zst round trip through the UI
  await page.click('nav button[data-view="compress"]');
  await page.selectOption('#oFormat', 'tar.zst');
  await page.fill('#oPassword', '');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#doCompress')]);
  check(dl3.suggestedFilename() === 'e2e.tar.zst', `zstd tarball ${dl3.suggestedFilename()}`);
  const tzst = join(tmp, dl3.suggestedFilename()); await dl3.saveAs(tzst);
  const [fc4] = await Promise.all([page.waitForEvent('filechooser'), page.click('nav button[data-view="home"]').then(() => page.click('#pickArchive'))]);
  await fc4.setFiles(tzst);
  await page.waitForSelector('#archiveView:not([hidden]) #table tbody tr:has-text("data.json")');
  check((await page.textContent('#arcInfo')).includes('zstd'), 'zstd layer shown');
} catch (e) {
  problems.push(`exception: ${e.message}`);
  try { problems.push('jobs: ' + (await browser.contexts()[0].pages()[0].textContent('#jobList'))); } catch { /* no page */ }
} finally {
  await browser?.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
if (problems.length) { console.error([...new Set(problems)].join('\n')); process.exit(1); }
console.log(`ok: compress (7z + AES, tar.zst), open with password, preview, test, extract, checksums, passwords, age keys, NL, 4 themes${has7zz ? ', checked with 7zz' : ''}`);
