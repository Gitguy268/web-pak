// What web-pak can make and open. Creating uses 7-Zip (7z-wasm) for 7z, zip, tar, gzip, bzip2,
// xz and wim; zstd, brotli and lz4 come from their own small libraries; age from typage.

export type FormatId =
  | '7z' | 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'tar.zst' | 'tar.br' | 'tar.lz4' | 'wim'
  | 'gz' | 'bz2' | 'xz' | 'zst' | 'br' | 'lz4' | 'age';

export interface CreateFormat {
  id: FormatId;
  label: string;
  ext: string;
  group: 'Archives' | 'Compressed tarballs' | 'Single files' | 'Encryption';
  /** 'names' = can also hide file names (7z header encryption) */
  password: false | true | 'names';
  levels: boolean;
  solid?: boolean;
  split?: boolean;
  /** compresses one file only; a folder or several files are tarred first */
  single?: boolean;
  /** 7-Zip -t type for the archive step */
  sevenType?: string;
  /** a codec applied after tar (or to the single file) */
  codec?: 'gzip' | 'bzip2' | 'xz' | 'zstd' | 'brotli' | 'lz4';
}

export const CREATE: CreateFormat[] = [
  { id: '7z', label: '7z', ext: '.7z', group: 'Archives', password: 'names', levels: true, solid: true, split: true, sevenType: '7z' },
  { id: 'zip', label: 'zip', ext: '.zip', group: 'Archives', password: true, levels: true, split: true, sevenType: 'zip' },
  { id: 'tar', label: 'tar', ext: '.tar', group: 'Archives', password: false, levels: false, split: true, sevenType: 'tar' },
  { id: 'wim', label: 'wim', ext: '.wim', group: 'Archives', password: false, levels: false, sevenType: 'wim' },
  { id: 'tar.gz', label: 'tar.gz', ext: '.tar.gz', group: 'Compressed tarballs', password: false, levels: true, sevenType: 'tar', codec: 'gzip' },
  { id: 'tar.bz2', label: 'tar.bz2', ext: '.tar.bz2', group: 'Compressed tarballs', password: false, levels: true, sevenType: 'tar', codec: 'bzip2' },
  { id: 'tar.xz', label: 'tar.xz', ext: '.tar.xz', group: 'Compressed tarballs', password: false, levels: true, sevenType: 'tar', codec: 'xz' },
  { id: 'tar.zst', label: 'tar.zst', ext: '.tar.zst', group: 'Compressed tarballs', password: false, levels: true, sevenType: 'tar', codec: 'zstd' },
  { id: 'tar.br', label: 'tar.br', ext: '.tar.br', group: 'Compressed tarballs', password: false, levels: true, sevenType: 'tar', codec: 'brotli' },
  { id: 'tar.lz4', label: 'tar.lz4', ext: '.tar.lz4', group: 'Compressed tarballs', password: false, levels: false, sevenType: 'tar', codec: 'lz4' },
  { id: 'gz', label: 'gz', ext: '.gz', group: 'Single files', password: false, levels: true, single: true, codec: 'gzip' },
  { id: 'bz2', label: 'bz2', ext: '.bz2', group: 'Single files', password: false, levels: true, single: true, codec: 'bzip2' },
  { id: 'xz', label: 'xz', ext: '.xz', group: 'Single files', password: false, levels: true, single: true, codec: 'xz' },
  { id: 'zst', label: 'zst', ext: '.zst', group: 'Single files', password: false, levels: true, single: true, codec: 'zstd' },
  { id: 'br', label: 'br', ext: '.br', group: 'Single files', password: false, levels: true, single: true, codec: 'brotli' },
  { id: 'lz4', label: 'lz4', ext: '.lz4', group: 'Single files', password: false, levels: false, single: true, codec: 'lz4' },
  { id: 'age', label: 'age', ext: '.age', group: 'Encryption', password: true, levels: false, single: true },
];
export const formatById = (id: string) => CREATE.find(f => f.id === id);

// Extensions web-pak opens. Everything 7-Zip 24 reads, plus zst, br, lz4 and age.
export const OPEN_EXTS = [
  '7z', 'zip', 'zipx', 'rar', 'tar', 'tgz', 'tbz', 'tbz2', 'txz', 'tzst', 'tlz', 'taz', 'gz', 'bz2', 'xz', 'lzma', 'lz', 'z', 'zst', 'br', 'lz4', 'age',
  'cab', 'msi', 'exe', 'deb', 'rpm', 'cpio', 'cpgz', 'pax', 'xar', 'pkg', 'dmg', 'hfs', 'apfs', 'iso', 'img', 'udf', 'wim', 'swm', 'esd',
  'vhd', 'vhdx', 'vmdk', 'vdi', 'qcow', 'qcow2', 'squashfs', 'cramfs', 'ext', 'fat', 'ntfs', 'mbr', 'gpt',
  'jar', 'war', 'ear', 'apk', 'aab', 'ipa', 'xpi', 'crx', 'appx', 'msix', 'epub', 'cbz', 'cbr', 'cb7', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp',
  'arj', 'lzh', 'lha', 'chm', 'nsis', 'ar', 'a', 'lib', 'spk', 'wpress', 'whl', 'nupkg', 'vsix', 'sketch', 'xip',
];

const CODEC_EXT: Record<string, 'zstd' | 'brotli' | 'lz4'> = { zst: 'zstd', tzst: 'zstd', br: 'brotli', lz4: 'lz4' };

/** The extension after the last dot, lowercased; ".tar.gz" style doubles are handled by callers */
export const extOf = (name: string) => { const m = /\.([^./\\]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; };

/** First volume of a split archive set, or null when the name is not a volume */
export function volumeInfo(name: string): { base: string; index: number } | null {
  let m = /^(.*)\.(\d{3})$/.exec(name);            // name.7z.001
  if (m) return { base: m[1], index: +m[2] };
  m = /^(.*)\.part(\d+)\.rar$/i.exec(name);        // name.part1.rar
  if (m) return { base: m[1] + '.rar', index: +m[2] };
  m = /^(.*)\.z(\d{2})$/i.exec(name);              // name.z01 (+ name.zip last)
  if (m) return { base: m[1] + '.zip', index: +m[2] };
  return null;
}

export type Opened = { kind: 'codec'; codec: 'zstd' | 'brotli' | 'lz4'; inner: string } | { kind: 'age'; inner: string } | { kind: '7z' };

/** How to open a file by its name: an outer codec 7-Zip lacks, age, or straight to 7-Zip */
export function howToOpen(name: string): Opened {
  const e = extOf(name);
  if (e === 'age') return { kind: 'age', inner: name.slice(0, -4) };
  const c = CODEC_EXT[e];
  if (c) return { kind: 'codec', codec: c, inner: e === 'tzst' ? name.slice(0, -5) + '.tar' : name.slice(0, -(e.length + 1)) };
  return { kind: '7z' };
}

export function isArchiveName(name: string) {
  const e = extOf(name);
  return OPEN_EXTS.includes(e) || !!volumeInfo(name);
}

// Split volume presets (bytes), as in Keka
export const SPLIT_PRESETS: [string, number][] = [
  ['Email (25 MB)', 25 * 1024 ** 2], ['CD (650 MB)', 650 * 1024 ** 2], ['CD (700 MB)', 700 * 1024 ** 2],
  ['DVD (4.7 GB)', 4_700_000_000], ['FAT32 (4 GB − 1)', 4 * 1024 ** 3 - 1],
];

/** "100m", "4.7g", "650 MB" -> bytes */
export function parseSize(s: string): number | null {
  const m = /^\s*([\d.]+)\s*([kmgt]?)i?b?\s*$/i.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]); if (!isFinite(n) || n <= 0) return null;
  const k = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[m[2].toLowerCase() as '' | 'k' | 'm' | 'g' | 't'];
  return Math.floor(n * k);
}

// Encodings for names in old zips (TextDecoder labels, plus cp437 decoded by web-pak itself)
export const ENCODINGS: [string, string][] = [
  ['auto', 'Automatic'], ['cp437', 'DOS (CP437)'], ['ibm866', 'Cyrillic DOS (CP866)'], ['windows-1251', 'Cyrillic Windows (1251)'],
  ['windows-1252', 'Western Windows (1252)'], ['shift_jis', 'Japanese (Shift-JIS)'], ['gbk', 'Simplified Chinese (GBK)'],
  ['big5', 'Traditional Chinese (Big5)'], ['euc-kr', 'Korean (EUC-KR)'], ['utf-8', 'UTF-8'],
];

export const MAC_JUNK = (path: string) => /(^|\/)(\.DS_Store|__MACOSX|\._[^/]*)(\/|$)/.test(path);
