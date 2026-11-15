// Previews of one file from an archive. Archive contents are never trusted: text is shown with
// textContent, HTML is shown as source, SVG only as an <img> (no scripts), PDFs in the browser's viewer.
const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i, VID = /\.(mp4|webm|mov|m4v|ogv)$/i, AUD = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i;
const TEXT = /\.(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|html?|xml|svg|csv|tsv|log|ini|cfg|conf|toml|ya?ml|py|rb|go|rs|c|h|cc|cpp|hpp|java|kt|swift|sh|bash|zsh|fish|ps1|bat|sql|php|lua|r|pl|tex|srt|vtt|gitignore|env\.example|license|readme|makefile|dockerfile|nfo|diz)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', pdf: 'application/pdf' };
const urls: string[] = [];
export const MAX_PREVIEW = 64 * 1024 * 1024;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e;
}

export function renderPreview(box: HTMLElement, name: string, data: Uint8Array) {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  box.replaceChildren();
  const ext = (/\.([^.]+)$/.exec(name)?.[1] || '').toLowerCase();
  const url = () => { const u = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] || 'application/octet-stream' })); urls.push(u); return u; };
  box.append(el('div', { className: 'muted small' }, `${name.split('/').pop()} · ${data.length.toLocaleString()} bytes`));
  if (IMG.test(name)) return box.append(el('img', { src: url(), alt: name }));
  if (VID.test(name)) return box.append(el('video', { src: url(), controls: true }));
  if (AUD.test(name)) return box.append(el('audio', { src: url(), controls: true }));
  if (ext === 'pdf') { const e = document.createElement('embed'); e.src = url(); e.type = 'application/pdf'; return box.append(e); }
  const text = looksText(name, data) ? new TextDecoder().decode(data.subarray(0, 2_000_000)) : null;
  if (text !== null) {
    if (/\.(md|markdown)$/i.test(name)) return box.append(markdown(text));
    return box.append(highlight(text, ext));
  }
  box.append(hexView(data.subarray(0, 4096)));
}

function looksText(name: string, d: Uint8Array) {
  if (TEXT.test(name) || /(^|\/)(readme|license|copying|changelog|makefile|dockerfile)$/i.test(name)) return true;
  const n = Math.min(d.length, 4096); let bad = 0;
  for (let i = 0; i < n; i++) { const b = d[i]; if (b === 0) return false; if (b < 9 || (b > 13 && b < 32)) bad++; }
  return n > 0 && bad / n < 0.02;
}

const KW = /\b(function|return|const|let|var|if|else|for|while|import|export|from|class|def|fn|func|package|pub|struct|impl|use|async|await|new|true|false|null|None|nil|self|this|try|catch|switch|case|break|continue|interface|type|enum)\b/g;
function highlight(text: string, ext: string): HTMLElement {
  const pre = el('pre');
  const code = /^(js|mjs|cjs|ts|tsx|jsx|py|go|rs|c|h|cc|cpp|hpp|java|kt|swift|sh|bash|php|lua|rb|css|scss|json|toml|ya?ml)$/.test(ext);
  if (!code || text.length > 300_000) { pre.textContent = text; return pre; }
  // tokenise into strings, comments, numbers, keywords; everything goes in as text nodes
  const re = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(\b\d+(?:\.\d+)?\b)/g;
  let last = 0, m: RegExpExecArray | null;
  const words = (s: string) => { let l = 0, k: RegExpExecArray | null; KW.lastIndex = 0; while ((k = KW.exec(s))) { pre.append(s.slice(l, k.index), el('span', { className: 'tok-k' }, k[0])); l = k.index + k[0].length; } pre.append(s.slice(l)); };
  while ((m = re.exec(text))) {
    words(text.slice(last, m.index));
    if (m[2] && m[2].startsWith('#') && !/^(py|sh|bash|rb|toml|ya?ml)$/.test(ext)) { words(m[0]); last = m.index + m[0].length; continue; }
    pre.append(el('span', { className: m[1] ? 'tok-s' : m[2] ? 'tok-c' : 'tok-n' }, m[0]));
    last = m.index + m[0].length;
  }
  words(text.slice(last));
  return pre;
}

// A small, safe markdown renderer: headings, lists, code blocks, quotes, bold, italics, inline code.
function markdown(src: string): HTMLElement {
  const box = el('div', { className: 'md' });
  const inline = (s: string, into: HTMLElement) => {
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)/g; let l = 0, m: RegExpExecArray | null;
    while ((m = re.exec(s))) { into.append(s.slice(l, m.index)); const t = m[0]; into.append(m[1] ? el('code', {}, t.slice(1, -1)) : m[2] ? el('strong', {}, t.slice(2, -2)) : el('em', {}, t.slice(1, -1))); l = m.index + t.length; }
    into.append(s.slice(l));
  };
  const lines = src.split(/\r?\n/); let i = 0, list: HTMLElement | null = null;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) { const buf: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; box.append(el('pre', {}, buf.join('\n'))); list = null; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) { const e = el(`h${Math.min(3, h[1].length)}` as 'h1'); inline(h[2], e); box.append(e); list = null; i++; continue; }
    const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(ln);
    if (li) { list ??= box.appendChild(el(/\d/.test(li[1]) ? 'ol' : 'ul')); const e = el('li'); inline(li[2], e); list.append(e); i++; continue; }
    list = null;
    if (/^>\s?/.test(ln)) { const e = el('blockquote'); inline(ln.replace(/^>\s?/, ''), e); box.append(e); i++; continue; }
    if (ln.trim()) { const e = el('p'); inline(ln, e); box.append(e); }
    i++;
  }
  return box;
}

function hexView(d: Uint8Array): HTMLElement {
  const rows: string[] = [];
  for (let o = 0; o < d.length; o += 16) {
    const s = d.subarray(o, o + 16);
    rows.push(`${o.toString(16).padStart(8, '0')}  ${Array.from(s, b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${Array.from(s, b => (b > 31 && b < 127 ? String.fromCharCode(b) : '.')).join('')}`);
  }
  return el('pre', { className: 'hex' }, rows.join('\n'));
}
