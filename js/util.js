export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => crypto.randomUUID();
export const pad = n => String(n).padStart(2, '0');

// ---- dates (stored as local "YYYY-MM-DD") ----
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

export function fmtDue(s) {
  if (!s) return '';
  const n = diffDays(s, today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return parse(s).toLocaleDateString(undefined, { weekday: 'short' });
  const opts = { month: 'short', day: 'numeric' };
  if (parse(s).getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return parse(s).toLocaleDateString(undefined, opts);
}
export const fmtLong = s => parse(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function monthCells(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const off = (first.getDay() + 6) % 7; // Monday first
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m - 1, 1 - off + i);
    cells.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === m - 1 });
  }
  if (!cells.slice(35).some(c => c.inMonth)) cells.length = 35;
  return cells;
}
export const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const monthName = (ym, short) =>
  parse(ym + '-01').toLocaleDateString(undefined, short ? { month: 'long' } : { month: 'long', year: 'numeric' });

// ---- binary helpers (for backups) ----
export const b64 = u8 => {
  const a = new Uint8Array(u8); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const blobToB64 = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b); });

export const stripTags = html => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

// ---- note HTML sanitizer (notes are rich text; keep a small safe subset) ----
const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'CODE', 'PRE', 'SPAN', 'HR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IMG', 'VIDEO', 'AUDIO']);
// Text colours and highlights are stored as names, so they adapt to light/dark theme.
export const TINTS = ['ink', 'muted', 'rose', 'peach', 'gold', 'sage', 'teal', 'blue', 'plum'];
function clean(node) {
  for (const c of [...node.childNodes]) {
    if (c.nodeType === 3) continue;
    if (c.nodeType !== 1 || DROP.has(c.tagName)) { c.remove(); continue; }
    clean(c);
    if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
    for (const a of [...c.attributes]) {
      if (c.tagName === 'A' && a.name === 'href' && /^https?:/i.test(a.value.trim())) continue;
      if (c.tagName === 'SPAN' && (a.name === 'data-tc' || a.name === 'data-hl') && TINTS.includes(a.value)) continue;
      c.removeAttribute(a.name);
    }
    if (c.tagName === 'A') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); }
  }
}
export function sanitize(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  clean(t.content);
  return t.innerHTML;
}
