// Copies 7z-wasm (7-Zip, LGPL-2.1 + unRAR restriction) unchanged into public/vendor/7z-wasm, with
// its licence files, so the app loads it as its own files instead of bundling it with MIT code.
// `--check` fails when the copies differ from node_modules (CI runs it through stamp.mjs).
import { copyFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const src = join(root, 'node_modules/7z-wasm'), dst = join(root, 'public/vendor/7z-wasm');
export const FILES = ['7zz.es6.js', '7zz.wasm', 'License.txt', 'unRarLicense.txt'];

export function check(dir = dst) {
  return FILES.filter(f => !readFileSync(join(src, f)).equals(readFileSync(join(dir, f))));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = check();
    if (bad.length) { console.error(`public/vendor/7z-wasm differs from node_modules: ${bad.join(', ')}. Run npm run build.`); process.exit(1); }
    console.log('7z-wasm vendor files match node_modules');
  } else {
    mkdirSync(dst, { recursive: true });
    for (const f of FILES) copyFileSync(join(src, f), join(dst, f));
    console.log(`copied ${FILES.join(', ')} to public/vendor/7z-wasm`);
  }
}
