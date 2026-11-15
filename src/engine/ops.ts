// The operations web-pak offers, built from 7-Zip, the codecs and age. They take files in and give
// files out, so the same code runs in the browser's worker and in Node's tests.
import { run7z, readTree, errorOf, parseListing, progressOf, type InFile, type OutFile, type Entry } from './sevenzip';
import { compress, decompress } from './codecs';
import { ageEncrypt, ageDecrypt } from './agecrypt';
import { formatById, howToOpen, volumeInfo, extOf, MAC_JUNK, type FormatId } from './formats';
import { safePath, archiveBase, globToRegExp } from './names';
import { zipRawNames, decodeName } from './zipnames';

export type { InFile, OutFile, Entry };
export type Progress = (fraction: number, text?: string) => void;

export interface CreateOptions {
  format: FormatId;
  name: string;              // archive name without extension
  level?: number;            // 0..9
  password?: string;
  encryptNames?: boolean;    // 7z: hide file names too
  zipLegacy?: boolean;       // zip: ZipCrypto instead of AES-256
  solid?: boolean;           // 7z
  splitBytes?: number;       // volumes
  excludeMac?: boolean;
  exclude?: string[];        // globs
  recipients?: string[];     // age public keys
}

export interface OpenOptions {
  password?: string;
  identities?: string[];     // age secret keys
  encoding?: string;         // names in old zips: a TextDecoder label, 'cp437' or 'auto'
  nested?: boolean;          // unpack a .tar found inside (default true)
}

export class EngineError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }
const fail = (r: Parameters<typeof errorOf>[0]) => { const e = errorOf(r); if (e) throw new EngineError(e === 'WRONG_PASSWORD' ? 'WRONG_PASSWORD' : 'SEVENZIP', e); };
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const blob = (u: Uint8Array) => new Blob([u as BlobPart]);
const pwArg = (o: OpenOptions) => `-p${o.password ?? ''}`; // always -p, so 7-Zip never waits for a prompt

/** Drop excluded files; returns what remains */
export function filterInputs(inputs: InFile[], o: Pick<CreateOptions, 'excludeMac' | 'exclude'>): InFile[] {
  const globs = (o.exclude ?? []).filter(Boolean).map(globToRegExp);
  return inputs.filter(f => !(o.excludeMac && MAC_JUNK(f.path)) && !globs.some(g => g.test(f.path)));
}
const topLevel = (inputs: InFile[]) => [...new Set(inputs.map(f => f.path.split('/')[0]))];

// ------------------------------------------------------------------ create
export async function create(inputs: InFile[], o: CreateOptions, onProgress?: Progress): Promise<OutFile[]> {
  const fmt = formatById(o.format);
  if (!fmt) throw new EngineError('FORMAT', `Unknown format ${o.format}`);
  const files = filterInputs(inputs, o);
  if (!files.length) throw new EngineError('EMPTY', 'Nothing to compress');
  const level = Math.max(0, Math.min(9, o.level ?? 5));
  const tops = topLevel(files);
  const onLine = (l: string) => { const p = progressOf(l); if (p !== null) onProgress?.(p * 0.9, l.trim()); };
  const single = files.length === 1 && !files[0].path.includes('/');

  // age: one file as is, anything else tarred first
  if (fmt.id === 'age') {
    let data: Uint8Array, name: string;
    if (single) { data = await bytes(files[0].data); name = files[0].path; }
    else { data = await tarOf(files, tops, o.name); name = `${o.name}.tar`; }
    onProgress?.(0.5, 'Encrypting');
    return [{ path: `${name}.age`, data: await ageEncrypt(data, { passphrase: o.password, recipients: o.recipients }) }];
  }

  // single-file codecs: one file as is, a folder or several files become name.tar.<codec>
  if (fmt.single) {
    const ext = fmt.ext;
    let data: Uint8Array, name: string;
    if (single) { data = await bytes(files[0].data); name = files[0].path; }
    else { data = await tarOf(files, tops, o.name); name = `${o.name}.tar`; }
    return [{ path: name + ext, data: await codecStep(fmt.codec!, data, name, level, onProgress) }];
  }

  // tarballs: tar with 7-Zip, then the codec
  if (fmt.codec) {
    const tar = await tarOf(files, tops, o.name, onLine);
    return [{ path: `${o.name}${fmt.ext}`, data: await codecStep(fmt.codec, tar, `${o.name}.tar`, level, onProgress) }];
  }

  // 7z, zip, tar, wim straight from 7-Zip
  const args = ['a', `-t${fmt.sevenType}`, `/out/${o.name}${fmt.ext}`, ...tops, '-bsp1', '-y'];
  if (fmt.levels) args.push(`-mx=${level}`);
  if (fmt.id === '7z') args.push(`-ms=${o.solid === false ? 'off' : 'on'}`);
  if (o.password && fmt.password) {
    args.push(`-p${o.password}`);
    if (fmt.id === '7z' && o.encryptNames) args.push('-mhe=on');
    if (fmt.id === 'zip') args.push(`-mem=${o.zipLegacy ? 'ZipCrypto' : 'AES256'}`);
  }
  if (o.splitBytes && fmt.split) args.push(`-v${o.splitBytes}b`);
  const r = await run7z(args, { inputs: files, onLine });
  fail(r);
  onProgress?.(1);
  return readTree(r.sz, '/out').filter(f => !f.path.endsWith('/'));
}

async function tarOf(files: InFile[], tops: string[], name: string, onLine?: (l: string) => void): Promise<Uint8Array> {
  const r = await run7z(['a', '-ttar', `/tmp/${name}.tar`, ...tops, '-bsp1', '-y'], { inputs: files, onLine });
  fail(r);
  return (r.sz.FS as unknown as { readFile(p: string): Uint8Array }).readFile(`/tmp/${name}.tar`);
}

async function codecStep(codec: NonNullable<ReturnType<typeof formatById>>['codec'] & string, data: Uint8Array, innerName: string, level: number, onProgress?: Progress): Promise<Uint8Array> {
  onProgress?.(0.92, `Compressing with ${codec}`);
  if (codec === 'zstd' || codec === 'brotli' || codec === 'lz4') return compress(codec, data, level);
  const [type, ext] = { gzip: ['gzip', 'gz'], bzip2: ['bzip2', 'bz2'], xz: ['xz', 'xz'] }[codec]!;
  // give the output its extension, or 7-Zip adds one itself
  const r = await run7z(['a', `-t${type}`, `/out/x.${ext}`, innerName, `-mx=${level}`, '-y'], { inputs: [{ path: innerName, data: blob(data) }] });
  fail(r);
  return (r.sz.FS as unknown as { readFile(p: string): Uint8Array }).readFile(`/out/x.${ext}`);
}

// ------------------------------------------------------------------ open: unwrap codecs and age
interface Unwrapped { inputs: InFile[]; main: string; layers: string[] }
/** Peel zstd/brotli/lz4 and age off the outside, so 7-Zip sees an archive it knows */
async function unwrap(inputs: InFile[], o: OpenOptions, onProgress?: Progress): Promise<Unwrapped> {
  const main = mainOf(inputs);
  const layers: string[] = [];
  let cur = main, data: Uint8Array | null = null;
  for (let i = 0; i < 3; i++) {
    const how = howToOpen(cur.path);
    if (how.kind === '7z') break;
    data ??= await bytes(cur.data);
    if (how.kind === 'codec') { onProgress?.(0.1, `Decompressing ${how.codec}`); data = await decompress(how.codec, data); layers.push(how.codec); }
    else { onProgress?.(0.1, 'Decrypting age'); data = await ageDecrypt(data, { passphrase: o.password, identities: o.identities }); layers.push('age'); }
    cur = { path: how.inner.split('/').pop()!, data: blob(data) };
  }
  if (!layers.length) return { inputs, main: main.path, layers };
  return { inputs: [cur], main: cur.path, layers };
}

/** The archive to open: the only file, or the first volume of a set */
export function mainOf(inputs: InFile[]): InFile {
  if (inputs.length === 1) return inputs[0];
  const vols = inputs.map(f => ({ f, v: volumeInfo(f.path) })).filter(x => x.v).sort((a, b) => a.v!.index - b.v!.index);
  if (vols.length) {
    // name.z01 sets start at name.zip, which holds the central directory
    const zipLast = inputs.find(f => /\.zip$/i.test(f.path) && vols.some(v => v.v!.base === f.path));
    return zipLast ?? vols[0].f;
  }
  return inputs[0];
}

const isTarName = (n: string) => /\.tar$/i.test(n);
/** 7-Zip unpacks .tar.gz in two steps: gzip gives .tar. Treat those as one. */
const outerOnly = (n: string) => /\.(t?gz|tbz2?|bz2|txz|xz|lzma|lz|z|taz|tlz)$/i.test(n);

// ------------------------------------------------------------------ list
export interface Listing { entries: Entry[]; type: string; layers: string[]; encrypted: boolean; headersEncrypted: boolean; physicalSize: number }
export async function list(inputs: InFile[], o: OpenOptions = {}, onProgress?: Progress): Promise<Listing> {
  const u = await unwrap(inputs, o, onProgress);
  const first = await list7z(u, o);
  // name.tar.gz: look inside the tar too, so the listing shows the real files
  if (o.nested !== false && first.entries.length === 1 && isTarName(first.entries[0].path) && outerOnly(u.main)) {
    const x = await run7z(['x', u.main, '-o/out', pwArg(o), '-y'], { inputs: u.inputs });
    fail(x);
    const tarName = first.entries[0].path;
    const tarData = (x.sz.FS as unknown as { readFile(p: string): Uint8Array }).readFile(`/out/${tarName}`);
    const inner = await list7z({ inputs: [{ path: tarName, data: blob(tarData) }], main: tarName, layers: [] }, o);
    return { ...inner, type: `${first.type} + tar`, layers: [...u.layers, first.type] };
  }
  return { ...first, layers: u.layers };
}
async function list7z(u: Unwrapped, o: OpenOptions): Promise<Omit<Listing, 'layers'>> {
  const r = await run7z(['l', '-slt', u.main, pwArg(o)], { inputs: u.inputs });
  fail(r);
  const sep = r.lines.findIndex(l => /^-{8,}$/.test(l.trim()));
  const head = parseListing(r.lines.slice(0, sep < 0 ? 0 : sep));
  const headRaw = r.lines.slice(0, sep < 0 ? 0 : sep).join('\n');
  const entries = parseListing(r.lines.slice(sep + 1)).filter(e => safePath(e.path) !== null || e.path === '');
  const type = /Type = (.+)/.exec(headRaw)?.[1] ?? extOf(u.main);
  if (/zip/i.test(type)) await fixZipNames(u, entries, o.encoding);
  const phys = +(/Physical Size = (\d+)/.exec(headRaw)?.[1] ?? 0);
  void head;
  // 7-Zip only lists an archive with encrypted names when the password is right, so if a password
  // was needed to list at all, the names were encrypted
  return { entries, type, encrypted: entries.some(e => e.encrypted), headersEncrypted: !!o.password && /Headers Size|Solid/.test(headRaw) && entries.every(e => e.encrypted), physicalSize: phys };
}

// ------------------------------------------------------------------ extract
export interface Extracted { files: OutFile[]; layers: string[]; skipped: string[] }
export async function extract(inputs: InFile[], o: OpenOptions & { only?: string[] } = {}, onProgress?: Progress): Promise<Extracted> {
  const u = await unwrap(inputs, o, onProgress);
  if (howToOpen(u.main).kind === '7z' && u.layers.length && !isArchiveLike(u.main)) {
    // e.g. notes.txt.zst: the layer itself was the whole job
    return { files: [{ path: u.main, data: await bytes(u.inputs[0].data) }], layers: u.layers, skipped: [] };
  }
  const onLine = (l: string) => { const p = progressOf(l); if (p !== null) onProgress?.(0.15 + p * 0.8, l.trim()); };
  const r = await run7z(['x', u.main, '-o/out', pwArg(o), '-y', '-bsp1', ...(o.only ?? [])], { inputs: u.inputs, onLine });
  fail(r);
  let files = readTree(r.sz, '/out');
  if (/\.(zip|zipx|jar|apk|ipa|xpi|epub|docx|xlsx|pptx|cbz)$/i.test(u.main)) files = await renameZipOutputs(u, files, o);
  // gzip/bzip2/xz around a tar: unpack the tar too
  if (o.nested !== false && files.length === 1 && isTarName(files[0].path) && (outerOnly(u.main) || u.layers.length)) {
    const t = files[0];
    const r2 = await run7z(['x', t.path, '-o/out', '-y', '-bsp1', ...(o.only ?? [])], { inputs: [{ path: t.path, data: blob(t.data) }], onLine });
    fail(r2);
    files = readTree(r2.sz, '/out');
  }
  const skipped: string[] = [];
  files = files.filter(f => { const ok = safePath(f.path) !== null; if (!ok) skipped.push(f.path); return ok; });
  onProgress?.(1);
  return { files, layers: u.layers, skipped };
}
/** Replace 7-Zip's names for zip entries with names decoded by web-pak (see zipnames.ts) */
async function fixZipNames(u: Unwrapped, entries: Entry[], encoding?: string) {
  const main = u.inputs.find(f => f.path === u.main);
  const raw = main && (await zipRawNames(main.data));
  if (!raw || raw.length !== entries.length) return;
  entries.forEach((e, i) => { const n = decodeName(raw[i], encoding).replace(/\\/g, '/').replace(/\/$/, ''); if (safePath(n)) e.path = n; });
}
async function renameZipOutputs(u: Unwrapped, files: OutFile[], o: OpenOptions): Promise<OutFile[]> {
  const main = u.inputs.find(f => f.path === u.main);
  const raw = main && (await zipRawNames(main.data));
  if (!raw || !raw.some(n => !n.utf8 && n.raw.some(b => b >= 128))) return files;
  const r = await run7z(['l', '-slt', u.main, pwArg(o)], { inputs: u.inputs });
  const sep = r.lines.findIndex(l => /^-{8,}$/.test(l.trim()));
  const sevenNames = parseListing(r.lines.slice(sep + 1)).map(e => e.path);
  if (sevenNames.length !== raw.length) return files;
  const map = new Map(sevenNames.map((n, i) => [n, decodeName(raw[i], o.encoding).replace(/\\/g, '/').replace(/\/$/, '')]));
  // rename deepest-first so folders and their files both move
  return files.map(f => {
    const isDir = f.path.endsWith('/'), p = isDir ? f.path.slice(0, -1) : f.path;
    const parts = p.split('/'), outParts: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), fixed = map.get(prefix);
      outParts.push(fixed ? fixed.split('/').pop()! : parts[i - 1]);
    }
    return { ...f, path: outParts.join('/') + (isDir ? '/' : '') };
  });
}
const isArchiveLike = (n: string) => /\.(7z|zip|rar|tar|t?gz|tgz|bz2|tbz2?|xz|txz|cab|iso|wim|dmg|jar|apk|deb|rpm|cpio|xar|lz|lzma)$/i.test(n);

// ------------------------------------------------------------------ test
export async function test(inputs: InFile[], o: OpenOptions = {}, onProgress?: Progress): Promise<{ ok: boolean; message: string }> {
  try {
    const u = await unwrap(inputs, o, onProgress);
    if (u.layers.length && !isArchiveLike(u.main)) return { ok: true, message: `${u.layers.join(' + ')} layer is intact` };
    const r = await run7z(['t', u.main, pwArg(o), '-bsp1', '-y'], { inputs: u.inputs, onLine: l => { const p = progressOf(l); if (p !== null) onProgress?.(p); } });
    const err = errorOf(r);
    if (err === 'WRONG_PASSWORD') throw new EngineError('WRONG_PASSWORD');
    return err ? { ok: false, message: err } : { ok: true, message: r.lines.find(l => /Everything is Ok/.test(l)) ? 'Everything is OK' : 'No errors' };
  } catch (e) {
    if (e instanceof EngineError && e.code === 'WRONG_PASSWORD') throw e;
    return { ok: false, message: (e as Error).message };
  }
}

// ------------------------------------------------------------------ convert and edit
const toInputs = (files: OutFile[]) => files.filter(f => !f.path.endsWith('/')).map(f => ({ path: f.path, data: blob(f.data) }));

/** Re-pack an archive in another format (rar -> zip, zip -> 7z with a password, ...) */
export async function convert(inputs: InFile[], openO: OpenOptions, createO: CreateOptions, onProgress?: Progress): Promise<OutFile[]> {
  const ex = await extract(inputs, openO, (p, t) => onProgress?.(p * 0.5, t));
  return create(toInputs(ex.files), createO, (p, t) => onProgress?.(0.5 + p * 0.5, t));
}

export interface Edit { remove?: string[]; rename?: [string, string][]; add?: InFile[]; addTo?: string }
/** Remove, rename and add entries, then save in the same or another format */
export async function edit(inputs: InFile[], openO: OpenOptions, changes: Edit, createO: CreateOptions, onProgress?: Progress): Promise<OutFile[]> {
  const ex = await extract(inputs, openO, (p, t) => onProgress?.(p * 0.5, t));
  let files = toInputs(ex.files);
  const gone = (p: string) => (changes.remove ?? []).some(r => p === r || p.startsWith(r.endsWith('/') ? r : r + '/'));
  files = files.filter(f => !gone(f.path));
  for (const [from, to] of changes.rename ?? []) {
    const safe = safePath(to); if (!safe) throw new EngineError('BAD_NAME', `Not a valid name: ${to}`);
    files = files.map(f => (f.path === from ? { ...f, path: safe } : f.path.startsWith(from + '/') ? { ...f, path: safe + f.path.slice(from.length) } : f));
  }
  const prefix = changes.addTo ? changes.addTo.replace(/\/?$/, '/') : '';
  for (const a of changes.add ?? []) files.push({ path: prefix + a.path, data: a.data });
  return create(files, createO, (p, t) => onProgress?.(0.5 + p * 0.5, t));
}

export { compareListings, duplicates } from './compare';
export { archiveBase };
