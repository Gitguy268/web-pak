// Path safety and naming: what Keka and pakket do when extracting.

/** A safe relative path, or null when it would land outside the destination */
export function safePath(p: string): string | null {
  const s = p.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '');
  if (s.startsWith('/')) return null;
  const parts = s.split('/').filter(x => x !== '' && x !== '.');
  if (!parts.length || parts.some(x => x === '..')) return null;
  return parts.join('/') + (s.endsWith('/') ? '/' : '');
}

const DOUBLE = /\.(tar\.(gz|bz2|xz|zst|br|lz4|lz|lzma|z)|tgz|tbz2?|txz|tzst)$/i;
/** "photos.tar.gz" -> "photos", "a.7z.001" -> "a", "b.part1.rar" -> "b" */
export function archiveBase(name: string): string {
  let n = name.replace(/\.(\d{3})$/, '').replace(/\.part\d+\.rar$/i, '.rar');
  if (DOUBLE.test(n)) return n.replace(DOUBLE, '');
  n = n.replace(/\.age$/i, '');
  if (DOUBLE.test(n)) return n.replace(DOUBLE, '');
  return n.replace(/\.[^./]+$/, '') || n;
}

/** "name", "name 2", "name 3"... the first one not in `taken` */
export function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\.[^./]+)?$/.exec(name)!, stem = m[1], ext = m[2] || '';
  for (let i = 2; ; i++) { const c = `${stem} ${i}${ext}`; if (!taken.has(c)) return c; }
}

/**
 * smart: a folder only when the archive holds more than one top-level item, and no "x/x" double
 * folder when it already holds one folder named like the archive. always / never do what they say.
 */
export function wrapFolder<T extends { path: string }>(files: T[], base: string, mode: 'smart' | 'always' | 'never'): T[] {
  if (mode === 'never') return files;
  const tops = new Set(files.map(f => f.path.split('/')[0]));
  if (mode === 'smart' && tops.size <= 1) return files;
  return files.map(f => ({ ...f, path: `${base}/${f.path}` }));
}

/** Simple glob for exclude patterns: * ? and ** */
export function globToRegExp(g: string): RegExp {
  const re = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`(^|/)${re}($|/)`);
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}
