// web-pak: the app shell. Views (home, compress, archive, tools, history, settings), drag and
// drop, the job dock, dialogs, keyboard shortcuts, themes, languages and the PWA hooks.
import './style.css';
import { run, onJobs, cancel, clearFinished, JobError, type Job } from './engine-client';
import { CREATE, formatById, isArchiveName, SPLIT_PRESETS, parseSize, ENCODINGS, volumeInfo, type FormatId } from './engine/formats';
import { archiveBase, humanSize, wrapFolder, safePath } from './engine/names';
import type { InFile, OutFile, Listing, OpenOptions, CreateOptions, Extracted, Entry } from './engine/ops';
import { compareListings, duplicates } from './engine/compare';
import { parseChecksumList, algoForLength, ALGO_NAMES, type Algo } from './engine/hashlist';
import { renderPreview, MAX_PREVIEW } from './preview';
import { download, saveToFolder, canPickFolder } from './save';
import { settings as S, saveSettings, presets, savePreset, deletePreset, addHistory, readHistory, clearHistory, type Settings } from './store';
import { t, setLang, applyI18n } from './i18n';
import { WORDS } from './words';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null | undefined | false)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v as EventListener); else if (k === 'class') e.className = v as string; else if (v !== undefined && v !== false) (e as unknown as Record<string, unknown>)[k] = v; }
  e.append(...kids.filter((x): x is Node | string => !!x || x === ''));
  return e;
}
const blobOf = (u: Uint8Array) => new Blob([u as BlobPart]);
const toast = (msg: string) => { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout((toast as unknown as { t: number }).t); (toast as unknown as { t: number }).t = window.setTimeout(() => el.classList.remove('on'), 2600); };

// ------------------------------------------------------------------ state
interface Archive { inputs: InFile[]; name: string; listing: Listing; open: OpenOptions; size: number }
const state = {
  view: 'home', items: [] as InFile[], archive: null as Archive | null, cwd: '', sel: new Set<string>(), sort: { key: 'name', dir: 1 },
  search: '', previewing: '', edit: null as null | { remove: Set<string>; rename: Map<string, string>; add: InFile[] },
};

// ------------------------------------------------------------------ views
function show(view: string) {
  state.view = view;
  $$('.view').forEach(v => (v.hidden = v.id !== `v-${view}`));
  $$('nav button').forEach(b => (b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (view === 'compress') renderItems();
  if (view === 'browse') renderArchive();
  if (view === 'history') renderHistory();
  if (view === 'tools') renderDupes();
  if (view === 'settings') renderSettings();
}
$$('nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view!)));

// ------------------------------------------------------------------ getting files in
type FSEntry = { isFile: boolean; isDirectory: boolean; name: string; file(cb: (f: File) => void, err: (e: unknown) => void): void; createReader(): { readEntries(cb: (e: FSEntry[]) => void, err: (e: unknown) => void): void } };
async function readEntry(entry: FSEntry, prefix: string, out: InFile[]) {
  if (entry.isFile) { const f = await new Promise<File>((res, rej) => entry.file(res, rej)); out.push({ path: prefix + entry.name, data: f }); return; }
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise<FSEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) await readEntry(e, `${prefix}${entry.name}/`, out);
  }
}
async function filesFromDrop(dt: DataTransfer): Promise<InFile[]> {
  const out: InFile[] = [];
  const entries = [...dt.items].map(i => (i.kind === 'file' ? (i as unknown as { webkitGetAsEntry(): FSEntry | null }).webkitGetAsEntry() : null)).filter(Boolean) as FSEntry[];
  if (entries.length) { for (const e of entries) await readEntry(e, '', out); return out; }
  return [...dt.files].map(f => ({ path: f.name, data: f }));
}
const fromInput = (inp: HTMLInputElement): InFile[] => [...(inp.files ?? [])].map(f => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: f }));
function pick(sel: '#fileIn' | '#dirIn' | '#arcIn'): Promise<InFile[]> {
  return new Promise(res => { const inp = $<HTMLInputElement>(sel); inp.value = ''; inp.onchange = () => res(fromInput(inp)); inp.click(); });
}

/** pakket's drop behaviour: archives open (or extract when there are several), everything else is compressed */
async function route(files: InFile[], how: Settings['drop'] = S.drop) {
  if (!files.length) return;
  const archives = files.filter(f => isArchiveName(f.path) && !f.path.includes('/'));
  if (how === 'open' || (how === 'auto' && archives.length === files.length)) {
    const sets = groupVolumes(archives.length ? archives : files);
    if (sets.length === 1) return openArchive(sets[0]);
    for (const set of sets) extractAll(set, archiveBase(set[0].path));
    show('home');
    return toast(t('Extracting {n} archives', { n: sets.length }));
  }
  addItems(files);
}
/** Group volumes of the same set (a.7z.001, a.7z.002 ...) so they open together */
function groupVolumes(files: InFile[]): InFile[][] {
  const sets = new Map<string, InFile[]>();
  for (const f of files) { const v = volumeInfo(f.path); const key = v ? v.base : /\.zip$/i.test(f.path) && files.some(x => volumeInfo(x.path)?.base === f.path) ? f.path : f.path; sets.set(key, [...(sets.get(key) ?? []), f]); }
  return [...sets.values()];
}

// drag and drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('#dropOverlay').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#dropOverlay').hidden = true;
  if (!e.dataTransfer) return;
  const files = await filesFromDrop(e.dataTransfer);
  if (state.view === 'compress') addItems(files);
  else if (state.view === 'browse' && state.edit) { state.edit.add.push(...files.map(f => ({ ...f, path: state.cwd + f.path }))); renderArchive(); }
  else if (state.view === 'tools' && !$('#t-sums').hidden) hashFiles(files);
  else route(files);
});
document.addEventListener('paste', e => { const files = [...(e.clipboardData?.files ?? [])].map(f => ({ path: f.name, data: f as Blob })); if (files.length && !(e.target as HTMLElement).matches('input, textarea')) route(files); });
$('#pickFiles').onclick = async () => route(await pick('#fileIn'), 'compress');
$('#pickFolder').onclick = async () => route(await pick('#dirIn'), 'compress');
$('#pickArchive').onclick = $('#pickArchive2').onclick = async () => route(await pick('#arcIn'), 'open');
$('#drop').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pickFiles').click(); });

// ------------------------------------------------------------------ compress
function addItems(files: InFile[]) {
  const have = new Set(state.items.map(f => f.path));
  state.items.push(...files.filter(f => !have.has(f.path)));
  if (!$<HTMLInputElement>('#oName').value || $<HTMLInputElement>('#oName').dataset.auto) { const n = defaultName(); $<HTMLInputElement>('#oName').value = n; $<HTMLInputElement>('#oName').dataset.auto = '1'; }
  show('compress');
}
const tops = (files: InFile[]) => [...new Set(files.map(f => f.path.split('/')[0]))];
function defaultName() { const t0 = tops(state.items); return t0.length === 1 ? t0[0].replace(/\.[^.]+$/, '') || t0[0] : 'Archive'; }
function renderItems() {
  const list = $('#itemList'); list.replaceChildren();
  const groups = new Map<string, InFile[]>();
  for (const f of state.items) { const k = f.path.split('/')[0]; groups.set(k, [...(groups.get(k) ?? []), f]); }
  for (const [top, files] of groups) {
    const size = files.reduce((s, f) => s + f.data.size, 0), folder = files.some(f => f.path.includes('/'));
    list.append(h('li', {}, h('span', {}, folder ? '📁' : '📄'), h('span', { class: 'name', title: top }, top), h('span', { class: 'muted small' }, folder ? `${files.length} ${t('files')} · ${humanSize(size)}` : humanSize(size)),
      h('button', { title: t('Remove'), 'aria-label': `${t('Remove')} ${top}`, onclick: () => { state.items = state.items.filter(f => f.path.split('/')[0] !== top); renderItems(); } }, '✕')));
  }
  if (!state.items.length) list.append(h('li', { class: 'muted' }, t('Nothing yet. Drop files here or use Add files.')));
  $('#itemsTotal').textContent = state.items.length ? `${state.items.length} ${t('files')} · ${humanSize(state.items.reduce((s, f) => s + f.data.size, 0))}` : '';
  syncOptions();
}
$('#addFiles').onclick = async () => addItems(await pick('#fileIn'));
$('#addFolder').onclick = async () => addItems(await pick('#dirIn'));
$('#clearItems').onclick = () => { state.items = []; $<HTMLInputElement>('#oName').value = ''; renderItems(); };

// options form
const fmtSel = $<HTMLSelectElement>('#oFormat');
for (const g of ['Archives', 'Compressed tarballs', 'Single files', 'Encryption']) {
  const og = h('optgroup', { label: t(g) });
  for (const f of CREATE.filter(x => x.group === g)) og.append(h('option', { value: f.id }, f.label));
  fmtSel.append(og);
}
const splitSel = $<HTMLSelectElement>('#oSplit');
splitSel.append(h('option', { value: '0' }, t('No')), ...SPLIT_PRESETS.map(([l, n]) => h('option', { value: String(n) }, l)), h('option', { value: 'custom' }, t('Custom size…')));
function loadOptions(o: Partial<Settings>) {
  fmtSel.value = o.format ?? S.format; $<HTMLInputElement>('#oLevel').value = String(o.level ?? S.level);
  $<HTMLInputElement>('#oSolid').checked = o.solid ?? S.solid; $<HTMLInputElement>('#oNames').checked = o.encryptNames ?? S.encryptNames;
  $<HTMLInputElement>('#oLegacy').checked = o.zipLegacy ?? S.zipLegacy; $<HTMLInputElement>('#oMac').checked = o.excludeMac ?? S.excludeMac;
  $<HTMLInputElement>('#oSeparate').checked = o.separate ?? S.separate; $<HTMLSelectElement>('#oChecksum').value = o.checksum ?? S.checksum;
  $<HTMLInputElement>('#oExportPw').checked = o.exportPassword ?? S.exportPassword; $<HTMLInputElement>('#oExclude').value = o.exclude ?? S.exclude;
  const sp = o.split ?? S.split; splitSel.value = SPLIT_PRESETS.some(([, n]) => n === sp) || !sp ? String(sp || 0) : 'custom';
  if (splitSel.value === 'custom') $<HTMLInputElement>('#oSplitCustom').value = `${Math.round(sp / 1024 / 1024)}m`;
  syncOptions();
}
function readOptions(): Partial<Settings> {
  const split = splitSel.value === 'custom' ? parseSize($<HTMLInputElement>('#oSplitCustom').value) ?? 0 : +splitSel.value;
  return { format: fmtSel.value as FormatId, level: +$<HTMLInputElement>('#oLevel').value, solid: $<HTMLInputElement>('#oSolid').checked, encryptNames: $<HTMLInputElement>('#oNames').checked,
    zipLegacy: $<HTMLInputElement>('#oLegacy').checked, excludeMac: $<HTMLInputElement>('#oMac').checked, separate: $<HTMLInputElement>('#oSeparate').checked,
    checksum: $<HTMLSelectElement>('#oChecksum').value as Settings['checksum'], exportPassword: $<HTMLInputElement>('#oExportPw').checked, exclude: $<HTMLInputElement>('#oExclude').value, split };
}
function syncOptions() {
  const f = formatById(fmtSel.value)!;
  $('#rowLevel').hidden = !f.levels; $('#oLevelOut').textContent = $<HTMLInputElement>('#oLevel').value;
  $('#rowPassword').hidden = !f.password; $('#rowNames').hidden = f.id !== '7z'; $('#rowLegacy').hidden = f.id !== 'zip';
  $('#rowRecipients').hidden = f.id !== 'age'; $('#rowSolid').hidden = !f.solid; $('#rowSplit').hidden = !f.split;
  $('#oSplitCustom').hidden = splitSel.value !== 'custom';
  const many = state.items.length > 1 || state.items.some(x => x.path.includes('/'));
  $('#doCompress').textContent = f.single && many && !$<HTMLInputElement>('#oSeparate').checked ? `${t('Compress')} (${fmtSel.value === 'age' ? 'tar.age' : 'tar.' + f.id})` : t('Compress');
  strength($<HTMLInputElement>('#oPassword').value, '#pwBar', '#pwInfo');
}
$('#optForm').addEventListener('input', e => { if ((e.target as HTMLElement).id === 'oName') delete $<HTMLInputElement>('#oName').dataset.auto; syncOptions(); });
$('#showPw').onclick = () => { const p = $<HTMLInputElement>('#oPassword'); p.type = p.type === 'password' ? 'text' : 'password'; };
$('#genPw').onclick = () => { const p = $<HTMLInputElement>('#oPassword'); p.value = genPassword(24, true); p.type = 'text'; syncOptions(); };
$('#savePreset').onclick = async () => {
  const name = await ask(t('Save as preset'), [{ id: 'n', label: t('Name'), value: fmtSel.value }]); if (!name?.n) return;
  savePreset({ name: name.n, options: readOptions() }); renderPresets(); toast(t('Preset saved'));
};
function renderPresets() {
  const sel = $<HTMLSelectElement>('#presetSel'); sel.replaceChildren(h('option', { value: '' }, t('Presets')), ...presets().map(p => h('option', { value: p.name }, p.name)));
}
$('#presetSel').addEventListener('change', e => { const p = presets().find(x => x.name === (e.target as HTMLSelectElement).value); if (p) { loadOptions(p.options); toast(`${t('Preset')}: ${p.name}`); } (e.target as HTMLSelectElement).value = ''; });

$('#optForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.items.length) return toast(t('Add some files first'));
  const o = readOptions();
  Object.assign(S, o); saveSettings();
  const pw = $<HTMLInputElement>('#oPassword').value;
  const f = formatById(o.format!)!;
  if (f.id === 'age' && !pw && !$<HTMLTextAreaElement>('#oRecipients').value.trim()) return toast(t('age needs a password or a public key'));
  const recipients = $<HTMLTextAreaElement>('#oRecipients').value.split(/\s+/).filter(x => x.startsWith('age1'));
  const name = ($<HTMLInputElement>('#oName').value.trim() || defaultName()).replace(/[\\/:*?"<>|]/g, '_');
  const groups = o.separate ? tops(state.items).map(tp => ({ name: tp.replace(/\.[^.]+$/, '') || tp, files: state.items.filter(x => x.path === tp || x.path.startsWith(tp + '/')) })) : [{ name, files: state.items }];
  for (const g of groups) {
    const options: CreateOptions = { format: o.format!, name: g.name, level: o.level, password: f.password ? pw || undefined : undefined, encryptNames: o.encryptNames, zipLegacy: o.zipLegacy,
      solid: o.solid, splitBytes: f.split ? o.split || undefined : undefined, excludeMac: o.excludeMac, exclude: (o.exclude || '').split(',').map(x => x.trim()).filter(Boolean), recipients };
    const { job, promise } = run<OutFile[]>('create', { inputs: g.files, options }, `${t('Compress')} ${g.name}${f.ext}`);
    promise.then(async out => {
      const extras: OutFile[] = [];
      if (o.checksum && o.checksum !== 'none') for (const a of out) {
        const r = await run<Record<string, string>>('hash', { blob: blobOf(a.data), algos: [o.checksum] }, 'hash', { quiet: true }).promise;
        extras.push({ path: `${a.path}.${o.checksum}`, data: new TextEncoder().encode(`${r[o.checksum]}  ${a.path}\n`) });
      }
      if (o.exportPassword && pw) extras.push({ path: `${archiveBase(out[0].path)}-password.txt`, data: new TextEncoder().encode(pw + '\n') });
      (job as Job & { outputs?: OutFile[] }).outputs = [...out, ...extras];
      await deliver([...out, ...extras], job, false);
      logJob(job, true, out.reduce((s, x) => s + x.data.length, 0));
    }, err => logJob(job, false, 0, (err as Error).message));
  }
});

/** Save outputs per the settings; extracted trees get the smart-folder treatment first */
async function deliver(files: OutFile[], job: Job, extracted: boolean, base = '') {
  const real = files.filter(f => !f.path.endsWith('/'));
  if (!real.length) return toast(t('Nothing to save'));
  const tree = extracted ? wrapFolder(files, base, S.folder) : files;
  if (S.save === 'folder' && canPickFolder()) {
    try { const n = await saveToFolder(tree); toast(t('Saved {n} files', { n })); } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message); }
    return;
  }
  if (real.length === 1 || !extracted) { for (const f of tree.filter(x => !x.path.endsWith('/'))) download(f.path, f.data); return; }
  // several extracted files and no folder access: one stored zip
  const zipName = base || 'extracted';
  const r = await run<OutFile[]>('create', { inputs: tree.filter(x => !x.path.endsWith('/')).map(f => ({ path: f.path, data: blobOf(f.data) })), options: { format: 'zip', name: zipName, level: 0 } }, `${t('Packing')} ${zipName}.zip`).promise;
  download(r[0].path, r[0].data);
  toast(t('This browser can\'t write to a folder, so the files came as one zip.'));
  void job;
}

// ------------------------------------------------------------------ open and browse an archive
async function withPassword<T>(fn: (o: OpenOptions) => Promise<T>, o: OpenOptions, label: string): Promise<T> {
  for (;;) {
    try { return await fn(o); } catch (e) {
      if (!(e instanceof JobError) || e.code !== 'WRONG_PASSWORD') throw e;
      const isAge = /\.age$/i.test(label);
      const r = await ask(o.password ? t('Wrong password, try again') : t('Password for {name}', { name: label }), [
        { id: 'pw', label: t('Password'), type: 'password' } as Field,
        ...(isAge ? [{ id: 'id', label: t('Or an age secret key (AGE-SECRET-KEY-1…)'), type: 'textarea' } as Field] : []),
      ]);
      if (!r) throw new JobError('CANCELLED', t('Cancelled'));
      o = { ...o, password: r.pw, identities: r.id ? [r.id] : o.identities };
    }
  }
}

async function openArchive(inputs: InFile[]) {
  const name = inputs.length > 1 ? inputs.map(f => f.path).sort()[0] : inputs[0].path;
  toast(t('Opening {name}…', { name }));
  try {
    const open: OpenOptions = { encoding: 'auto' };
    let used = open;
    const listing = await withPassword(async o => { used = o; return run<Listing>('list', { inputs, open: o }, `${t('Open')} ${name}`, { quiet: true }).promise; }, open, name);
    state.archive = { inputs, name, listing, open: used, size: inputs.reduce((s, f) => s + f.data.size, 0) };
    state.cwd = ''; state.sel.clear(); state.search = ''; state.edit = null; state.previewing = '';
    $<HTMLInputElement>('#search').value = '';
    $('#preview').replaceChildren(h('p', { class: 'muted' }, t('Select a file to preview it here, without extracting the archive.')));
    show('browse');
  } catch (e) { if ((e as JobError).code !== 'CANCELLED') toast(`${t('Could not open')} ${name}: ${(e as Error).message}`); }
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const baseName = (p: string) => p.replace(/\/$/, '').split('/').pop()!;
function allFolders(entries: Entry[]) {
  const set = new Set<string>(['']);
  for (const e of entries) { const parts = e.path.split('/'); for (let i = 1; i < parts.length + (e.dir ? 1 : 0); i++) set.add(parts.slice(0, i).join('/') + '/'); }
  return [...set].sort();
}
function viewEntries(): Entry[] {
  const A = state.archive!; let es = A.listing.entries;
  if (state.edit) {
    const ed = state.edit;
    es = es.filter(e => ![...ed.remove].some(r => e.path === r || e.path.startsWith(r + '/'))).map(e => (ed.rename.has(e.path) ? { ...e, path: ed.rename.get(e.path)! } : e));
    es = [...es, ...ed.add.map(f => ({ path: f.path, size: f.data.size, packed: 0, modified: t('new'), dir: false, encrypted: false, crc: '', method: '', attributes: '' }))];
  }
  return es;
}
function renderArchive() {
  const A = state.archive;
  $('#noArchive').hidden = !!A; $('#archiveView').hidden = !A;
  if (!A) return;
  const L = A.listing, files = L.entries.filter(e => !e.dir);
  const total = files.reduce((s, e) => s + e.size, 0);
  $('#arcName').textContent = A.name;
  $('#arcInfo').textContent = [L.type + (L.layers.length ? ` (${L.layers.join(' + ')})` : ''), `${files.length} ${t('files')}`, `${humanSize(total)} → ${humanSize(A.size)}`,
    total ? `${Math.round((A.size / total) * 100)}%` : '', L.encrypted ? `🔒 ${t('encrypted')}` : '', A.inputs.length > 1 ? `${A.inputs.length} ${t('volumes')}` : ''].filter(Boolean).join(' · ');
  $('#editBar').hidden = !state.edit;
  $('#aEdit').hidden = !!state.edit;
  if (state.edit) $('#editInfo').textContent = `${state.edit.remove.size} ${t('removed')} · ${state.edit.rename.size} ${t('renamed')} · ${state.edit.add.length} ${t('added')}`;
  // encoding chooser for zips whose names may need it
  $('#encRow').hidden = !/zip/i.test(L.type);
  const es = viewEntries();
  // folder tree
  const tree = $('#tree'); tree.replaceChildren();
  for (const f of allFolders(es)) {
    const depth = f ? f.split('/').length - 2 : 0;
    tree.append(h('div', { style: `padding-left:${6 + depth * 14}px`, 'aria-current': String(f === state.cwd), onclick: () => { state.cwd = f; state.search = ''; $<HTMLInputElement>('#search').value = ''; renderArchive(); } }, f ? `📁 ${baseName(f)}` : `🗂 ${A.name}`));
  }
  // table
  const q = state.search.toLowerCase();
  let rows: (Entry & { folder?: boolean })[] = q ? es.filter(e => e.path.toLowerCase().includes(q)) : [
    ...allFolders(es).filter(f => f && parentOf(f.slice(0, -1)) === state.cwd).map(f => ({ path: f, size: es.filter(e => e.path.startsWith(f) && !e.dir).reduce((s, e) => s + e.size, 0), packed: 0, modified: '', dir: true, encrypted: false, crc: '', method: '', attributes: '', folder: true })),
    ...es.filter(e => !e.dir && parentOf(e.path) === state.cwd),
  ];
  const { key, dir } = state.sort;
  const val = (e: Entry) => (key === 'name' ? baseName(e.path).toLowerCase() : key === 'ratio' ? (e.size ? e.packed / e.size : 0) : (e as unknown as Record<string, number | string>)[key]);
  rows = rows.sort((a, b) => (Number(b.dir) - Number(a.dir)) || (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
  const tbody = $('#table').querySelector('tbody')!; tbody.replaceChildren();
  const LIMIT = 3000;
  for (const e of rows.slice(0, LIMIT)) {
    const id = e.dir && !e.path.endsWith('/') ? e.path + '/' : e.path;
    const tr = h('tr', { tabIndex: 0, class: state.sel.has(id) ? 'sel' : '', ondblclick: () => (e.dir ? ((state.cwd = id), renderArchive()) : previewEntry(e.path)), onclick: (ev: MouseEvent) => { if ((ev.target as HTMLElement).matches('input')) return; if (!e.dir) previewEntry(e.path); else { state.cwd = id; renderArchive(); } } },
      h('td', { class: 'ck' }, h('input', { type: 'checkbox', checked: state.sel.has(id), 'aria-label': `${t('Select')} ${baseName(e.path)}`, onchange: (ev: Event) => { (ev.target as HTMLInputElement).checked ? state.sel.add(id) : state.sel.delete(id); tr.classList.toggle('sel'); } })),
      h('td', { class: 'nm', title: e.path }, `${e.dir ? '📁 ' : ''}${q ? e.path : baseName(e.path)}`, e.encrypted ? h('span', { class: 'lock', title: t('encrypted') }, ' 🔒') : ''),
      h('td', { class: 'num' }, humanSize(e.size)), h('td', { class: 'num', title: !e.dir && !e.packed && e.size ? t('Packed together with other files (solid archive)') : '' }, e.dir || (!e.packed && e.size) ? '' : humanSize(e.packed)),
      h('td', { class: 'num' }, e.size && e.packed ? `${Math.round((e.packed / e.size) * 100)}%` : ''), h('td', { class: 'small muted' }, e.modified.slice(0, 16)),
      h('td', {}, !e.dir ? h('button', { class: 'btn small', onclick: (ev: Event) => { ev.stopPropagation(); extractSome([e.path]); } }, '⤓') : ''));
    (tr as HTMLElement & { entry?: Entry }).entry = e;
    tbody.append(tr);
  }
  if (rows.length > LIMIT) tbody.append(h('tr', {}, h('td', { colSpan: 7, class: 'muted' }, t('{n} more; search to narrow it down', { n: rows.length - LIMIT }))));
  if (!rows.length) tbody.append(h('tr', {}, h('td', { colSpan: 7, class: 'muted' }, q ? t('No matches') : t('This folder is empty'))));
  // size by type
  const byExt = new Map<string, number>();
  for (const e of files) { const x = (/\.([^./]+)$/.exec(e.path)?.[1] || '—').toLowerCase(); byExt.set(x, (byExt.get(x) ?? 0) + e.size); }
  const top = [...byExt].sort((a, b) => b[1] - a[1]), colors = ['#c9781f', '#3b82c4', '#2f8f4e', '#b05bd6', '#d4a72c', '#c43c3c', '#8a8f98'];
  const bar = $('#sizeBar'); bar.replaceChildren();
  const shown = top.slice(0, 6), rest = top.slice(6).reduce((s, x) => s + x[1], 0);
  [...shown, ...(rest ? [['other', rest] as [string, number]] : [])].forEach(([x, n], i) => bar.append(h('i', { style: `width:${(n / Math.max(1, total)) * 100}%;background:${colors[i]}`, title: `.${x} ${humanSize(n)} (${Math.round((n / Math.max(1, total)) * 100)}%)` })));
}
$$('#table th[data-sort]').forEach(th => th.addEventListener('click', () => { const k = th.dataset.sort!; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; renderArchive(); }));
$('#search').addEventListener('input', e => { state.search = (e.target as HTMLInputElement).value; renderArchive(); });
$('#selAll').addEventListener('change', e => { const on = (e.target as HTMLInputElement).checked; $$('#table tbody tr').forEach(tr => { const en = (tr as HTMLElement & { entry?: Entry }).entry; if (!en) return; const id = en.dir && !en.path.endsWith('/') ? en.path + '/' : en.path; on ? state.sel.add(id) : state.sel.delete(id); }); renderArchive(); });
$<HTMLSelectElement>('#encSel').append(...ENCODINGS.map(([v, l]) => h('option', { value: v }, t(l))));
$('#encSel').addEventListener('change', async e => {
  const A = state.archive!; A.open = { ...A.open, encoding: (e.target as HTMLSelectElement).value };
  A.listing = await run<Listing>('list', { inputs: A.inputs, open: A.open }, 'list', { quiet: true }).promise; renderArchive();
});

async function previewEntry(path: string) {
  const A = state.archive!; state.previewing = path;
  const entry = A.listing.entries.find(e => e.path === path);
  const box = $('#preview');
  const added = state.edit?.add.find(f => f.path === path);
  if (added) return renderPreview(box, path, new Uint8Array(await added.data.arrayBuffer()));
  if (!entry) return;
  if (entry.size > MAX_PREVIEW) return box.replaceChildren(h('p', { class: 'muted' }, t('Too big to preview ({size}). Extract it instead.', { size: humanSize(entry.size) })));
  box.replaceChildren(h('p', { class: 'muted' }, t('Loading preview…')));
  try {
    const r = await withPassword(o => run<Extracted>('extract', { inputs: A.inputs, open: { ...o, only: [path] } }, 'preview', { quiet: true }).promise, A.open, A.name);
    const f = r.files.find(x => x.path === path) ?? r.files.find(x => !x.path.endsWith('/'));
    if (state.previewing === path && f) renderPreview(box, path, f.data);
  } catch (e) { box.replaceChildren(h('p', { class: 'bad' }, (e as Error).message)); }
}

function extractAll(inputs: InFile[], base: string, open: OpenOptions = {}) {
  const name = inputs.map(f => f.path).sort()[0];
  const { job, promise } = run<Extracted>('extract', { inputs, open }, `${t('Extract')} ${name}`);
  promise.then(async r => { await deliver(r.files, job, true, base); if (r.skipped.length) toast(t('Skipped {n} unsafe paths', { n: r.skipped.length })); logJob(job, true, r.files.reduce((s, f) => s + f.data.length, 0)); },
    async err => {
      logJob(job, false, 0, (err as Error).message);
      if ((err as JobError).code === 'WRONG_PASSWORD') { const r = await ask(t('Password for {name}', { name }), [{ id: 'pw', label: t('Password'), type: 'password' }]); if (r) extractAll(inputs, base, { ...open, password: r.pw }); }
      else toast(`${name}: ${(err as Error).message}`);
    });
}
function extractSome(paths: string[]) {
  const A = state.archive!;
  const only = paths.map(p => (p.endsWith('/') ? p.slice(0, -1) : p));
  const { job, promise } = run<Extracted>('extract', { inputs: A.inputs, open: { ...A.open, only } }, `${t('Extract')} ${paths.length} ${t('items')}`);
  promise.then(r => { deliver(r.files, job, true, archiveBase(A.name)); logJob(job, true, r.files.reduce((s, f) => s + f.data.length, 0)); }, err => { toast((err as Error).message); logJob(job, false, 0, (err as Error).message); });
}
$('#aExtract').onclick = () => { const A = state.archive!; extractAll(A.inputs, archiveBase(A.name), A.open); };
$('#aExtractSel').onclick = () => (state.sel.size ? extractSome([...state.sel]) : toast(t('Select some files first')));
$('#aTest').onclick = () => {
  const A = state.archive!;
  const { job, promise } = run<{ ok: boolean; message: string }>('test', { inputs: A.inputs, open: A.open }, `${t('Test')} ${A.name}`);
  promise.then(r => { toast(r.ok ? `✓ ${A.name}: ${r.message}` : `✗ ${A.name}: ${r.message}`); job.text = r.message; logJob(job, r.ok, 0, r.message); }, err => toast((err as Error).message));
};
$('#aClose').onclick = () => { state.archive = null; state.edit = null; show('home'); };
$('#aConvert').onclick = async () => {
  const A = state.archive!;
  const r = await ask(t('Convert {name}', { name: A.name }), [
    { id: 'fmt', label: t('Format'), type: 'select', options: CREATE.filter(f => !f.single || f.id === 'age').map(f => [f.id, f.label]), value: '7z' },
    { id: 'pw', label: t('Password (optional)'), type: 'password' }, { id: 'lvl', label: t('Compression (0-9)'), type: 'number', value: '5' }]);
  if (!r) return;
  const f = formatById(r.fmt)!, name = archiveBase(A.name);
  const { job, promise } = run<OutFile[]>('convert', { inputs: A.inputs, open: A.open, options: { format: f.id, name, level: +r.lvl, password: f.password ? r.pw || undefined : undefined, encryptNames: true } }, `${t('Convert')} ${A.name} → ${f.ext}`);
  promise.then(out => { deliver(out, job, false); logJob(job, true, out.reduce((s, x) => s + x.data.length, 0)); }, err => { toast((err as Error).message); logJob(job, false, 0, (err as Error).message); });
};

// editing: remove, rename, add, then save as
$('#aEdit').onclick = () => { state.edit = { remove: new Set(), rename: new Map(), add: [] }; renderArchive(); };
$('#eCancel').onclick = () => { state.edit = null; renderArchive(); };
$('#eDelete').onclick = () => { if (!state.sel.size) return toast(t('Select some files first')); for (const p of state.sel) state.edit!.remove.add(p.replace(/\/$/, '')); state.edit!.add = state.edit!.add.filter(f => !state.sel.has(f.path)); state.sel.clear(); renderArchive(); };
$('#eRename').onclick = async () => {
  if (state.sel.size !== 1) return toast(t('Select one file or folder to rename'));
  const from = [...state.sel][0].replace(/\/$/, '');
  const r = await ask(t('Rename'), [{ id: 'to', label: t('New name'), value: baseName(from) }]); if (!r?.to) return;
  const to = parentOf(from) + r.to.replace(/[/\\]/g, '_');
  if (!safePath(to)) return toast(t('Not a valid name'));
  state.edit!.rename.set(from, to); state.sel.clear(); renderArchive();
};
$('#eAdd').onclick = async () => { const files = await pick('#fileIn'); state.edit!.add.push(...files.map(f => ({ ...f, path: state.cwd + f.path }))); renderArchive(); };
$('#eSave').onclick = async () => {
  const A = state.archive!, ed = state.edit!;
  const sameType = CREATE.find(f => A.name.toLowerCase().endsWith(f.ext) && !f.single)?.id ?? '7z';
  const r = await ask(t('Save the changes as'), [{ id: 'fmt', label: t('Format'), type: 'select', options: CREATE.filter(f => !f.single).map(f => [f.id, f.label]), value: sameType }, { id: 'pw', label: t('Password (optional)'), type: 'password', value: A.open.password ?? '' }]);
  if (!r) return;
  const f = formatById(r.fmt)!, name = archiveBase(A.name);
  const rename: [string, string][] = [];
  for (const [from, to] of ed.rename) rename.push([from, to]);
  const { job, promise } = run<OutFile[]>('edit', { inputs: A.inputs, open: A.open, changes: { remove: [...ed.remove], rename, add: ed.add }, options: { format: f.id, name, password: f.password ? r.pw || undefined : undefined, encryptNames: true } }, `${t('Save')} ${name}${f.ext}`);
  promise.then(async out => { await deliver(out, job, false); logJob(job, true, out.reduce((s, x) => s + x.data.length, 0)); state.edit = null; openArchive(out.map(o => ({ path: o.path, data: blobOf(o.data) }))); }, err => toast((err as Error).message));
};

// ------------------------------------------------------------------ tools
$$('.tabs button').forEach(b => b.addEventListener('click', () => { $$('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b))); $$('.tab').forEach(tb => (tb.hidden = tb.id !== `t-${b.dataset.tab}`)); if (b.dataset.tab === 'dupes') renderDupes(); }));
$<HTMLSelectElement>('#sumAlgos').append(...ALGO_NAMES.map(a => h('option', { value: a, selected: a === 'sha256' }, a.toUpperCase())));
$<HTMLSelectElement>('#sumAlgos').size = 4;
const sums: { name: string; size: number; hashes: Record<string, string> }[] = [];
async function hashFiles(files: InFile[]) {
  const algos = [...$<HTMLSelectElement>('#sumAlgos').selectedOptions].map(o => o.value as Algo);
  if (!algos.length) algos.push('sha256');
  for (const f of files) {
    const { promise } = run<Record<string, string>>('hash', { blob: f.data, algos }, `${t('Checksum')} ${f.path}`);
    sums.unshift({ name: f.path, size: f.data.size, hashes: await promise });
    renderSums();
  }
}
function renderSums() {
  const expected = parseChecksumList($<HTMLTextAreaElement>('#sumList').value);
  const tb = $('#sumTable'); tb.replaceChildren();
  for (const s of sums) for (const [algo, hex] of Object.entries(s.hashes)) {
    const want = expected.find(x => (x.name === s.name || x.name.split('/').pop() === s.name.split('/').pop()) && algoForLength(x.hash.length) === algo);
    tb.append(h('tr', {}, h('td', { class: 'nm' }, s.name), h('td', { class: 'small' }, algo.toUpperCase()), h('td', { class: 'mono small nm' }, hex),
      h('td', {}, want ? (want.hash === hex ? h('span', { class: 'ok' }, `✓ ${t('matches')}`) : h('span', { class: 'bad' }, `✗ ${t('does not match')}`)) : ''),
      h('td', {}, h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(hex).then(() => toast(t('Copied'))) }, t('Copy')))));
  }
}
$('#sumPick').onclick = async () => hashFiles(await pick('#fileIn'));
$('#sumList').addEventListener('input', renderSums);
const cmp: { a?: { name: string; l: Listing }; b?: { name: string; l: Listing } } = {};
for (const side of ['a', 'b'] as const) $(`#cmp${side.toUpperCase()}`).onclick = async () => {
  const files = await pick('#arcIn'); if (!files.length) return;
  const name = files.map(f => f.path).sort()[0];
  const l = await withPassword(o => run<Listing>('list', { inputs: files, open: o }, 'list', { quiet: true }).promise, {}, name);
  cmp[side] = { name, l }; $(`#cmp${side.toUpperCase()}`).textContent = `${side.toUpperCase()}: ${name}`; renderCompare();
};
function renderCompare() {
  const out = $('#cmpOut'); out.replaceChildren();
  if (!cmp.a || !cmp.b) return;
  const d = compareListings(cmp.a.l.entries, cmp.b.l.entries);
  out.append(h('p', {}, t('{same} the same, {added} added, {removed} removed, {changed} changed.', { same: d.same, added: d.added.length, removed: d.removed.length, changed: d.changed.length })));
  for (const [label, list, cls] of [[t('Added in B'), d.added, 'ok'], [t('Removed in B'), d.removed, 'bad'], [t('Changed'), d.changed, '']] as const)
    if (list.length) out.append(h('h3', {}, `${label} (${list.length})`), h('ul', { class: cls }, ...list.slice(0, 500).map(p => h('li', { class: 'mono small' }, p))));
}
function renderDupes() {
  const out = $('#dupOut'); out.replaceChildren();
  if (!state.archive) return out.append(h('p', { class: 'muted' }, t('Open an archive first.')));
  const groups = duplicates(state.archive.listing.entries);
  if (!groups.length) return out.append(h('p', { class: 'ok' }, t('No duplicates in {name}.', { name: state.archive.name })));
  const wasted = groups.reduce((s, g) => s + (g.length - 1) * (state.archive!.listing.entries.find(e => e.path === g[0])?.size ?? 0), 0);
  out.append(h('p', {}, t('{n} groups of identical files; {size} could be saved.', { n: groups.length, size: humanSize(wasted) })), ...groups.map(g => h('ul', {}, ...g.map(p => h('li', { class: 'mono small' }, p)))));
}
// passwords
function genPassword(len: number, symbols: boolean) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' + (symbols ? '!#$%&*+-=?@^_~' : '');
  const out: string[] = [], buf = new Uint32Array(len * 2);
  crypto.getRandomValues(buf);
  for (const x of buf) { const lim = Math.floor(2 ** 32 / chars.length) * chars.length; if (x < lim) out.push(chars[x % chars.length]); if (out.length === len) break; }
  return out.join('');
}
function genWords(n: number) { const buf = new Uint32Array(n); crypto.getRandomValues(buf); return Array.from(buf, x => WORDS[x % WORDS.length]).join('-'); }
function entropy(pw: string) {
  if (!pw) return 0;
  if (/^[a-z]+(-[a-z]+)+$/.test(pw)) return pw.split('-').length * Math.log2(WORDS.length);
  let pool = 0; if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const repeats = pw.length - new Set(pw).size;
  return Math.max(0, (pw.length - repeats * 0.5) * Math.log2(Math.max(pool, 2)));
}
function strength(pw: string, barSel: string, infoSel: string) {
  const bits = entropy(pw), bar = $(barSel);
  bar.style.width = `${Math.min(100, (bits / 100) * 100)}%`;
  bar.style.background = bits < 40 ? 'var(--bad)' : bits < 70 ? '#d4a72c' : 'var(--ok)';
  $(infoSel).textContent = pw ? `${Math.round(bits)} ${t('bits')} · ${bits < 40 ? t('weak') : bits < 70 ? t('fair') : t('strong')}` : '';
}
$('#pwGen').onclick = () => { const v = $<HTMLInputElement>('#pwWords').checked ? genWords(Math.max(4, Math.round(+$<HTMLInputElement>('#pwLen').value / 5))) : genPassword(+$<HTMLInputElement>('#pwLen').value, $<HTMLInputElement>('#pwSym').checked); $('#pwOut').textContent = v; strength(v, '#pwBar2', '#pwInfo2'); };
$('#pwOut').addEventListener('click', () => navigator.clipboard?.writeText($('#pwOut').textContent || '').then(() => toast(t('Copied'))));
$('#pwTest').addEventListener('input', e => strength((e.target as HTMLInputElement).value, '#pwBar2', '#pwInfo2'));
$('#keyGen').onclick = async () => {
  const k = await run<{ identity: string; recipient: string }>('keygen', {}, t('age key pair'), { quiet: true }).promise;
  const file = `# created: ${new Date().toISOString()}\n# public key: ${k.recipient}\n${k.identity}\n`;
  $('#keyOut').replaceChildren(
    h('p', {}, h('b', {}, t('Public key')), h('br'), h('code', { class: 'mono' }, k.recipient), ' ', h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(k.recipient).then(() => toast(t('Copied'))) }, t('Copy'))),
    h('p', {}, h('b', {}, t('Secret key')), ' ', h('span', { class: 'muted small' }, t('shown once, save it now'))),
    h('button', { class: 'btn primary', onclick: () => download('age-key.txt', new TextEncoder().encode(file), 'text/plain') }, t('Download age-key.txt')));
};

// ------------------------------------------------------------------ history and settings
function logJob(job: Job, ok: boolean, outBytes: number, detail?: string) {
  addHistory({ when: Date.now(), op: job.op, title: job.title, ok, inBytes: job.inputBytes, outBytes, ms: Math.round((job.ended || performance.now()) - job.started), detail });
}
async function renderHistory() {
  const items = await readHistory(), tb = $('#histTable'); tb.replaceChildren();
  if (!items.length) return tb.append(h('tr', {}, h('td', { class: 'muted' }, t('Nothing yet.'))));
  tb.append(h('tr', {}, ...[t('When'), t('Job'), t('In'), t('Out'), t('Time'), ''].map(x => h('th', {}, x))));
  for (const i of items) tb.append(h('tr', {}, h('td', { class: 'small' }, new Date(i.when).toLocaleString()), h('td', { class: 'nm' }, i.title), h('td', { class: 'num' }, humanSize(i.inBytes)), h('td', { class: 'num' }, i.outBytes ? humanSize(i.outBytes) : ''), h('td', { class: 'num' }, `${(i.ms / 1000).toFixed(1)} s`), h('td', { class: i.ok ? 'ok' : 'bad', title: i.detail ?? '' }, i.ok ? '✓' : '✗')));
}
$('#histClear').onclick = async () => { await clearHistory(); renderHistory(); };
function renderSettings() {
  const sel = (id: string, items: [string, string][], val: string, on: (v: string) => void) => { const s = $<HTMLSelectElement>(id); s.replaceChildren(...items.map(([v, l]) => h('option', { value: v, selected: v === val }, l))); s.onchange = () => { on(s.value); saveSettings(); }; };
  sel('#sDrop', [['auto', t('Open archives, compress everything else')], ['compress', t('Always compress')], ['open', t('Always open as an archive')]], S.drop, v => (S.drop = v as Settings['drop']));
  sel('#sFolder', [['smart', t('Only when the archive holds several items')], ['always', t('Always')], ['never', t('Never')]], S.folder, v => (S.folder = v as Settings['folder']));
  sel('#sSave', [['download', t('Download')], ['folder', t('Into a folder I pick')]], S.save, v => (S.save = v as Settings['save']));
  $('#fsNote').textContent = canPickFolder() ? '' : t('This browser can\'t write to folders (Brave and Firefox turn that off), so results download instead.');
  $('#presetList').replaceChildren(...(presets().length ? presets().map(p => h('li', {}, h('span', { class: 'grow' }, p.name), h('span', { class: 'muted small' }, `${p.options.format} · ${t('level')} ${p.options.level}`), h('button', { class: 'btn small', onclick: () => { deletePreset(p.name); renderSettings(); renderPresets(); } }, t('Delete')))) : [h('li', { class: 'muted small' }, t('Save options as a preset from the Compress view.'))]));
}

// ------------------------------------------------------------------ job dock
onJobs(jobs => {
  const dock = $('#dock'), list = $('#jobList');
  dock.hidden = !jobs.length;
  requestAnimationFrame(padForDock);
  list.replaceChildren(...jobs.slice(0, 30).map(j => {
    const el = (performance.now() - j.started) / 1000, speed = j.started && j.progress > 0.02 ? (j.inputBytes * j.progress) / Math.max(0.1, el) : 0;
    const eta = j.progress > 0.05 && j.status === 'running' ? (el * (1 - j.progress)) / j.progress : 0;
    const outs = (j as Job & { outputs?: OutFile[] }).outputs;
    return h('li', {}, h('div', { class: 'row' }, h('b', { class: 'grow nm' }, j.title), j.status === 'running' || j.status === 'queued' ? h('button', { class: 'btn small', onclick: () => cancel(j.id) }, t('Cancel')) : h('span', { class: j.status === 'done' ? 'ok' : 'bad' }, j.status === 'done' ? '✓' : j.status === 'cancelled' ? t('cancelled') : '✗')),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(j.progress * 100)}%` })),
      h('div', { class: 'meta' }, h('span', {}, j.status === 'queued' ? t('waiting') : j.status === 'error' ? j.error?.message ?? '' : `${Math.round(j.progress * 100)}%`),
        speed ? h('span', {}, `${humanSize(speed)}/s`) : '', eta ? h('span', {}, `${Math.ceil(eta)} s ${t('left')}`) : '', j.status === 'done' && j.ended ? h('span', {}, `${((j.ended - j.started) / 1000).toFixed(1)} s`) : '',
        outs ? h('button', { class: 'btn small', onclick: () => deliver(outs, j, false) }, t('Save again')) : '',
        outs && outs.some(o => isArchiveName(o.path)) ? h('button', { class: 'btn small', onclick: () => openArchive(outs.filter(o => isArchiveName(o.path)).map(o => ({ path: o.path, data: blobOf(o.data) }))) }, t('Look inside')) : ''));
  }));
});
$('#dockClear').onclick = clearFinished;
$('#dockMin').onclick = () => { $('#dock').classList.toggle('min'); $('#dockMin').textContent = $('#dock').classList.contains('min') ? '▴' : '▾'; padForDock(); };
// keep the page scrollable past the dock, so it never hides a button
function padForDock() { const d = $('#dock'); $('main').style.paddingBottom = d.hidden ? '' : `${d.offsetHeight + 28}px`; }

// ------------------------------------------------------------------ dialogs
type Field = { id: string; label: string; type?: 'text' | 'password' | 'textarea' | 'select' | 'number'; value?: string; options?: (readonly [string, string])[] };
function ask(title: string, fields: Field[]): Promise<Record<string, string> | null> {
  const dlg = $<HTMLDialogElement>('#dlg');
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(...fields.map(f => h('label', {}, h('span', { class: 'muted small' }, f.label),
    f.type === 'textarea' ? h('textarea', { name: f.id, rows: 3, value: f.value ?? '' }) : f.type === 'select' ? h('select', { name: f.id }, ...(f.options ?? []).map(([v, l]) => h('option', { value: v, selected: v === f.value }, l))) : h('input', { name: f.id, type: f.type ?? 'text', value: f.value ?? '', autocomplete: 'off' }))));
  $('#dlgButtons').replaceChildren(h('button', { class: 'btn', value: 'cancel', formNoValidate: true }, t('Cancel')), h('button', { class: 'btn primary', value: 'ok' }, t('OK')));
  dlg.showModal();
  (dlg.querySelector('input, textarea, select') as HTMLElement | null)?.focus();
  return new Promise(res => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return res(null);
      const out: Record<string, string> = {};
      for (const f of fields) out[f.id] = ((dlg.querySelector(`[name="${f.id}"]`) as HTMLInputElement | null)?.value ?? '');
      res(out);
    };
  });
}
function help() {
  const dlg = $<HTMLDialogElement>('#dlg');
  $('#dlgTitle').textContent = t('Keyboard shortcuts');
  const keys: [string, string][] = [['c', t('Compress view')], ['o', t('Open an archive')], ['x', t('Extract all')], ['t', t('Test the archive')], ['/', t('Search in the archive')], ['Space', t('Select the focused row')], ['↑ ↓', t('Move between rows')], ['Enter', t('Open a folder or preview a file')], ['Backspace', t('Up one folder')], ['?', t('This help')], ['Esc', t('Close')]];
  $('#dlgBody').replaceChildren(h('table', { class: 'plain' }, ...keys.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))));
  $('#dlgButtons').replaceChildren(h('button', { class: 'btn primary', value: 'ok' }, t('OK')));
  dlg.onclose = null; dlg.showModal();
}
$('#helpBtn').onclick = help;

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', e => {
  const tgt = e.target as HTMLElement;
  if (tgt.matches('input, textarea, select') || $<HTMLDialogElement>('#dlg').open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); help(); }
  else if (e.key === 'c') show('compress');
  else if (e.key === 'o') $('#pickArchive').click();
  else if (e.key === 'x' && state.archive) $('#aExtract').click();
  else if (e.key === 't' && state.archive && state.view === 'browse') $('#aTest').click();
  else if (e.key === '/' && state.view === 'browse') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Backspace' && state.view === 'browse' && state.cwd) { state.cwd = parentOf(state.cwd.slice(0, -1)); renderArchive(); }
  else if (tgt.matches('tbody tr')) {
    const rows = $$('#table tbody tr'), i = rows.indexOf(tgt);
    if (e.key === 'ArrowDown') { e.preventDefault(); rows[i + 1]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rows[i - 1]?.focus(); }
    else if (e.key === ' ') { e.preventDefault(); (tgt.querySelector('input') as HTMLInputElement)?.click(); }
    else if (e.key === 'Enter') tgt.click();
  }
});

// ------------------------------------------------------------------ theme, language, start
const themeSel = $<HTMLSelectElement>('#themeSel');
function applyTheme() { if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = S.theme; }
function fillTheme() { themeSel.replaceChildren(...([['auto', t('Auto')], ['light', t('Light')], ['dark', t('Dark')], ['keka', 'Keka'], ['terminal', t('Terminal')]] as const).map(([v, l]) => h('option', { value: v, selected: v === S.theme }, l))); }
themeSel.onchange = () => { S.theme = themeSel.value as Settings['theme']; saveSettings(); applyTheme(); };
$<HTMLSelectElement>('#langSel').value = S.lang;
$('#langSel').addEventListener('change', e => { S.lang = (e.target as HTMLSelectElement).value as Settings['lang']; saveSettings(); setLang(S.lang); applyI18n(); fillTheme(); show(state.view); });

async function launchFiles() {
  // opened from the OS (PWA file handler)
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue;
  lq?.setConsumer(async p => { if (p.files?.length) route(await Promise.all(p.files.map(async fh => { const f = await fh.getFile(); return { path: f.name, data: f as Blob }; }))); });
  // shared from another app (PWA share target): the service worker parked the files in a cache
  if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
    const c = await caches.open('web-pak-share'), keys = await c.keys(), files: InFile[] = [];
    for (const k of keys) { const r = await c.match(k); if (r) files.push({ path: decodeURIComponent(new URL(k.url).pathname.split('/').pop()!), data: await r.blob() }); await c.delete(k); }
    history.replaceState(null, '', './');
    route(files);
  }
}

function start() {
  setLang(S.lang); applyI18n(); applyTheme(); fillTheme(); loadOptions(S); renderPresets();
  $('#formatsLine').textContent = t('Opens 7z, zip, rar, tar, gz, bz2, xz, zst, br, lz4, age, iso, dmg, cab, msi, deb, rpm, apk, jar and 40 more.');
  $('#boot-msg').remove(); $('#app').hidden = false;
  show('home');
  launchFiles();
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator && !import.meta.env.DEV) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
start();

// read-only hook for the end-to-end test
(window as unknown as { __webpak: unknown }).__webpak = { state, settings: S, route, openArchive };
