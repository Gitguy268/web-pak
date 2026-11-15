// Checksums with hash-wasm (MIT), streamed through the file in 8 MB slices so big files fit.
import { createMD5, createSHA1, createSHA256, createSHA512, createCRC32, createBLAKE3, createXXHash64 } from 'hash-wasm';

export const ALGOS = { md5: createMD5, sha1: createSHA1, sha256: createSHA256, sha512: createSHA512, crc32: createCRC32, blake3: createBLAKE3, xxh64: createXXHash64 } as const;
export type Algo = keyof typeof ALGOS;

export async function hashBlob(blob: Blob, algo: Algo, onProgress?: (p: number) => void): Promise<string> {
  const h = await (ALGOS[algo] as () => Promise<{ init(): void; update(d: Uint8Array): void; digest(): string }>)();
  h.init();
  const step = 8 * 1024 * 1024;
  for (let off = 0; off < blob.size; off += step) {
    h.update(new Uint8Array(await blob.slice(off, off + step).arrayBuffer()));
    onProgress?.(Math.min(1, (off + step) / Math.max(1, blob.size)));
  }
  return h.digest();
}

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
