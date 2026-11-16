// Copies NOTICE into the build and stamps app/index.html with a hash of the sources, so CI can
// tell whether the committed build is current (`--check`) without comparing bytes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check as checkVendor } from './vendor-7z.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const files = [];
const walk = d => readdirSync(d).sort().forEach(f => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk(join(root, 'src')); walk(join(root, 'public'));
files.push(join(root, 'index.html'), join(root, 'vite.config.ts'));
const h = createHash('sha256');
for (const f of files) { if (/\.test\.ts$/.test(f)) continue; h.update(relative(root, f)); h.update(readFileSync(f)); }
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const deps = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies).sort();
h.update(JSON.stringify(deps.map(d => [d, lock.packages?.[`node_modules/${d}`]?.version])));
const stamp = h.digest('hex').slice(0, 16), tag = `<meta name="source-hash" content="${stamp}">`;
const page = join(root, 'app/index.html');
if (process.argv.includes('--check')) {
  if (!readFileSync(page, 'utf8').includes(tag)) { console.error(`app/ is out of date (sources ${stamp}). Run npm run build and commit app/.`); process.exit(1); }
  // 7-Zip must ship byte-for-byte as published, in public/ and in the build
  const bad = [...checkVendor(), ...checkVendor(join(root, 'app/vendor/7z-wasm')).map(f => `app/${f}`)];
  if (bad.length) { console.error(`7z-wasm files differ from node_modules: ${bad.join(', ')}`); process.exit(1); }
  console.log(`app/ matches the sources (${stamp})`);
} else {
  writeFileSync(page, readFileSync(page, 'utf8').replace('<head>', `<head>\n${tag}`));
  copyFileSync(join(root, 'NOTICE'), join(root, 'app/NOTICE.txt'));
  console.log(`app/ stamped (${stamp})`);
}
