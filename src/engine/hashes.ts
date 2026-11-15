// Checksums with hash-wasm (MIT), streamed through the file in 8 MB slices so big files fit.
import type { Algo } from './hashlist';
import { createMD5, createSHA1, createSHA256, createSHA512, createCRC32, createBLAKE3, createXXHash64 } from 'hash-wasm';

export const ALGOS = { md5: createMD5, sha1: createSHA1, sha256: createSHA256, sha512: createSHA512, crc32: createCRC32, blake3: createBLAKE3, xxh64: createXXHash64 } as const;
export type { Algo } from './hashlist';

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

export { parseChecksumList, algoForLength } from './hashlist';
