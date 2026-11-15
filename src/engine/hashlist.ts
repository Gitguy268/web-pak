// Checksum helpers with no WebAssembly, so the page can use them without loading hash-wasm.
export const ALGO_NAMES = ['md5', 'sha1', 'sha256', 'sha512', 'crc32', 'blake3', 'xxh64'] as const;
export type Algo = typeof ALGO_NAMES[number];

/** Parse "hash  name" lines (sha256sum / md5sum / shasum format, also "SHA256 (name) = hash") */
export function parseChecksumList(text: string): { name: string; hash: string }[] {
  const out: { name: string; hash: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    let m = /^([0-9a-fA-F]{8,128})\s+\*?(.+)$/.exec(line.trim());
    if (m) { out.push({ hash: m[1].toLowerCase(), name: m[2].trim() }); continue; }
    m = /^[A-Z0-9-]+\s*\((.+)\)\s*=\s*([0-9a-fA-F]{8,128})$/.exec(line.trim());
    if (m) out.push({ name: m[1], hash: m[2].toLowerCase() });
  }
  return out;
}

/** Which algorithm a hex digest of this length most likely is */
export const algoForLength = (n: number): Algo | null => ({ 8: 'crc32', 16: 'xxh64', 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' } as Record<number, Algo>)[n] ?? null;
