// Settings and presets in localStorage, job history in IndexedDB (names, sizes and times only,
// never file contents or passwords). Every access is guarded: a private window still works.
import type { FormatId } from './engine/formats';

export interface Settings {
  lang: 'en' | 'nl'; theme: 'auto' | 'light' | 'dark' | 'keka' | 'terminal';
  format: FormatId; level: number; solid: boolean; encryptNames: boolean; zipLegacy: boolean; excludeMac: boolean;
  folder: 'smart' | 'always' | 'never'; drop: 'auto' | 'compress' | 'open'; save: 'download' | 'folder';
  checksum: 'none' | 'md5' | 'sha256'; exportPassword: boolean; separate: boolean; split: number; exclude: string;
}
export const DEFAULTS: Settings = {
  lang: (typeof navigator !== 'undefined' && navigator.language?.startsWith('nl')) ? 'nl' : 'en', theme: 'auto',
  format: '7z', level: 5, solid: true, encryptNames: true, zipLegacy: false, excludeMac: true,
  folder: 'smart', drop: 'auto', save: 'download', checksum: 'none', exportPassword: false, separate: false, split: 0, exclude: '',
};
const KEY = 'web-pak:settings', PKEY = 'web-pak:presets';
const get = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const getArr = <T>(k: string): T[] => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : []; } catch { return []; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const settings: Settings = get(KEY, DEFAULTS);
export const saveSettings = () => put(KEY, settings);

export interface Preset { name: string; options: Partial<Settings> }
export const presets = (): Preset[] => getArr<Preset>(PKEY);
export function savePreset(p: Preset) { put(PKEY, [...presets().filter(x => x.name !== p.name), p]); }
export function deletePreset(name: string) { put(PKEY, presets().filter(x => x.name !== name)); }

// ---- history (IndexedDB)
export interface HistoryItem { id?: number; when: number; op: string; title: string; ok: boolean; inBytes: number; outBytes: number; ms: number; detail?: string }
let dbP: Promise<IDBDatabase | null> | null = null;
function db() {
  dbP ??= new Promise(res => {
    try {
      const r = indexedDB.open('web-pak', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbP;
}
export async function addHistory(h: HistoryItem) {
  const d = await db(); if (!d) return;
  d.transaction('history', 'readwrite').objectStore('history').add(h);
}
export async function readHistory(): Promise<HistoryItem[]> {
  const d = await db(); if (!d) return [];
  return new Promise(res => { const r = d.transaction('history').objectStore('history').getAll(); r.onsuccess = () => res((r.result as HistoryItem[]).sort((a, b) => b.when - a.when).slice(0, 200)); r.onerror = () => res([]); });
}
export async function clearHistory() { const d = await db(); if (d) d.transaction('history', 'readwrite').objectStore('history').clear(); }
