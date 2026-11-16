// A thin, safe wrapper around 7z-wasm (7-Zip 24.09 compiled to WebAssembly, LGPL-2.1 + unRAR
// restriction, loaded unmodified as its own file). Each job gets a fresh 7-Zip instance with its
// own in-memory file system. In a Web Worker the inputs are mounted with WORKERFS, which reads the
// user's files lazily instead of copying them into memory first.
type Factory = (opts?: Record<string, unknown>) => Promise<{ FS: unknown; WORKERFS: unknown; callMain(args: string[]): number }>;
// The browser passes in 7-Zip's own loader (public/vendor/7z-wasm, shipped unchanged); Node, for the
// tests, imports the npm package. The name is a variable so the bundler leaves it alone.
let factory: Factory | undefined;
export function setFactory(f: Factory) { factory = f; }
async function getFactory(): Promise<Factory> {
  if (!factory) { const name = '7z-wasm'; factory = (await import(/* @vite-ignore */ name)).default as Factory; }
  return factory;
}

export interface InFile { path: string; data: Blob }
export interface OutFile { path: string; data: Uint8Array; mtime?: number }
export interface Entry {
  path: string; size: number; packed: number; modified: string; dir: boolean;
  encrypted: boolean; crc: string; method: string; attributes: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Module = { FS: any; WORKERFS: unknown; callMain(args: string[]): number };

let wasmBinary: ArrayBuffer | undefined;
let wasmUrl: string | undefined;
/** In the browser, tell the engine where the .wasm file is (Vite gives a URL) */
export function setWasmUrl(url: string) { wasmUrl = url; }

async function instance(onLine?: (s: string) => void) {
  if (!wasmBinary && wasmUrl) wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
  const lines: string[] = [];
  const push = (s: string) => { lines.push(s); onLine?.(s); };
  const sz = (await (await getFactory())({ print: push, printErr: push, ...(wasmBinary ? { wasmBinary: wasmBinary.slice(0) } : {}) })) as Module;
  return { sz, lines };
}

const canWorkerFS = () => typeof (globalThis as { FileReaderSync?: unknown }).FileReaderSync !== 'undefined';

function mkdirp(FS: Module['FS'], dir: string) {
  let cur = '';
  for (const part of dir.split('/').filter(Boolean)) { cur += '/' + part; try { FS.mkdir(cur); } catch { /* exists */ } }
}

/** Put input files at `dir` (WORKERFS in a worker, else copied into memory) */
async function mountInputs(sz: Module, inputs: InFile[], dir: string) {
  mkdirp(sz.FS, dir);
  if (canWorkerFS() && inputs.length) {
    sz.FS.mount((sz as unknown as { WORKERFS: never }).WORKERFS, { blobs: inputs.map(f => ({ name: f.path, data: f.data })) } as never, dir);
    return;
  }
  for (const f of inputs) {
    const p = `${dir}/${f.path}`;
    mkdirp(sz.FS, p.slice(0, p.lastIndexOf('/')));
    (sz.FS as unknown as { writeFile(p: string, d: Uint8Array): void }).writeFile(p, new Uint8Array(await f.data.arrayBuffer()));
  }
}

export interface RunResult { code: number; lines: string[]; sz: Module }
/** Run one 7-Zip command. inputs are mounted at /in; the working directory is /in. */
export async function run7z(args: string[], { inputs = [], onLine, cwd = '/in' }: { inputs?: InFile[]; onLine?: (s: string) => void; cwd?: string } = {}): Promise<RunResult> {
  const { sz, lines } = await instance(onLine);
  await mountInputs(sz, inputs, '/in');
  mkdirp(sz.FS, '/out'); mkdirp(sz.FS, '/tmp');
  sz.FS.chdir(cwd);
  let code: number;
  try { code = sz.callMain(args) as unknown as number; } catch (e) { code = (e as { status?: number }).status ?? 2; lines.push(String(e)); }
  return { code: code ?? 0, lines, sz };
}

/** Read every file under `dir` in the module's memory file system */
export function readTree(sz: Module, dir: string): OutFile[] {
  const FS = sz.FS as unknown as { readdir(p: string): string[]; stat(p: string): { mode: number; mtime: Date }; isDir(m: number): boolean; readFile(p: string): Uint8Array };
  const out: OutFile[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of FS.readdir(abs)) {
      if (name === '.' || name === '..') continue;
      const a = `${abs}/${name}`, r = rel ? `${rel}/${name}` : name, st = FS.stat(a);
      if (FS.isDir(st.mode)) { out.push({ path: r + '/', data: new Uint8Array(0), mtime: +st.mtime }); walk(a, r); }
      else out.push({ path: r, data: FS.readFile(a), mtime: +st.mtime });
    }
  };
  try { walk(dir, ''); } catch { /* empty */ }
  return out;
}

/** 7-Zip's error text, if any, from its output */
export function errorOf(r: RunResult): string | null {
  if (r.code === 0) return null;
  const pw = r.lines.find(l => /Wrong password|encrypted archive/i.test(l));
  if (pw) return 'WRONG_PASSWORD';
  const err = r.lines.filter(l => /ERROR|Error:|Can not|Cannot|Unsupported|Data error|CRC Failed|Headers Error|Unexpected end/i.test(l)).map(l => l.replace(/^ERROR:\s*/, '').trim());
  return err[0] || `7-Zip stopped with code ${r.code}`;
}

/** Parse `7zz l -slt -ba` output */
export function parseListing(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (cur && cur.Path !== undefined) {
      const attrs = cur.Attributes || '', dir = cur.Folder === '+' || attrs.startsWith('D');
      entries.push({
        path: cur.Path.replace(/\\/g, '/'), size: +(cur.Size || 0), packed: +(cur['Packed Size'] || 0), modified: cur.Modified || '',
        dir, encrypted: cur.Encrypted === '+', crc: cur.CRC || '', method: cur.Method || '', attributes: attrs,
      });
    }
    cur = null;
  };
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '');
    const m = /^([A-Za-z][A-Za-z ]*?) = (.*)$/.exec(l);
    if (!m) { if (l.trim() === '') flush(); continue; }
    if (m[1] === 'Path') { flush(); cur = {}; }
    if (cur) cur[m[1]] = m[2];
  }
  flush();
  return entries;
}

/** Progress percentage from a 7-Zip -bsp1 line like " 45% 12 + file" */
export function progressOf(line: string): number | null {
  const m = /^\s*(\d{1,3})%/.exec(line);
  return m ? +m[1] / 100 : null;
}
