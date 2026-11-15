import { describe, it, expect } from 'vitest';
import { create, list, extract, test as testArchive, convert, edit, compareListings, duplicates, mainOf, type InFile, type OutFile } from './ops';
import { CREATE, howToOpen, volumeInfo, parseSize, isArchiveName } from './formats';
import { safePath, archiveBase, uniqueName, wrapFolder, globToRegExp } from './names';
import { hashBlob, parseChecksumList, algoForLength } from './hashes';
import { ageKeygen } from './agecrypt';

const enc = new TextEncoder(), dec = new TextDecoder();
const file = (path: string, text: string): InFile => ({ path, data: new Blob([enc.encode(text)]) });
const asInputs = (out: OutFile[]): InFile[] => out.map(f => ({ path: f.path, data: new Blob([f.data as BlobPart]) }));
const textOf = (files: OutFile[], path: string) => { const f = files.find(x => x.path === path); return f ? dec.decode(f.data) : undefined; };

const SAMPLE = [
  file('photos/a.txt', 'alpha '.repeat(500)),
  file('photos/sub/b.txt', 'bravo'),
  file('notes.md', '# Notes\nhello'),
];

describe('create and extract every format', () => {
  for (const fmt of CREATE) {
    it(`${fmt.id} round-trips`, async () => {
      const opts = { format: fmt.id, name: 'bundle', level: 3, ...(fmt.id === 'age' ? { password: 'pw' } : {}) };
      const out = await create(SAMPLE, opts);
      expect(out.length).toBe(1);
      const name = out[0].path;
      expect(name.startsWith('bundle') || fmt.single).toBeTruthy();
      const ex = await extract(asInputs(out), { password: fmt.id === 'age' ? 'pw' : undefined });
      expect(textOf(ex.files, 'photos/sub/b.txt')).toBe('bravo');
      expect(textOf(ex.files, 'notes.md')).toBe('# Notes\nhello');
    }, 30000);
  }

  it('a single file with a single-file codec keeps its name', async () => {
    for (const id of ['gz', 'zst', 'br', 'lz4', 'xz', 'bz2'] as const) {
      const out = await create([file('report.txt', 'x'.repeat(2000))], { format: id, name: 'report' });
      expect(out[0].path).toBe(`report.txt.${id}`);
      const ex = await extract(asInputs(out));
      expect(textOf(ex.files, 'report.txt')).toBe('x'.repeat(2000));
    }
  }, 30000);
});

describe('encryption', () => {
  it('7z with encrypted names needs the password to list', async () => {
    const out = await create(SAMPLE, { format: '7z', name: 'secret', password: 'hunter2', encryptNames: true });
    await expect(list(asInputs(out))).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    await expect(list(asInputs(out), { password: 'wrong' })).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    const l = await list(asInputs(out), { password: 'hunter2' });
    expect(l.entries.map(e => e.path)).toContain('notes.md');
    expect(l.encrypted).toBe(true);
  }, 30000);

  it('AES-256 zip and ZipCrypto zip', async () => {
    for (const zipLegacy of [false, true]) {
      const out = await create(SAMPLE, { format: 'zip', name: 'z', password: 'pw', zipLegacy });
      await expect(extract(asInputs(out), { password: 'nope' })).rejects.toBeTruthy();
      const ex = await extract(asInputs(out), { password: 'pw' });
      expect(textOf(ex.files, 'photos/sub/b.txt')).toBe('bravo');
      const l = await list(asInputs(out), { password: 'pw' });
      expect(l.entries.find(e => e.path === 'notes.md')!.method).toMatch(zipLegacy ? /ZipCrypto/ : /AES-256/);
    }
  }, 30000);

  it('age with a key pair', async () => {
    const { identity, recipient } = await ageKeygen();
    expect(recipient.startsWith('age1')).toBe(true);
    const out = await create([file('diary.txt', 'dear diary')], { format: 'age', name: 'diary', recipients: [recipient] });
    await expect(extract(asInputs(out), { password: 'guess' })).rejects.toBeTruthy();
    const ex = await extract(asInputs(out), { identities: [identity] });
    expect(textOf(ex.files, 'diary.txt')).toBe('dear diary');
  }, 30000);
});

describe('volumes, testing and safety', () => {
  it('split into volumes and joins them again from any order', async () => {
    const big = file('big.bin', Array.from({ length: 40000 }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join(''));
    const out = await create([big], { format: '7z', name: 'parts', level: 0, splitBytes: 10000 });
    expect(out.length).toBeGreaterThan(2);
    expect(out.map(f => f.path)).toContain('parts.7z.001');
    const shuffled = asInputs(out).reverse();
    expect(mainOf(shuffled).path).toBe('parts.7z.001');
    const ex = await extract(shuffled);
    expect(ex.files.find(f => f.path === 'big.bin')!.data.length).toBe(40000);
  }, 30000);

  it('test finds a damaged archive', async () => {
    const out = await create(SAMPLE, { format: '7z', name: 't', level: 9 });
    expect((await testArchive(asInputs(out))).ok).toBe(true);
    const bad = out[0].data.slice(); for (let i = 40; i < 120; i++) bad[i] ^= 0x5a;
    expect((await testArchive([{ path: 't.7z', data: new Blob([bad as BlobPart]) }])).ok).toBe(false);
  }, 30000);

  it('refuses paths that climb out of the destination (zip slip)', async () => {
    const zip = storedZip([['../evil.txt', 'pwned'], ['ok/fine.txt', 'fine']]);
    const ex = await extract([{ path: 'slip.zip', data: new Blob([zip as BlobPart]) }]);
    expect(ex.files.some(f => f.path.includes('..'))).toBe(false);
    expect(textOf(ex.files, 'ok/fine.txt')).toBe('fine');
  }, 30000);

  it('fixes Shift-JIS names in an old zip with the right code page', async () => {
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x2e, 0x74, 0x78, 0x74]); // 日本.txt
    const zip = storedZip([[sjis, 'konnichiwa']]);
    const inp = [{ path: 'old.zip', data: new Blob([zip as BlobPart]) }];
    expect((await list(inp, { encoding: 'shift_jis' })).entries[0].path).toBe('日本.txt');
    const ex = await extract(inp, { encoding: 'shift_jis' });
    expect(textOf(ex.files, '日本.txt')).toBe('konnichiwa');
    const cp437 = storedZip([[new Uint8Array([0x82, 0x2e, 0x74, 0x78, 0x74]), 'e']]); // é.txt in DOS code page 437
    expect((await list([{ path: 'dos.zip', data: new Blob([cp437 as BlobPart]) }], { encoding: 'auto' })).entries[0].path).toBe('é.txt');
  }, 30000);

  it('unpacks the tar inside a tar.gz in one go, and lists through it', async () => {
    const out = await create(SAMPLE, { format: 'tar.gz', name: 'tb' });
    const l = await list(asInputs(out));
    expect(l.entries.map(e => e.path)).toContain('photos/sub/b.txt');
    const ex = await extract(asInputs(out));
    expect(ex.files.some(f => f.path.endsWith('.tar'))).toBe(false);
  }, 30000);
});

describe('convert, edit, compare', () => {
  it('converts zip to 7z with a password', async () => {
    const zip = await create(SAMPLE, { format: 'zip', name: 'c' });
    const out = await convert(asInputs(zip), {}, { format: '7z', name: 'c', password: 'pw', encryptNames: true });
    const ex = await extract(asInputs(out), { password: 'pw' });
    expect(textOf(ex.files, 'notes.md')).toBe('# Notes\nhello');
  }, 30000);

  it('removes, renames and adds entries', async () => {
    const zip = await create(SAMPLE, { format: 'zip', name: 'e' });
    const out = await edit(asInputs(zip), {}, { remove: ['photos/sub'], rename: [['notes.md', 'README.md']], add: [file('new.txt', 'new')], addTo: 'extra' }, { format: 'zip', name: 'e' });
    const ex = await extract(asInputs(out));
    const paths = ex.files.map(f => f.path);
    expect(paths).not.toContain('photos/sub/b.txt');
    expect(textOf(ex.files, 'README.md')).toBe('# Notes\nhello');
    expect(textOf(ex.files, 'extra/new.txt')).toBe('new');
  }, 30000);

  it('compares two listings and finds duplicates', async () => {
    const a = await list(asInputs(await create(SAMPLE, { format: 'zip', name: 'a' })));
    const b = await list(asInputs(await create([...SAMPLE.slice(1), file('photos/a.txt', 'changed'), file('dup.md', '# Notes\nhello')], { format: 'zip', name: 'b' })));
    const d = compareListings(a.entries, b.entries);
    expect(d.added).toEqual(['dup.md']); expect(d.changed).toEqual(['photos/a.txt']); expect(d.removed).toEqual([]);
    expect(duplicates(b.entries)).toEqual([expect.arrayContaining(['notes.md', 'dup.md'])]);
  }, 30000);
});

describe('helpers', () => {
  it('names and paths', () => {
    expect(safePath('../x')).toBeNull(); expect(safePath('/etc/passwd')).toBeNull(); expect(safePath('C:\\x')).toBeNull();
    expect(safePath('a/./b/')).toBe('a/b/');
    expect(archiveBase('photos.tar.gz')).toBe('photos'); expect(archiveBase('a.7z.001')).toBe('a'); expect(archiveBase('b.part1.rar')).toBe('b'); expect(archiveBase('c.tar.zst.age')).toBe('c');
    expect(uniqueName(new Set(['x.zip', 'x 2.zip']), 'x.zip')).toBe('x 3.zip');
    expect(wrapFolder([{ path: 'a' }], 'z', 'smart')).toEqual([{ path: 'a' }]);
    expect(wrapFolder([{ path: 'a' }, { path: 'b' }], 'z', 'smart').map(f => f.path)).toEqual(['z/a', 'z/b']);
    expect(globToRegExp('*.log').test('x/y.log')).toBe(true); expect(globToRegExp('*.log').test('y.logx')).toBe(false);
  });
  it('formats', () => {
    expect(howToOpen('a.tar.zst')).toEqual({ kind: 'codec', codec: 'zstd', inner: 'a.tar' });
    expect(howToOpen('a.tzst')).toEqual({ kind: 'codec', codec: 'zstd', inner: 'a.tar' });
    expect(volumeInfo('x.part3.rar')).toEqual({ base: 'x.rar', index: 3 });
    expect(parseSize('4.7g')).toBe(Math.floor(4.7 * 1024 ** 3)); expect(parseSize('nope')).toBeNull();
    expect(isArchiveName('game.iso')).toBe(true); expect(isArchiveName('photo.jpg')).toBe(false);
  });
  it('checksums', async () => {
    expect(await hashBlob(new Blob(['abc']), 'sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashBlob(new Blob(['abc']), 'md5')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(parseChecksumList('ba7816bf  file.zip\nSHA256 (b.zip) = ' + 'a'.repeat(64))).toEqual([{ hash: 'ba7816bf', name: 'file.zip' }, { hash: 'a'.repeat(64), name: 'b.zip' }]);
    expect(algoForLength(64)).toBe('sha256');
  });
});

// A minimal stored (uncompressed) zip, so tests can hold names 7-Zip would never write itself.
function storedZip(items: [string | Uint8Array, string][]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [n, text] of items) {
    const name = typeof n === 'string' ? enc.encode(n) : n, data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 10, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 10, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, items.length, true); end.setUint16(10, items.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0)); let o = 0; for (const b of all) { out.set(b, o); o += b.length; }
  return out;
}
