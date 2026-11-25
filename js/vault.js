// The Vault: items are encrypted with AES-256-GCM using a key derived from the master
// password (PBKDF2-SHA256, 600k iterations). Only ciphertext is ever written to disk.
// The key lives in memory only while unlocked. There is no recovery without the password.
import { kvGet, kvSet } from './db.js';
import { uid } from './util.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 600_000;
const IDLE_MS = 5 * 60 * 1000;

let key = null;
let data = null;
let last = 0;

export const exists = async () => !!(await kvGet('vault'));
export const unlocked = () => !!key;
export const items = () => data?.items || [];
export const touch = () => { last = Date.now(); };
export const idleLeft = () => Math.max(0, IDLE_MS - (Date.now() - last));

async function derive(pass, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function decryptWith(pass) {
  const rec = await kvGet('vault');
  if (!rec) throw new Error('No vault');
  const k = await derive(pass, rec.salt, rec.iter || ITER);
  let pt;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, k, rec.ct); }
  catch { throw new Error('Wrong password'); }
  return { k, data: JSON.parse(dec.decode(pt)) };
}

async function persist() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
  await kvSet('vault', { v: 1, iter: ITER, salt: currentSalt, iv, ct });
}
let currentSalt = null;

export async function setup(pass) {
  currentSalt = crypto.getRandomValues(new Uint8Array(16));
  key = await derive(pass, currentSalt);
  data = { items: [] };
  touch();
  await persist();
}

export async function unlock(pass) {
  const rec = await kvGet('vault');
  const r = await decryptWith(pass);
  key = r.k;
  data = r.data;
  if (!Array.isArray(data.items)) data.items = [];
  currentSalt = rec.salt;
  touch();
}

export async function changePassword(oldPass, newPass) {
  const r = await decryptWith(oldPass);
  data = r.data;
  currentSalt = crypto.getRandomValues(new Uint8Array(16));
  key = await derive(newPass, currentSalt);
  touch();
  await persist();
}

export function lock() { key = null; data = null; currentSalt = null; }

export async function upsert(item) {
  const i = data.items.findIndex(x => x.id === item.id);
  if (i >= 0) data.items[i] = { ...data.items[i], ...item, updated: Date.now() };
  else data.items.unshift({ id: uid(), created: Date.now(), updated: Date.now(), ...item });
  touch();
  await persist();
}

export async function remove(id) {
  data.items = data.items.filter(x => x.id !== id);
  touch();
  await persist();
}
