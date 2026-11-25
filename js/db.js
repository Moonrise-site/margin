// Tiny IndexedDB wrapper. Two stores: "kv" (app state, vault) and "images" (blobs).
const NAME = 'margin';
let dbp;

function open() {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('images');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function run(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => res(Array.isArray(out) ? out.map(r => r.result) : out?.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  }));
}

export const kvGet = k => run('kv', 'readonly', s => s.get(k));
export const kvSet = (k, v) => run('kv', 'readwrite', s => s.put(v, k));
export const kvDel = k => run('kv', 'readwrite', s => s.delete(k));

export const imgGet = id => run('images', 'readonly', s => s.get(id));
export const imgPut = (id, blob) => run('images', 'readwrite', s => s.put(blob, id));
export const imgDel = id => run('images', 'readwrite', s => s.delete(id));
export const imgKeys = () => run('images', 'readonly', s => s.getAllKeys());
export const imgClear = () => run('images', 'readwrite', s => s.clear());
export const imgAll = () =>
  run('images', 'readonly', s => [s.getAllKeys(), s.getAll()]).then(([k, v]) => k.map((id, i) => [id, v[i]]));
