// zstd, brotli and lz4: the codecs 7-Zip 24 lacks. Each works on whole buffers in memory.
// zstd: @bokuweb/zstd-wasm (MIT glue, zstd BSD-3-Clause); brotli: brotli-wasm (Apache-2.0);
// lz4: lz4js (ISC). Levels come in as 0..9 and are mapped onto each codec's own range.
import * as zstdWasm from '@bokuweb/zstd-wasm';
import lz4 from 'lz4js';

let zstdReady: Promise<void> | null = null;
let zstdUrl: string | undefined;
export function setZstdWasmUrl(url: string) { zstdUrl = url; }
async function zstd() {
  zstdReady ??= (zstdWasm as unknown as { init(p?: string): Promise<void> }).init(zstdUrl);
  await zstdReady;
  return zstdWasm as unknown as { compress(b: Uint8Array, l: number): Uint8Array; decompress(b: Uint8Array): Uint8Array };
}

type Brotli = { compress(b: Uint8Array, o?: { quality?: number }): Uint8Array; decompress(b: Uint8Array): Uint8Array };
let brotliP: Promise<Brotli> | null = null;
async function brotli(): Promise<Brotli> {
  // Node (the tests) needs brotli-wasm's CommonJS build; browsers get the web build via Vite
  const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof (globalThis as { window?: unknown }).window === 'undefined' && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === 'undefined';
  brotliP ??= isNode
    ? import(/* @vite-ignore */ 'node:module').then(m => (m as { createRequire(u: string): (id: string) => Brotli }).createRequire(import.meta.url)('brotli-wasm'))
    : import('brotli-wasm').then(m => (m as unknown as { default: Promise<Brotli> | Brotli }).default) as Promise<Brotli>;
  return brotliP;
}

export type Codec = 'zstd' | 'brotli' | 'lz4';
const ZSTD_LEVEL = [1, 1, 3, 5, 7, 9, 12, 15, 18, 19];
const BROTLI_Q = [0, 1, 3, 4, 5, 6, 7, 9, 10, 11];

export async function compress(codec: Codec, data: Uint8Array, level = 5): Promise<Uint8Array> {
  const l = Math.max(0, Math.min(9, level));
  if (codec === 'zstd') return (await zstd()).compress(data, ZSTD_LEVEL[l]);
  if (codec === 'brotli') return (await brotli()).compress(data, { quality: BROTLI_Q[l] });
  return Uint8Array.from((lz4 as unknown as { compress(b: Uint8Array): ArrayLike<number> }).compress(data));
}

export async function decompress(codec: Codec, data: Uint8Array): Promise<Uint8Array> {
  if (codec === 'zstd') return (await zstd()).decompress(data);
  if (codec === 'brotli') return (await brotli()).decompress(data);
  return Uint8Array.from((lz4 as unknown as { decompress(b: Uint8Array): ArrayLike<number> }).decompress(data));
}
