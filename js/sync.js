// End-to-end encrypted sync through the user's own Supabase project.
//
// Every record (project, task, note, event, image, settings, the already-encrypted vault) is
// encrypted on this device with AES-256-GCM before upload. The key is derived from a sync
// passphrase (PBKDF2-SHA256, 600k rounds) that never leaves the device; Supabase only stores
// ciphertext. Conflicts resolve per record: the most recently changed version wins.
//
// Talks to Supabase's REST endpoints directly (auth, PostgREST, storage), so there are no dependencies.
import { kvGet, kvSet, kvDel, imgGet, imgPut, imgDel, imgKeys, imgClear } from './db.js';
import * as St from './store.js';
import { b64, unb64 } from './util.js';

const ITER = 600_000;
const TABLE = 'margin_items';
const BUCKET = 'margin';
const COLLS = { project: 'projects', task: 'tasks', note: 'notes', event: 'events' };

let cfg = null;   // { url, anon, email, userId, access, refresh, expires, cursor }
let key = null;   // CryptoKey (non-extractable), stored in IndexedDB
let meta = {};    // id -> { k: kind, h: hash, s: last synced hash, u: changed-at ms, del?, need? }
let running = false, again = false, timer = null;
const status = { state: 'off', at: 0, error: '' };
const statusFns = new Set();
const remoteFns = new Set();
export const onStatus = fn => statusFns.add(fn);
export const onRemoteChange = fn => remoteFns.add(fn);
export const getStatus = () => status;
export const enabled = () => !!(cfg?.refresh && key);
export const account = () => cfg && { email: cfg.email, url: cfg.url };
const setStatus = s => { Object.assign(status, s); statusFns.forEach(f => f(status)); };

class AuthError extends Error {}

export async function init() {
  cfg = (await kvGet('sync')) || null;
  key = (await kvGet('syncKey')) || null;
  meta = (await kvGet('syncMeta')) || {};
  if (enabled()) setStatus({ state: 'idle' });
}

// ---------------- crypto ----------------
const te = new TextEncoder(), td = new TextDecoder();
async function derive(pass, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encBytes(k, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function decBytes(k, data) {
  const u = new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12)));
}
const encStr = async (k, s) => b64(await encBytes(k, te.encode(s)));
const decStr = async (k, s) => td.decode(await decBytes(k, unb64(s)));

function hash(str) { // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const recHash = (kind, rec) => hash(kind + JSON.stringify(rec));

// ---------------- HTTP ----------------
async function saveCfg() { await kvSet('sync', cfg); }
function takeTokens(j) {
  cfg.access = j.access_token;
  cfg.refresh = j.refresh_token;
  cfg.expires = Date.now() + (j.expires_in || 3600) * 1000;
  if (j.user?.id) cfg.userId = j.user.id;
}
async function ensureToken(force) {
  if (!force && cfg.access && Date.now() < cfg.expires - 60_000) return;
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: cfg.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: cfg.refresh }),
  });
  if (!r.ok) throw new AuthError('Your sync sign-in expired. Sign in again in Settings.');
  takeTokens(await r.json());
  await saveCfg();
}
async function api(path, { method = 'GET', json, body, headers = {} } = {}, retried) {
  await ensureToken();
  const r = await fetch(cfg.url + path, {
    method,
    headers: { apikey: cfg.anon, Authorization: `Bearer ${cfg.access}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });
  if (r.status === 401 && !retried) { await ensureToken(true); return api(path, { method, json, body, headers }, true); }
  if (!r.ok) throw new Error(`Sync server said ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r;
}
const upsert = rows => api(`/rest/v1/${TABLE}?on_conflict=user_id,id`, {
  method: 'POST', json: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
});

// ---------------- connect / disconnect ----------------
/** Step 1: sign in (or create an account) with the user's Supabase project. */
export async function signIn({ url, anon, email, password, create }) {
  url = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('The project URL should start with https://');
  let r;
  try {
    r = await fetch(url + (create ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password'), {
      method: 'POST', headers: { apikey: anon.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
  } catch { throw new Error('Couldn\'t reach that address. Check the project URL.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || `Sign-in failed (${r.status})`);
  if (!j.access_token) throw new Error('Account created. Check your email for the confirmation link, then come back and press Sign in.');
  cfg = { url, anon: anon.trim(), email, cursor: null };
  takeTokens(j);
  await saveCfg();
}

/** Step 2: unlock (or create) the encryption key. Returns true if this account already has synced data. */
export async function usePassphrase(pass) {
  const rows = await (await api(`/rest/v1/${TABLE}?select=data&id=eq.__keycheck`)).json();
  if (rows.length) {
    const { salt, check } = JSON.parse(rows[0].data);
    const k = await derive(pass, unb64(salt));
    try { if ((await decStr(k, check)) !== 'margin') throw 0; }
    catch { throw new Error('That passphrase doesn\'t match the one you set up on your other device.'); }
    key = k;
  } else {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pass, salt);
    await upsert([{ user_id: cfg.userId, id: '__keycheck', kind: 'meta', updated: Date.now(), deleted: false, data: JSON.stringify({ salt: b64(salt), check: await encStr(key, 'margin') }) }]);
  }
  await kvSet('syncKey', key);
  meta = {};
  cfg.cursor = null;
  await kvSet('syncMeta', meta);
  await saveCfg();
  return rows.length > 0;
}

/** Wipe this device's data so the first sync pulls a clean copy (used when joining from a new device). */
export async function clearLocal() {
  await St.replaceState(St.blankState());
  await imgClear();
  await kvDel('vault');
  // Count this device's default settings as "old" so the synced settings win on first pull.
  const h = recHash('settings', { theme: St.state.settings.theme });
  meta = { settings: { k: 'settings', h, s: h, u: 0 } };
  await kvSet('syncMeta', meta);
}

export async function disconnect() {
  cfg = null; key = null; meta = {};
  clearTimeout(timer);
  await kvDel('sync'); await kvDel('syncKey'); await kvDel('syncMeta');
  setStatus({ state: 'off', error: '', at: 0 });
}

// ---------------- the sync cycle ----------------
export function schedule(ms = 2500) {
  if (!enabled()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

async function gather() {
  const s = St.state;
  const out = new Map();
  for (const [kind, coll] of Object.entries(COLLS)) for (const rec of s[coll]) out.set(rec.id, { kind, rec });
  out.set('settings', { kind: 'settings', rec: { theme: s.settings.theme } });
  const v = await kvGet('vault');
  if (v) out.set('vault', { kind: 'vault', rec: { v: v.v, iter: v.iter, salt: b64(v.salt), iv: b64(v.iv), ct: b64(v.ct) } });
  for (const id of await imgKeys()) out.set(id, { kind: 'image', rec: { id } });
  return out;
}

/** Notice local changes since last time: stamp changed records, tombstone removed ones. */
function scan(recs) {
  const now = Date.now();
  for (const [id, { kind, rec }] of recs) {
    const h = recHash(kind, rec);
    const m = meta[id];
    if (!m) meta[id] = { k: kind, h, s: null, u: now };
    else if (m.h !== h || m.del) Object.assign(m, { k: kind, h, u: now, del: false });
  }
  for (const [id, m] of Object.entries(meta)) {
    if (!recs.has(id) && !m.del && !m.need) Object.assign(m, { del: true, h: 'del', u: now });
  }
}

async function pull() {
  const changed = new Set();
  const since = cfg.cursor ? new Date(Date.parse(cfg.cursor) - 30_000).toISOString() : null;
  let newest = cfg.cursor;
  for (let offset = 0; ; offset += 500) {
    const q = `select=id,kind,updated,deleted,data,server_ts&order=server_ts.asc,id.asc&limit=500&offset=${offset}` + (since ? `&server_ts=gte.${encodeURIComponent(since)}` : '');
    const rows = await (await api(`/rest/v1/${TABLE}?${q}`)).json();
    for (const r of rows) {
      if (!newest || r.server_ts > newest) newest = r.server_ts;
      if (r.id === '__keycheck') continue;
      const m = meta[r.id];
      if (m && m.u >= r.updated) continue;           // ours is as new or newer (or it's our own echo)
      if (await apply(r)) changed.add(r.kind);
    }
    if (rows.length < 500) break;
  }
  cfg.cursor = newest;
  return changed;
}

async function apply(r) {
  const coll = COLLS[r.kind];
  if (r.deleted) {
    if (coll) St.remove(coll, r.id);
    else if (r.kind === 'image') await imgDel(r.id);
    else if (r.kind === 'vault') await kvDel('vault');
    meta[r.id] = { k: r.kind, h: 'del', s: 'del', u: r.updated, del: true };
    return true;
  }
  const rec = JSON.parse(await decStr(key, r.data));
  if (coll) {
    const arr = St.state[coll];
    const i = arr.findIndex(x => x.id === r.id);
    if (i >= 0) arr[i] = rec; else arr.push(rec);
  } else if (r.kind === 'settings') {
    Object.assign(St.state.settings, rec);
  } else if (r.kind === 'vault') {
    await kvSet('vault', { v: rec.v, iter: rec.iter, salt: unb64(rec.salt), iv: unb64(rec.iv), ct: unb64(rec.ct) });
  } else if (r.kind === 'image') {
    const h = recHash('image', rec);
    meta[r.id] = { k: 'image', h, s: h, u: r.updated, need: true }; // downloaded after the pull
    return true;
  } else return false;
  const h = recHash(r.kind, rec);
  meta[r.id] = { k: r.kind, h, s: h, u: r.updated };
  return true;
}

async function fetchImages() {
  let got = false;
  for (const [id, m] of Object.entries(meta)) {
    if (!m.need) continue;
    try {
      const res = await api(`/storage/v1/object/authenticated/${BUCKET}/${cfg.userId}/${id}`);
      const bytes = await decBytes(key, await res.arrayBuffer());
      const sep = bytes.indexOf(0);
      const type = td.decode(bytes.slice(0, sep));
      await imgPut(id, new Blob([bytes.slice(sep + 1)], { type }));
      delete m.need;
      got = true;
    } catch (e) { console.warn('Image not downloaded yet', id, e); }
  }
  return got;
}

async function push(recs) {
  const dirty = Object.entries(meta).filter(([, m]) => m.h !== m.s && !m.need);
  if (!dirty.length) return;
  const rows = [];
  for (const [id, m] of dirty) {
    if (m.k === 'image') {
      if (m.del) {
        await api(`/storage/v1/object/${BUCKET}/${cfg.userId}/${id}`, { method: 'DELETE' }).catch(() => {});
      } else {
        const blob = await imgGet(id);
        if (!blob) continue;
        const head = te.encode((blob.type || 'image/jpeg') + '\0');
        const body = new Uint8Array(head.length + blob.size);
        body.set(head); body.set(new Uint8Array(await blob.arrayBuffer()), head.length);
        await api(`/storage/v1/object/${BUCKET}/${cfg.userId}/${id}`, {
          method: 'POST', body: await encBytes(key, body), headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        });
      }
    }
    rows.push({
      user_id: cfg.userId, id, kind: m.k, updated: m.u, deleted: !!m.del,
      data: m.del ? null : await encStr(key, JSON.stringify(recs.get(id).rec)),
    });
  }
  for (let i = 0; i < rows.length; i += 200) await upsert(rows.slice(i, i + 200));
  for (const [, m] of dirty) m.s = m.h;
}

export async function syncNow() {
  if (!enabled()) return;
  if (running) { again = true; return; }
  if (!navigator.onLine) return setStatus({ state: 'offline' });
  running = true;
  setStatus({ state: 'syncing' });
  try {
    await St.flush();
    scan(await gather());
    const kinds = await pull();
    if (await fetchImages()) kinds.add('image');
    const recs = await gather();
    scan(recs);
    await push(recs);
    await kvSet('syncMeta', meta);
    await saveCfg();
    if (kinds.size) await St.flush();
    setStatus({ state: 'idle', at: Date.now(), error: '' });
    if (kinds.size) remoteFns.forEach(f => f(kinds));
  } catch (e) {
    console.error(e);
    await kvSet('syncMeta', meta).catch(() => {});
    setStatus({ state: navigator.onLine ? 'error' : 'offline', error: e.message, auth: e instanceof AuthError });
  } finally {
    running = false;
    if (again) { again = false; schedule(500); }
  }
}
