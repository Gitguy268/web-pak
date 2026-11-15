// Saving results: into a folder the user picks (File System Access API, Chromium), or as
// downloads. Brave and Firefox turn the folder API off, so several files then download as one
// stored zip made by the engine.
import type { OutFile } from './engine/ops';
import { safePath, uniqueName } from './engine/names';

export const canPickFolder = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export function download(name: string, data: Uint8Array | Blob, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.split('/').pop() || 'download';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

type DirHandle = { getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<DirHandle>; getFileHandle(n: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>; name: string };

/** Write files into a folder the user picks; existing names get " 2". Returns how many were written. */
export async function saveToFolder(files: OutFile[]): Promise<number> {
  const root = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' });
  const exists = async (dir: DirHandle, name: string) => { try { await dir.getFileHandle(name); return true; } catch { try { await dir.getDirectoryHandle(name); return true; } catch { return false; } } };
  const renamedTop = new Map<string, string>();
  let n = 0;
  for (const f of files) {
    const p = safePath(f.path); if (!p) continue;
    const parts = p.replace(/\/$/, '').split('/');
    // don't overwrite: rename the top-level item if it already exists in the chosen folder
    if (!renamedTop.has(parts[0])) {
      const tried = new Set<string>([parts[0]]);
      let name = parts[0];
      while (await exists(root, name)) { name = uniqueName(tried, parts[0]); tried.add(name); }
      renamedTop.set(parts[0], name);
    }
    parts[0] = renamedTop.get(parts[0])!;
    let dir = root;
    const isDir = f.path.endsWith('/');
    for (const seg of isDir ? parts : parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
    if (isDir) continue;
    const fh = await dir.getFileHandle(parts.at(-1)!, { create: true });
    const w = await fh.createWritable(); await w.write(f.data as BlobPart); await w.close(); n++;
  }
  return n;
}
