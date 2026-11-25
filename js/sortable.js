// Pointer-based drag-to-reorder. Works with mouse/trackpad (drag after 5px) and touch (long-press).
// Markup: a container with data-sortable="<kind>" (and optional data-axis="y|x|grid") whose
// direct children carry data-sort-id. Register a handler with onSort(kind, (ids, container) => …).
const handlers = {};
export const onSort = (kind, fn) => { handlers[kind] = fn; };

const IGNORE = 'input, textarea, select, button.chk, .x, .datepick, [contenteditable], [data-cmd], [data-nosort], .toolbar';
const LONG_PRESS = 350;
let st = null;

const idsOf = box => [...box.children].filter(c => c.dataset.sortId).map(c => c.dataset.sortId);

document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || st) return;
  const it = e.target.closest('[data-sort-id]');
  const box = it?.parentElement;
  if (!it || !box?.matches('[data-sortable]') || e.target.closest(IGNORE)) return;
  st = { it, box, x: e.clientX, y: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', active: false };
  if (st.touch) st.timer = setTimeout(start, LONG_PRESS);
});

document.addEventListener('pointermove', e => {
  if (!st || e.pointerId !== st.pid) return;
  const dist = Math.hypot(e.clientX - st.x, e.clientY - st.y);
  if (!st.active) {
    if (st.touch) { if (dist > 8) cancel(); return; } // moved before long-press: it's a scroll
    if (dist < 5) return;
    start();
  }
  e.preventDefault();
  move(e.clientX, e.clientY);
}, { passive: false });

// While dragging on touch, stop the page from scrolling.
document.addEventListener('touchmove', e => { if (st?.active) e.preventDefault(); }, { passive: false });
document.addEventListener('pointerup', e => { if (st && e.pointerId === st.pid) end(); });
document.addEventListener('pointercancel', e => { if (st && e.pointerId === st.pid) (st.active ? end() : cancel()); });
document.addEventListener('contextmenu', e => { if (st?.active) e.preventDefault(); });

function start() {
  if (!st || st.active) return;
  st.active = true;
  st.before = idsOf(st.box).join();
  st.it.classList.add('sorting');
  document.body.classList.add('is-sorting');
  getSelection()?.removeAllRanges();
  navigator.vibrate?.(10);
}

function move(x, y) {
  const { it, box } = st;
  // Auto-scroll the nearest scrolling area when close to its edge.
  const sc = box.closest('#main, #side, .modal');
  if (sc) {
    const r = sc.getBoundingClientRect();
    if (y < r.top + 48) sc.scrollTop -= 14;
    else if (y > r.bottom - 48) sc.scrollTop += 14;
  }
  const el = document.elementFromPoint(x, y)?.closest('[data-sort-id]');
  if (!el || el === it || el.parentElement !== box) return;
  const r = el.getBoundingClientRect();
  const axis = box.dataset.axis || 'y';
  let before;
  if (axis === 'y') before = y < r.top + r.height / 2;
  else if (axis === 'x') before = x < r.left + r.width / 2;
  else before = y < r.top + r.height * 0.25 || (y <= r.bottom - r.height * 0.25 && x < r.left + r.width / 2);
  box.insertBefore(it, before ? el : el.nextSibling);
}

function end() {
  clearTimeout(st.timer);
  const s = st;
  st = null;
  if (!s.active) return;
  s.it.classList.remove('sorting');
  document.body.classList.remove('is-sorting');
  // Swallow the click that follows a drag so links/tabs don't open.
  const swallow = ev => { ev.preventDefault(); ev.stopPropagation(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
  const ids = idsOf(s.box);
  if (ids.join() !== s.before) handlers[s.box.dataset.sortable]?.(ids, s.box);
}

function cancel() {
  clearTimeout(st?.timer);
  st = null;
}
