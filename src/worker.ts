// The engine runs here, off the main thread: one worker per job, so a job can be cancelled by
// terminating its worker. Results go back as transferable buffers.
import sevenWasm from '7z-wasm/7zz.wasm?url';
import zstdWasm from '../node_modules/@bokuweb/zstd-wasm/dist/web/zstd.wasm?url';
import { setWasmUrl } from './engine/sevenzip';
import { setZstdWasmUrl } from './engine/codecs';
import * as ops from './engine/ops';
import { hashBlob, type Algo } from './engine/hashes';
import { ageKeygen } from './engine/agecrypt';

setWasmUrl(sevenWasm);
setZstdWasmUrl(zstdWasm);

type Req = { id: number; op: string; args: Record<string, unknown> };
const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, op, args: a } = e.data;
  const progress = (p: number, text?: string) => post({ id, kind: 'progress', p, text });
  try {
    let result: unknown;
    const inputs = a.inputs as ops.InFile[];
    switch (op) {
      case 'create': result = await ops.create(inputs, a.options as ops.CreateOptions, progress); break;
      case 'list': result = await ops.list(inputs, a.open as ops.OpenOptions, progress); break;
      case 'extract': result = await ops.extract(inputs, a.open as ops.OpenOptions & { only?: string[] }, progress); break;
      case 'test': result = await ops.test(inputs, a.open as ops.OpenOptions, progress); break;
      case 'convert': result = await ops.convert(inputs, a.open as ops.OpenOptions, a.options as ops.CreateOptions, progress); break;
      case 'edit': result = await ops.edit(inputs, a.open as ops.OpenOptions, a.changes as ops.Edit, a.options as ops.CreateOptions, progress); break;
      case 'hash': {
        const out: Record<string, string> = {};
        const algos = a.algos as Algo[];
        for (let i = 0; i < algos.length; i++) out[algos[i]] = await hashBlob(a.blob as Blob, algos[i], p => progress((i + p) / algos.length));
        result = out; break;
      }
      case 'keygen': result = await ageKeygen(); break;
      default: throw new Error(`Unknown operation ${op}`);
    }
    const transfer: Transferable[] = [];
    const collect = (files?: ops.OutFile[]) => files?.forEach(f => f.data.byteLength && transfer.push(f.data.buffer));
    if (Array.isArray(result)) collect(result as ops.OutFile[]);
    else if (result && typeof result === 'object' && 'files' in result) collect((result as ops.Extracted).files);
    post({ id, kind: 'done', result }, transfer);
  } catch (err) {
    const e2 = err as ops.EngineError;
    post({ id, kind: 'error', code: e2.code ?? 'ERROR', message: e2.message ?? String(err) });
  }
};
