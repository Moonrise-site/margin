import { imgGet, imgPut, imgDel } from './db.js';
import { uid, $$ } from './util.js';

const urls = new Map();

export function resetCache() {
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
}

export async function urlFor(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await imgGet(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}

/** Fill every [data-img] element under root with its image. */
export function hydrate(root) {
  $$('[data-img]', root).forEach(async el => {
    const u = await urlFor(el.dataset.img);
    if (!u) return;
    if (el.tagName === 'IMG') el.src = u;
    else el.style.backgroundImage = `url("${u}")`;
  });
}

export async function addImageFile(file) {
  const blob = await downscale(file);
  const id = uid();
  await imgPut(id, blob);
  return id;
}

export async function removeImage(id) {
  await imgDel(id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
}

// Keep storage reasonable: shrink very large photos to 2400px on the long side.
async function downscale(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const max = 2400;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (s === 1 && file.size < 2e6) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const keepPng = file.type === 'image/png' && file.size < 4e6;
  const out = await new Promise(r => c.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.88));
  return out || file;
}
