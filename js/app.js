import { $, $$, esc, today, ymd, sanitize, stripTags, shiftMonth, b64, unb64, blobToB64, TINTS } from './util.js';
import { charPicker, colorPicker, closePicker, pickerOpenFor } from './picker.js';
import * as St from './store.js';
import * as V from './vault.js';
import { kvGet, kvSet, kvDel, imgAll, imgPut, imgClear } from './db.js';
import { addImageFile, hydrate, urlFor, removeImage, resetCache } from './images.js';
import { onSort } from './sortable.js';
import * as Sync from './sync.js';
import { ui, sidebar, syncLine, vToday, vGeneral, vProject, vCalendar, vVault, vaultList, rightCol, projectOptions } from './views.js';

const S = () => St.state;
const FOCUS = new Set(['p', 'todo', 'vault']); // routes without the right column
let refocus = null;

// ================= render =================
function parseRoute() {
  const [r, p] = (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  ui.route = ['today', 'todo', 'calendar', 'vault', 'p'].includes(r) ? r : 'today';
  ui.param = p || null;
}

function view() {
  switch (ui.route) {
    case 'todo': return vGeneral();
    case 'calendar': return vCalendar();
    case 'vault': return vVault();
    case 'p': return vProject();
    default: return vToday();
  }
}

function render() {
  closePicker();
  const theme = S().settings.theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('margin-theme', theme);
  document.body.classList.toggle('focus', FOCUS.has(ui.route));
  $('meta[name=theme-color]').content = theme === 'dark' ? '#121317' : '#f7f4ee';
  const p = St.proj(ui.param);
  document.title = ui.route === 'p' && p ? `${p.name} · Margin` : 'Margin';
  $('#tbTitle').textContent = ui.route === 'p' && p ? `${p.emoji ? p.emoji + ' ' : ''}${p.name}`
    : { today: 'Today', todo: 'General', calendar: 'Calendar', vault: 'Vault' }[ui.route] || 'Margin';

  $('#side').innerHTML = sidebar();
  const main = $('#main');
  const keepScroll = main.dataset.r === location.hash;
  const top = main.scrollTop;
  const extra = FOCUS.has(ui.route) ? '' : `<div class="inline-right">${rightCol()}</div>`;
  main.innerHTML = `<div class="cmd" data-act="palette">⌕ Jump to a project, add a task, search notes… <kbd>⌘K</kbd></div>${view()}${extra}`;
  main.dataset.r = location.hash;
  main.scrollTop = keepScroll ? top : 0;
  $('#right').innerHTML = FOCUS.has(ui.route) ? '' : rightCol();
  hydrate(document);
  if (refocus) { $(refocus)?.focus(); refocus = null; }
  else if (ui.route === 'vault' && !V.unlocked()) $('#main input[type=password]')?.focus();
}

// Re-render after a remote change, but never while you're typing.
let renderPending = false;
function renderSoon() {
  const a = document.activeElement;
  if (a && a !== document.body && a.closest('.editor, input, textarea, [contenteditable]')) {
    if (!renderPending) {
      renderPending = true;
      a.addEventListener('focusout', () => setTimeout(() => { renderPending = false; renderSoon(); }, 50), { once: true });
    }
    return;
  }
  render();
}

// ================= small UI helpers =================
function toast(msg, action) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  $('#toasts').append(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  if (action) t.querySelector('button').onclick = () => { action.fn(); kill(); };
  setTimeout(kill, action ? 6000 : 2600);
}

function modal(html, { onSubmit, onMount, cls = '' } = {}) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  document.body.append(o);
  const close = () => { closePicker(); o.remove(); };
  o._close = close;
  o.addEventListener('mousedown', e => { if (e.target === o) o._close(); });
  $$('[data-close]', o).forEach(b => b.addEventListener('click', () => o._close()));
  const f = $('form', o);
  if (f && onSubmit) f.addEventListener('submit', e => {
    e.preventDefault(); e.stopPropagation();
    onSubmit(Object.fromEntries(new FormData(f)), close, f);
  });
  onMount?.(o, close);
  setTimeout(() => $('input:not([type=hidden]):not([type=radio]), textarea', o)?.focus());
  return close;
}

function confirmBox(message, ok = 'Delete') {
  return new Promise(res => {
    modal(`<h2 class="serif">Are you sure?</h2><p class="body">${esc(message)}</p>
      <div class="mfoot"><span class="sp"></span><button class="btn" data-no>Cancel</button><button class="btn p" data-yes>${esc(ok)}</button></div>`, {
      onMount: (o, close) => {
        o._close = () => { close(); res(false); };
        $('[data-no]', o).onclick = () => { close(); res(false); };
        $('[data-yes]', o).onclick = () => { close(); res(true); };
        setTimeout(() => $('[data-yes]', o).focus());
      },
    });
  });
}

function choiceBox(title, message, choices) {
  return new Promise(res => {
    modal(`<h2 class="serif">${esc(title)}</h2><p class="body">${message}</p>
      <div class="mfoot" style="flex-wrap:wrap"><span class="sp"></span>${choices.map((c, i) => `<button class="btn ${c.primary ? 'p' : ''}" data-i="${i}">${esc(c.label)}</button>`).join('')}</div>`, {
      onMount: (o, close) => {
        o._close = () => { close(); res(null); };
        $$('[data-i]', o).forEach(b => b.onclick = () => { close(); res(choices[+b.dataset.i].value); });
      },
    });
  });
}

function formErr(f, msg) { const e = $('.err', f); if (e) e.textContent = msg; }

function pickFiles(cb) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = 'image/*'; i.multiple = true;
  i.onchange = () => cb(i.files);
  i.click();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ================= images =================
async function addImagesToNote(noteId, files) {
  const n = St.byId('notes', noteId);
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!n || !imgs.length) return;
  if (imgs.length > 1) toast(`Adding ${imgs.length} images…`);
  for (const f of imgs) n.imageIds.push(await addImageFile(f));
  n.updated = Date.now();
  St.commit();
}

function lightbox(noteId, start) {
  const n = St.byId('notes', noteId);
  let idx = start;
  const o = document.createElement('div');
  o.className = 'overlay lightbox';
  document.body.append(o);
  const onKey = e => {
    if (document.querySelectorAll('.overlay').length > 1) return;
    if (e.key === 'ArrowLeft') { idx--; draw(); }
    if (e.key === 'ArrowRight') { idx++; draw(); }
  };
  const close = () => { o.remove(); document.removeEventListener('keydown', onKey); };
  o._close = close;
  document.addEventListener('keydown', onKey);

  async function draw() {
    const ids = n.imageIds;
    if (!ids.length) return close();
    idx = (idx + ids.length) % ids.length;
    const id = ids[idx];
    const p = St.proj(n.projectId);
    o.innerHTML = `
      <div class="lb-top"><span>${idx + 1} / ${ids.length} · ${esc(n.title || 'Untitled')}</span><span class="sp"></span>
        ${p ? `<button class="btn ghost" data-lb="cover">${p.coverId === id ? '★ Project cover' : '☆ Use as project cover'}</button>` : ''}
        <button class="btn ghost" data-lb="del">Delete</button>
        <button class="btn ghost" data-lb="close">✕</button></div>
      ${ids.length > 1 ? '<button class="lb-nav l" data-lb="prev">‹</button><button class="lb-nav r" data-lb="next">›</button>' : ''}
      <img alt="">`;
    $('img', o).src = (await urlFor(id)) || '';
  }

  o.addEventListener('click', async e => {
    const b = e.target.closest('[data-lb]');
    if (!b) { if (e.target === o) close(); return; }
    const a = b.dataset.lb;
    if (a === 'close') return close();
    if (a === 'prev') idx--;
    if (a === 'next') idx++;
    if (a === 'cover') {
      const p = St.proj(n.projectId), id = n.imageIds[idx];
      p.coverId = p.coverId === id ? null : id;
      St.commit();
    }
    if (a === 'del') {
      if (!(await confirmBox('Delete this image? This can\'t be undone.'))) return;
      const [id] = n.imageIds.splice(idx, 1);
      const p = St.proj(n.projectId);
      if (p?.coverId === id) p.coverId = null;
      await removeImage(id);
      St.commit();
    }
    draw();
  });
  draw();
}

function galleryModal(noteId) {
  const n = St.byId('notes', noteId);
  modal(`<div style="display:flex;align-items:center;margin-bottom:14px"><h2 class="serif" style="margin:0">${esc(n.title || 'Untitled')} · ${n.imageIds.length} images</h2><span class="sp"></span>
      <button class="btn" data-add>+ Add</button>&nbsp;<button class="btn" data-close>Done</button></div>
    <p class="muted" style="font-size:12px;margin:-6px 0 12px">Drag to reorder — the first three show in the note's gallery strip.</p>
    <div class="ggrid" data-sortable="images" data-axis="grid" data-note="${n.id}">${n.imageIds.map(id => `<button data-img="${id}" data-sort-id="${id}" aria-label="Open image"></button>`).join('')}</div>`, {
    cls: 'wide',
    onMount: (o, close) => {
      hydrate(o);
      $('[data-add]', o).onclick = () => { close(); pickFiles(f => addImagesToNote(noteId, f)); };
      $('.ggrid', o).addEventListener('click', e => {
        const b = e.target.closest('[data-sort-id]');
        if (b) { close(); lightbox(noteId, n.imageIds.indexOf(b.dataset.sortId)); }
      });
    },
  });
}

// ================= editor =================
function editorOf(btn) { return btn.closest('.notes')?.querySelector('.editor'); }
function ensureFocus(ed) {
  if (ed.contains(getSelection().anchorNode)) { if (document.activeElement !== ed) ed.focus(); return; }
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  getSelection().removeAllRanges(); getSelection().addRange(r);
}
const changed = ed => ed.dispatchEvent(new Event('input', { bubbles: true }));
const BLOCKS = ['h2', 'h3', 'h4', 'blockquote'];
const LISTS = ['insertUnorderedList', 'insertOrderedList', 'indent', 'outdent'];
// Chrome sometimes puts a new list inside a <p>; lift it out (keeping the cursor where it is).
function tidyLists(ed) {
  const bad = [...ed.querySelectorAll('p, div')].filter(p => p.querySelector(':scope > ul, :scope > ol'));
  if (!bad.length) return;
  const sel = getSelection(), n = sel.anchorNode, o = sel.anchorOffset;
  bad.forEach(p => p.replaceWith(...p.childNodes));
  if (n && ed.contains(n)) sel.collapse(n, o);
}
function listCmd(ed, cmd) { document.execCommand(cmd); tidyLists(ed); }
const elOf = n => (n?.nodeType === 3 ? n.parentElement : n);
function setBlock(tag) {
  const cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
  document.execCommand('formatBlock', false, cur === tag ? 'p' : tag);
}

function fmt(cmd, btn) {
  const ed = editorOf(btn);
  if (!ed) return;
  if (cmd === 'insert' || cmd === 'color') {
    if (pickerOpenFor(btn)) return closePicker();
    ensureFocus(ed);
    const saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    const restore = () => { ed.focus(); if (saved) { getSelection().removeAllRanges(); getSelection().addRange(saved); } };
    if (cmd === 'insert') charPicker(btn, { onPick: ch => { restore(); document.execCommand('insertText', false, ch); saved?.setStart(getSelection().anchorNode, getSelection().anchorOffset); saved?.collapse(true); changed(ed); } });
    else colorPicker(btn, (kind, name) => { restore(); applyTint(ed, kind, name); });
    return;
  }
  ensureFocus(ed);
  if (BLOCKS.includes(cmd)) setBlock(cmd);
  else if (cmd === 'link') {
    const url = prompt('Link address (https://…)');
    if (!url) return;
    const u = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    if (getSelection().isCollapsed) document.execCommand('insertText', false, u);
    document.execCommand('createLink', false, u);
  } else if (LISTS.includes(cmd)) {
    listCmd(ed, cmd);
  } else {
    document.execCommand(cmd);
  }
  changed(ed);
}

// Colours: let the browser wrap the selection using a marker colour, then turn those
// wrappers into <span data-tc|data-hl="name"> so colours follow the light/dark theme.
function applyTint(ed, kind, name) {
  if (getSelection().isCollapsed) { toast('Select some text first'); return; }
  const n = (kind === 'tc' ? 0x0a0b00 : 0x0a0c00) + (name ? TINTS.indexOf(name) + 1 : 0x20);
  const hex = '#' + n.toString(16).padStart(6, '0');
  const rgb = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  const attr = kind === 'tc' ? 'data-tc' : 'data-hl';
  document.execCommand('styleWithCSS', false, kind === 'hl');
  document.execCommand(kind === 'tc' ? 'foreColor' : 'hiliteColor', false, hex);
  document.execCommand('styleWithCSS', false, false);
  for (const el of [...ed.querySelectorAll('font, [style]')]) {
    const hit = kind === 'tc'
      ? (el.getAttribute('color') || '').toLowerCase() === hex || el.style.color === rgb
      : el.style.backgroundColor === rgb;
    if (!hit) continue;
    const span = document.createElement('span');
    if (el.tagName === 'FONT' || el.tagName === 'SPAN') { span.append(...el.childNodes); el.replaceWith(span); }
    else { el.style.removeProperty(kind === 'tc' ? 'color' : 'background-color'); if (!el.getAttribute('style')) el.removeAttribute('style'); span.append(...el.childNodes); el.append(span); }
    span.querySelectorAll(`[${attr}]`).forEach(x => x.replaceWith(...x.childNodes));
    const outer = span.parentElement?.closest(`[${attr}]`);
    if (name) span.setAttribute(attr, name);
    else if (outer && outer === span.parentElement && outer.childNodes.length === 1) { outer.replaceWith(span); span.replaceWith(...span.childNodes); } // whole coloured bit cleared
    else if (outer) span.setAttribute(attr, 'ink'); // cancel an outer colour for part of it
    else span.replaceWith(...span.childNodes);
  }
  ed.normalize();
  changed(ed);
}

// Typing shortcuts at the start of a line: "# " "## " "### " headers, "- " "* " bullets, "1. " numbers, "> " callout.
const MD = { '#': 'h2', '##': 'h3', '###': 'h4', '>': 'blockquote', '-': 'ul', '*': 'ul', '1.': 'ol' };
function markdownShortcut(ed) {
  const sel = getSelection();
  if (!sel.isCollapsed || sel.anchorNode?.nodeType !== 3) return false;
  let block = sel.anchorNode.parentElement;
  while (block !== ed && !/^(P|DIV|H2|H3|H4|LI|BLOCKQUOTE)$/.test(block.tagName)) block = block.parentElement;
  if (block.tagName === 'LI') return false;
  const r = document.createRange(); r.setStart(block, 0); r.setEnd(sel.anchorNode, sel.anchorOffset);
  const tag = MD[r.toString()];
  if (!tag) return false;
  sel.removeAllRanges(); sel.addRange(r);
  document.execCommand('delete');
  if (tag === 'ul') listCmd(ed, 'insertUnorderedList');
  else if (tag === 'ol') listCmd(ed, 'insertOrderedList');
  else document.execCommand('formatBlock', false, tag);
  return true;
}
// Arrows as you type: -> → , <- ← , => ⇒ (⌘Z undoes it).
const ARROWS = { '->': '→', '<-': '←', '=>': '⇒' };
function arrowShortcut(key) {
  const sel = getSelection(), node = sel.anchorNode, off = sel.anchorOffset;
  if (!sel.isCollapsed || node?.nodeType !== 3 || off < 1) return false;
  const out = ARROWS[node.data[off - 1] + key];
  if (!out) return false;
  const r = document.createRange(); r.setStart(node, off - 1); r.setEnd(node, off);
  sel.removeAllRanges(); sel.addRange(r);
  document.execCommand('insertText', false, out);
  return true;
}

// ================= modals: project / event / vault item / settings =================
function projectModal(p) {
  const isNew = !p;
  const v = p || { name: '', emoji: '', color: St.COLORS[S().projects.length % St.COLORS.length], due: '' };
  modal(`<form>
    <h2 class="serif">${isNew ? 'New project' : 'Customize project'}</h2>
    <label class="fld"><span>Name</span><input name="name" value="${esc(v.name)}" required placeholder="e.g. Apartment move" autocomplete="off"></label>
    <div class="fld-row">
      <div class="fld" style="flex:0 0 auto"><span>Icon</span><div class="emoji-field">
        <button type="button" class="emoji-btn" data-emoji title="Choose an emoji">${esc(v.emoji) || '<em>＋</em>'}</button>
        <input type="hidden" name="emoji" value="${esc(v.emoji)}"></div></div>
      <label class="fld"><span>Due date (optional)</span><input type="date" name="due" value="${v.due || ''}"></label>
    </div>
    <div class="fld"><span>Colour</span><div class="swatches">
      ${St.COLORS.map(c => `<label title="${c}"><input type="radio" name="color" value="${c}" ${c === v.color ? 'checked' : ''}><i style="background:var(--c-${c})"></i></label>`).join('')}
      <span class="sw-sep"></span>
      <span class="sw-custom" title="Pick any colour"><input type="radio" name="color" value="${St.isHex(v.color) ? v.color : ''}" ${St.isHex(v.color) ? 'checked' : ''}><i style="${St.isHex(v.color) ? `background:${v.color}` : ''}"></i><input type="color" value="${St.isHex(v.color) ? v.color : '#3a7bd5'}"></span>
    </div></div>
    <div class="mfoot">${isNew ? '' : '<button type="button" class="btn danger" data-del>Delete project</button>'}<span class="sp"></span>
      <button type="button" class="btn" data-close>Cancel</button><button class="btn p">${isNew ? 'Create project' : 'Save'}</button></div>
  </form>`, {
    onSubmit: (d, close) => {
      const color = St.COLORS.includes(d.color) || St.isHex(d.color) ? d.color : (p?.color || 'peach');
      const fields = { name: d.name.trim() || 'Untitled', emoji: d.emoji.trim(), color, due: d.due || null };
      close();
      if (isNew) { const np = St.addProject(fields); St.save(); location.hash = '#/p/' + np.id; }
      else { Object.assign(p, fields); St.commit(); }
    },
    onMount: (o, close) => {
      const eb = $('[data-emoji]', o), ei = $('input[name=emoji]', o);
      const setEmoji = ch => { ei.value = ch; eb.innerHTML = ch ? esc(ch) : '<em>＋</em>'; };
      eb.addEventListener('click', () => pickerOpenFor(eb) ? closePicker()
        : charPicker(eb, { tabs: ['emoji', 'symbols'], onPick: setEmoji, onClear: () => setEmoji(''), clearLabel: 'No icon' }));
      const cc = $('.sw-custom input[type=color]', o), cr = $('.sw-custom input[type=radio]', o);
      const pickCustom = () => { cr.value = cc.value; cr.checked = true; cr.nextElementSibling.style.background = cc.value; };
      cc.addEventListener('input', pickCustom); cc.addEventListener('click', pickCustom);
      $('[data-del]', o)?.addEventListener('click', async () => {
        if (!(await confirmBox(`Delete “${p.name}” with all its notes, images, tasks and events? This can't be undone.`))) return;
        close();
        const imgs = St.deleteProject(p.id);
        imgs.forEach(removeImage);
        location.hash = '#/today';
        St.commit();
        toast('Project deleted');
      });
    },
  });
}

function eventModal(ev) {
  const isNew = !ev.id;
  modal(`<form>
    <h2 class="serif">${isNew ? 'New event' : 'Edit event'}</h2>
    <label class="fld"><span>What</span><input name="title" value="${esc(ev.title || '')}" required autocomplete="off" placeholder="e.g. Call with the landlord"></label>
    <div class="fld-row">
      <label class="fld"><span>Date</span><input type="date" name="date" value="${ev.date || today()}" required></label>
      <label class="fld"><span>Time (optional)</span><input type="time" name="time" value="${ev.time || ''}"></label>
    </div>
    <label class="fld"><span>Project</span><select name="projectId">${projectOptions(ev.projectId)}</select></label>
    <div class="mfoot">${isNew ? '' : '<button type="button" class="btn danger" data-del>Delete</button>'}<span class="sp"></span>
      <button type="button" class="btn" data-close>Cancel</button><button class="btn p">Save</button></div>
  </form>`, {
    onSubmit: (d, close) => {
      const fields = { title: d.title.trim(), date: d.date, time: d.time || '', projectId: d.projectId || null };
      if (isNew) St.addEvent(fields); else Object.assign(St.byId('events', ev.id), fields);
      close(); St.commit();
    },
    onMount: (o, close) => $('[data-del]', o)?.addEventListener('click', () => {
      const removed = St.remove('events', ev.id);
      close(); St.commit();
      toast('Event deleted', { label: 'Undo', fn: () => { S().events.push(removed); St.commit(); } });
    }),
  });
}

function vaultItemModal(it = {}) {
  const isNew = !it.id;
  modal(`<form autocomplete="off">
    <h2 class="serif">${isNew ? 'Add to Vault' : 'Edit item'}</h2>
    <label class="fld"><span>Label</span><input name="label" value="${esc(it.label || '')}" required placeholder="e.g. Home Wi‑Fi, Bank login, Passport"></label>
    <label class="fld"><span>Username / account (optional)</span><input name="username" value="${esc(it.username || '')}"></label>
    <label class="fld"><span>Password / secret (optional)</span><input name="secret" type="password" value="${esc(it.secret || '')}" autocomplete="new-password"></label>
    <label class="fld"><span>Notes (optional)</span><textarea name="note" rows="3">${esc(it.note || '')}</textarea></label>
    <div class="mfoot"><label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center"><input type="checkbox" data-show> Show secret</label><span class="sp"></span>
      <button type="button" class="btn" data-close>Cancel</button><button class="btn p">Save</button></div>
  </form>`, {
    onSubmit: async (d, close) => {
      await V.upsert({ ...(isNew ? {} : { id: it.id }), label: d.label.trim(), username: d.username.trim(), secret: d.secret, note: d.note.trim() });
      Sync.schedule();
      close(); render();
    },
    onMount: o => { $('[data-show]', o).onchange = e => { $('[name=secret]', o).type = e.target.checked ? 'text' : 'password'; }; },
  });
}

function changePwModal() {
  modal(`<form>
    <h2 class="serif">Change master password</h2>
    <label class="fld"><span>Current password</span><input type="password" name="old" required autocomplete="current-password"></label>
    <label class="fld"><span>New password (8+ characters)</span><input type="password" name="p1" required autocomplete="new-password"></label>
    <label class="fld"><span>New password again</span><input type="password" name="p2" required autocomplete="new-password"></label>
    <div class="err"></div>
    <div class="mfoot"><span class="sp"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn p">Change</button></div>
  </form>`, {
    onSubmit: async (d, close, f) => {
      if (d.p1.length < 8) return formErr(f, 'Use at least 8 characters.');
      if (d.p1 !== d.p2) return formErr(f, 'The new passwords don\'t match.');
      try { await V.changePassword(d.old, d.p1); Sync.schedule(); close(); toast('Master password changed'); }
      catch { formErr(f, 'Current password is wrong.'); }
    },
  });
}

async function settingsModal() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const mb = n => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB';
  modal(`
    <h2 class="serif">Settings</h2>
    <div class="fld"><span>Theme</span><div><div class="seg">
      <button data-t="light" class="${S().settings.theme === 'light' ? 'on' : ''}">☼ Light</button>
      <button data-t="dark" class="${S().settings.theme === 'dark' ? 'on' : ''}">☾ Dark</button></div></div></div>
    <div class="fld"><span>Your data</span>
      <p style="font-size:13px">Everything lives in this browser on this computer — nothing is uploaded anywhere.
      ${est ? `Currently using <b>${mb(est.usage || 0)}</b>.` : ''} ${persisted ? 'Storage is protected from automatic cleanup.' : ''}</p>
      <p style="font-size:13px;color:var(--muted);margin-top:6px">Export a backup now and then. It includes images, and the Vault stays encrypted inside it.</p>
      <div class="btnrow"><button class="btn" data-x="export">⇩ Export backup</button><button class="btn" data-x="import">⇧ Restore from backup…</button></div>
    </div>
    <div class="fld"><span>Sync between devices</span>${syncSettingsHtml()}</div>
    <div class="fld"><span>Install</span>${installHtml()}</div>
    <div class="mfoot"><span class="sp"></span><button class="btn p" data-close>Done</button></div>`, {
    onMount: (o, close) => {
      $('[data-x=syncSetup]', o)?.addEventListener('click', () => { close(); syncSetupModal(); });
      $('[data-x=syncNow]', o)?.addEventListener('click', async () => { await Sync.syncNow(); close(); settingsModal(); });
      $('[data-x=syncOff]', o)?.addEventListener('click', async () => {
        if (!(await confirmBox('Stop syncing on this device? Your data stays here and in your other devices; this device just stops exchanging changes.', 'Stop syncing'))) return;
        await Sync.disconnect(); close(); render(); toast('Sync turned off on this device');
      });
      $('[data-x=install]', o)?.addEventListener('click', async () => { close(); await installPrompt?.prompt(); installPrompt = null; });
      $$('[data-t]', o).forEach(b => b.onclick = () => {
        S().settings.theme = b.dataset.t; St.commit();
        $$('[data-t]', o).forEach(x => x.classList.toggle('on', x === b));
      });
      $('[data-x=export]', o).onclick = exportBackup;
      $('[data-x=import]', o).onclick = () => {
        const i = document.createElement('input');
        i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = () => i.files[0] && importBackup(i.files[0], close);
        i.click();
      };
    },
  });
}

function syncSettingsHtml() {
  if (!Sync.enabled()) return `<p style="font-size:13px">Off. Sync keeps your Macs and phone in step through your own free Supabase account.
      Everything is encrypted on the device first — Supabase only ever sees scrambled data.</p>
    <div class="btnrow"><button class="btn" data-x="syncSetup">Set up sync…</button></div>`;
  const st = Sync.getStatus(), acc = Sync.account();
  return `<p style="font-size:13px">On, as <b>${esc(acc.email)}</b>. ${st.at ? `Last synced ${new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
    ${st.error ? `<p class="err" style="margin-top:4px">${esc(st.error)}</p>` : ''}
    <div class="btnrow">${st.auth ? '<button class="btn p" data-x="syncSetup">Sign in again…</button>' : '<button class="btn" data-x="syncNow">Sync now</button>'}<button class="btn" data-x="syncOff">Stop syncing on this device</button></div>`;
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
function installHtml() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '<p style="font-size:13px">You\'re using the installed app. ✓</p>';
  if (installPrompt) return '<p style="font-size:13px">Add Margin to your Dock as its own app. It works offline.</p><div class="btnrow"><button class="btn" data-x="install">Install Margin</button></div>';
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  return `<p style="font-size:13px">${ios
    ? 'On iPhone/iPad: tap the Share button, then <b>Add to Home Screen</b>.'
    : 'In Safari: <b>File → Add to Dock</b>. In Chrome/Edge/Arc: the install icon at the right of the address bar.'} It then opens as its own app and works offline.</p>`;
}

function syncSetupModal() {
  modal(`<form autocomplete="on">
    <h2 class="serif">Set up sync — 1 of 2</h2>
    <div class="note-box">You need a free Supabase project (one-time, about 5 minutes). The steps are in <b>SYNC-SETUP.md</b> in the Margin folder.
      Already did it on another device? Use the same details here.</div>
    <label class="fld"><span>Project URL</span><input name="url" placeholder="https://abcdefgh.supabase.co" value="${esc(Sync.account()?.url || '')}" required autocomplete="off"></label>
    <label class="fld"><span>Publishable (anon) key</span><input name="anon" required autocomplete="off" spellcheck="false"></label>
    <label class="fld"><span>Your email</span><input name="email" type="email" value="${esc(Sync.account()?.email || '')}" required autocomplete="username"></label>
    <label class="fld"><span>Account password</span><input name="password" type="password" required autocomplete="current-password" minlength="6"></label>
    <div class="err"></div>
    <div class="mfoot"><button type="button" class="btn" data-create>Create account</button><span class="sp"></span>
      <button type="button" class="btn" data-close>Cancel</button><button class="btn p">Sign in</button></div>
  </form>`, {
    onSubmit: (d, close, f) => go(d, false, close, f),
    onMount: (o, close) => {
      const f = $('form', o);
      $('[data-create]', o).onclick = () => { if (f.reportValidity()) go(Object.fromEntries(new FormData(f)), true, close, f); };
    },
  });
  async function go(d, create, close, f) {
    $$('button', f).forEach(b => b.disabled = true);
    formErr(f, create ? 'Creating account…' : 'Signing in…');
    try {
      await Sync.signIn({ ...d, create });
      close();
      passphraseModal();
    } catch (e) { formErr(f, e.message); $$('button', f).forEach(b => b.disabled = false); }
  }
}

function passphraseModal() {
  modal(`<form autocomplete="off">
    <h2 class="serif">Set up sync — 2 of 2</h2>
    <p class="body" style="font-size:13px">Your <b>sync passphrase</b> encrypts everything before it leaves this device. Use the <b>same one on every device</b>.
      Supabase never sees it. If you lose it, synced copies can't be decrypted, though each device keeps its own data.</p>
    <label class="fld"><span>Sync passphrase (10+ characters)</span><input name="p1" type="password" required minlength="10" autocomplete="new-password"></label>
    <label class="fld"><span>Type it again</span><input name="p2" type="password" required autocomplete="new-password"></label>
    <div class="err"></div>
    <div class="mfoot"><span class="sp"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn p">Turn on sync</button></div>
  </form>`, {
    onSubmit: async (d, close, f) => {
      if (d.p1 !== d.p2) return formErr(f, 'The passphrases don\'t match.');
      $$('button', f).forEach(b => b.disabled = true);
      formErr(f, 'Preparing encryption…');
      try {
        const existing = await Sync.usePassphrase(d.p1);
        close();
        if (existing) {
          const choice = await choiceBox('This account already has data',
            'You\'ve synced from another device before. For a new device, <b>replace</b> what\'s here with your synced data. <b>Merge</b> keeps both, which can create duplicates (for example two “Getting started” projects).',
            [{ label: 'Merge both', value: 'merge' }, { label: 'Use synced data', value: 'replace', primary: true }]);
          if (!choice) { await Sync.disconnect(); return toast('Sync not turned on'); }
          if (choice === 'replace') { V.lock(); await Sync.clearLocal(); }
        }
        toast('Syncing…');
        await Sync.syncNow();
        ui.vaultExists = await V.exists();
        render();
        const st = Sync.getStatus();
        toast(st.state === 'idle' ? 'Sync is on ✓' : 'Sync is on, but: ' + st.error);
      } catch (e) {
        formErr(f, e.message);
        $$('button', f).forEach(b => b.disabled = false);
      }
    },
  });
}

// ================= backup =================
async function exportBackup() {
  await St.flush();
  toast('Preparing backup…');
  const images = {};
  for (const [id, blob] of await imgAll()) images[id] = { type: blob.type, data: await blobToB64(blob) };
  const v = await kvGet('vault');
  const out = {
    app: 'margin', version: 1, exported: new Date().toISOString(),
    state: S(), images,
    vault: v ? { ...v, salt: b64(v.salt), iv: b64(v.iv), ct: b64(v.ct) } : null,
  };
  download(`margin-backup-${today()}.json`, JSON.stringify(out));
}

async function importBackup(file, closeSettings) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file isn\'t a Margin backup.'); }
  if (data?.app !== 'margin' || !data.state || typeof data.state !== 'object') return toast('That file isn\'t a Margin backup.');
  if (!(await confirmBox('Replace everything in Margin with this backup? What\'s here now will be overwritten.', 'Replace'))) return;
  try {
    await imgClear();
    resetCache();
    for (const [id, img] of Object.entries(data.images || {})) {
      if (/^[\w-]{1,64}$/.test(id) && img?.data) await imgPut(id, new Blob([unb64(img.data)], { type: String(img.type || 'image/jpeg') }));
    }
    if (data.vault?.ct) await kvSet('vault', { ...data.vault, salt: unb64(data.vault.salt), iv: unb64(data.vault.iv), ct: unb64(data.vault.ct) });
    else await kvDel('vault');
    (data.state.notes || []).forEach(n => { if (n) n.html = sanitize(n.html); });
    V.lock();
    ui.vaultExists = !!data.vault?.ct;
    await St.replaceState(data.state);
    closeSettings?.();
    location.hash = '#/today';
    render();
    toast('Backup restored');
  } catch (e) {
    console.error(e);
    toast('Something went wrong restoring that backup.');
  }
}

// ================= command palette =================
function openPalette() {
  if ($('.palette')) return;
  const o = document.createElement('div');
  o.className = 'overlay palette-wrap';
  o.innerHTML = `<div class="palette"><input placeholder="Search projects, tasks, notes — or type a task to add it" aria-label="Search"><div class="results"></div><div class="pfoot">↑↓ move · ↵ open · esc close</div></div>`;
  document.body.append(o);
  const inp = $('input', o), res = $('.results', o);
  let items = [], sel = 0;
  const close = () => { closePicker(); o.remove(); };
  o._close = close;
  o.addEventListener('mousedown', e => { if (e.target === o) close(); });
  const go = h => { location.hash = h; };
  const pname = pid => St.proj(pid)?.name || 'General';

  function build() {
    const raw = inp.value.trim(), q = raw.toLowerCase();
    const m = s => (s || '').toLowerCase().includes(q);
    items = [];
    if (q) items.push({ icon: '＋', label: `Add task “${raw}”`, hint: 'to General', run: () => { St.addTask(raw); St.commit(); toast('Added to General'); } });
    [['☀︎', 'Today', '#/today'], ['✓', 'General', '#/todo'], ['▦', 'Calendar', '#/calendar'], ['🔒', 'Vault', '#/vault']]
      .filter(n => !q || m(n[1])).forEach(n => items.push({ icon: n[0], label: n[1], hint: 'Go to', run: () => go(n[2]) }));
    St.projects().filter(p => !q || m(p.name)).forEach(p => items.push({
      icon: `<i class="dot" style="background:${St.colorVar(p.color)}"></i>`, label: (p.emoji ? p.emoji + ' ' : '') + p.name, hint: 'Project', run: () => go('#/p/' + p.id),
    }));
    if (q) {
      S().tasks.filter(t => m(t.title)).slice(0, 8).forEach(t => items.push({
        icon: t.done ? '☑' : '☐', label: t.title, hint: pname(t.projectId), run: () => go(t.projectId ? '#/p/' + t.projectId : '#/todo'),
      }));
      S().notes.filter(n => m(n.title) || m(stripTags(n.html))).slice(0, 8).forEach(n => items.push({
        icon: '✎', label: n.title || 'Untitled', hint: 'Note · ' + pname(n.projectId),
        run: () => { ui.activeNote[n.projectId || 'general'] = n.id; const h = n.projectId ? '#/p/' + n.projectId : '#/todo'; if (location.hash === h) render(); else go(h); },
      }));
    }
    if (!q || m('new project')) items.push({ icon: '＋', label: 'New project', hint: '', run: () => projectModal() });
    if (!q || m('new event')) items.push({ icon: '▦', label: 'New event', hint: '', run: () => eventModal({}) });
    const dark = S().settings.theme === 'dark';
    if (!q || m('theme dark light')) items.push({ icon: '◐', label: `Switch to ${dark ? 'light' : 'dark'} theme`, hint: '', run: () => { S().settings.theme = dark ? 'light' : 'dark'; St.commit(); } });
    sel = Math.max(0, Math.min(sel, items.length - 1));
    res.innerHTML = items.map((it, i) => `<div class="pr ${i === sel ? 'on' : ''}" data-i="${i}"><span class="pi">${it.icon}</span><span class="pl">${esc(it.label)}</span><span class="ph">${esc(it.hint)}</span></div>`).join('');
    res.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  const run = i => { const it = items[i]; if (!it) return; close(); it.run(); };
  inp.addEventListener('input', () => { sel = 0; build(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); build(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); build(); e.preventDefault(); }
    if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  res.addEventListener('click', e => { const r = e.target.closest('.pr'); if (r) run(+r.dataset.i); });
  build();
  inp.focus();
}

// ================= actions =================
const A = {
  palette: () => { document.body.classList.remove('nav-open'); openPalette(); },
  toggleNav: () => document.body.classList.toggle('nav-open'),
  settings: () => settingsModal(),
  setTheme: el => { S().settings.theme = el.dataset.t; St.commit(); },

  newProject: () => projectModal(),
  editProject: el => projectModal(St.proj(el.dataset.id)),
  renameProject: el => {
    const p = St.proj(el.dataset.id);
    const v = el.textContent.trim();
    if (p && v && v !== p.name) { p.name = v; St.commit(); } else if (p) el.textContent = p.name;
  },
  projectDue: el => { St.proj(el.dataset.id).due = el.value || null; St.commit(); },

  // tasks
  addTask: (f, d) => {
    const title = (d.title || '').trim();
    if (!title) return;
    St.addTask(title, d.projectId || null, d.due || null);
    refocus = `[data-submit=addTask][data-key="${f.dataset.key}"] input[name=title]`;
    St.commit();
  },
  toggleTask: el => {
    const t = St.byId('tasks', el.dataset.id);
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    St.commit();
  },
  editTask: el => {
    const t = St.byId('tasks', el.dataset.id);
    const inp = document.createElement('input');
    inp.className = 't-edit'; inp.value = t.title;
    el.replaceWith(inp);
    inp.focus(); inp.select();
    let finished = false;
    const fin = keep => {
      if (finished) return; finished = true;
      if (keep && inp.value.trim()) t.title = inp.value.trim();
      St.commit();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') { e.stopPropagation(); fin(false); } };
    inp.onblur = () => fin(true);
  },
  deleteTask: el => {
    const i = S().tasks.findIndex(t => t.id === el.dataset.id);
    const [t] = S().tasks.splice(i, 1);
    St.commit();
    toast('Task deleted', { label: 'Undo', fn: () => { S().tasks.splice(i, 0, t); St.commit(); } });
  },
  taskDue: el => { St.byId('tasks', el.dataset.id).due = el.value || null; St.commit(); },
  pickDate: el => {
    const i = $('input[type=date]', el);
    try { i.showPicker(); } catch { i.style.pointerEvents = 'auto'; i.focus(); i.click(); }
  },
  toggleDone: el => { ui.showDone[el.dataset.key] = !ui.showDone[el.dataset.key]; render(); },

  // notes
  openNote: el => { ui.activeNote[el.dataset.pid || 'general'] = el.dataset.id; render(); },
  newNote: el => {
    const pid = el.dataset.pid || null;
    const n = St.addNote(pid, '');
    ui.activeNote[pid || 'general'] = n.id;
    refocus = `.note-title[data-id="${n.id}"]`;
    St.commit();
    $(refocus)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  notesView: el => {
    const pid = el.dataset.pid, v = el.dataset.v === 'cards' ? 'cards' : undefined;
    const owner = pid ? St.proj(pid) : S().settings;
    if (!owner) return;
    if (v) owner.notesView = v; else delete owner.notesView;
    St.commit();
  },
  deleteNote: async el => {
    const n = St.byId('notes', el.dataset.id);
    if (!(await confirmBox(`Delete “${n.title || 'Untitled'}”${n.imageIds.length ? ` and its ${n.imageIds.length} images` : ''}?`))) return;
    n.imageIds.forEach(removeImage);
    const p = St.proj(n.projectId);
    if (p && n.imageIds.includes(p.coverId)) p.coverId = null;
    St.remove('notes', n.id);
    St.commit();
  },
  noteTitle: el => {
    const n = St.byId('notes', el.dataset.id);
    n.title = el.value; n.updated = Date.now();
    const tab = $(`.doctabs [data-id="${n.id}"]`);
    if (tab) tab.textContent = el.value || 'Untitled';
    St.commit({ silent: true });
  },
  noteBody: el => {
    const n = St.byId('notes', el.dataset.id);
    n.html = el.innerHTML; n.updated = Date.now();
    St.commit({ silent: true });
  },
  addImages: el => pickFiles(files => addImagesToNote(el.dataset.id, files)),
  openImage: el => lightbox(el.dataset.note, +el.dataset.i),
  openGallery: el => galleryModal(el.dataset.note),

  // calendar
  calNav: el => {
    const k = el.dataset.key, d = +el.dataset.d;
    const base = (k === 'main' ? ui.cal : ui.projCal[k]) || today().slice(0, 7);
    const v = d === 0 ? today().slice(0, 7) : shiftMonth(base, d);
    if (k === 'main') ui.cal = v; else ui.projCal[k] = v;
    render();
  },
  newEvent: el => eventModal({ date: el.dataset.date || today(), projectId: el.dataset.pid || (ui.route === 'p' ? ui.param : null) }),
  editEvent: el => eventModal(St.byId('events', el.dataset.id)),

  // quick note
  quickDraft: el => { ui.quick = el.value; },
  quickPid: el => { ui.quickPid = el.value; },
  saveQuick: () => {
    const text = ui.quick.trim();
    if (!text) return;
    const lines = text.split('\n');
    const title = lines[0].slice(0, 60);
    const body = (lines[0].length > 60 ? lines : lines.slice(1)).filter(l => l.trim());
    const n = St.addNote(ui.quickPid || null, title, body.map(l => `<p>${esc(l)}</p>`).join(''));
    ui.activeNote[n.projectId || 'general'] = n.id;
    ui.quick = '';
    St.commit();
    toast(`Saved to ${St.proj(n.projectId)?.name || 'General'}`, { label: 'Open', fn: () => { location.hash = n.projectId ? '#/p/' + n.projectId : '#/todo'; } });
  },

  // vault
  vaultSetup: async (f, d) => {
    if (d.p1.length < 8) return formErr(f, 'Use at least 8 characters.');
    if (d.p1 !== d.p2) return formErr(f, 'The passwords don\'t match.');
    $('button', f).disabled = true;
    await V.setup(d.p1);
    Sync.schedule();
    ui.vaultExists = true;
    render();
    toast('Vault created');
  },
  vaultUnlock: async (f, d) => {
    const b = $('button', f);
    b.disabled = true; b.textContent = 'Unlocking…';
    try { await V.unlock(d.p); render(); }
    catch { b.disabled = false; b.textContent = 'Unlock'; formErr(f, 'That password didn\'t work.'); $('input', f).select(); }
  },
  vaultLock: () => { V.lock(); ui.revealed.clear(); render(); },
  vaultAdd: () => vaultItemModal(),
  vaultEdit: el => vaultItemModal(V.items().find(x => x.id === el.dataset.id)),
  vaultDelete: async el => {
    const it = V.items().find(x => x.id === el.dataset.id);
    if (!(await confirmBox(`Delete “${it.label}” from the Vault? This can't be undone.`))) return;
    await V.remove(it.id); Sync.schedule(); render();
  },
  vaultReveal: el => {
    const id = el.dataset.id;
    ui.revealed.has(id) ? ui.revealed.delete(id) : ui.revealed.add(id);
    $('#vlist').innerHTML = vaultList();
  },
  vaultCopy: async el => {
    const it = V.items().find(x => x.id === el.dataset.id);
    try { await navigator.clipboard.writeText(it[el.dataset.f] || ''); toast('Copied to clipboard'); }
    catch { toast('Couldn\'t copy — your browser blocked clipboard access.'); }
  },
  vaultQuery: el => { ui.vaultQuery = el.value; $('#vlist').innerHTML = vaultList(); },
  vaultChangePw: () => changePwModal(),
};

// ================= drag to reorder =================
const setOrder = (coll, ids) => ids.forEach((id, i) => { const x = St.byId(coll, id); if (x) x.order = i; });
onSort('projects', ids => { setOrder('projects', ids); St.commit(); });
onSort('tasks', ids => { setOrder('tasks', ids); St.commit(); });
onSort('notes', ids => { setOrder('notes', ids); St.commit(); });
onSort('images', (ids, box) => { const n = St.byId('notes', box.dataset.note); n.imageIds = ids; St.commit(); });

// ================= event delegation =================
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act]) A[el.dataset.act](el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-submit]');
  if (!f) return;
  e.preventDefault();
  A[f.dataset.submit]?.(f, Object.fromEntries(new FormData(f)));
});
document.addEventListener('input', e => { const el = e.target.closest?.('[data-input]'); if (el) A[el.dataset.input]?.(el, e); });
document.addEventListener('change', e => { const el = e.target.closest?.('[data-change]'); if (el) A[el.dataset.change]?.(el, e); });
document.addEventListener('focusout', e => { const el = e.target.closest?.('[data-blur]'); if (el) A[el.dataset.blur]?.(el, e); });

// Toolbar buttons: act on mousedown so the editor keeps its selection.
document.addEventListener('mousedown', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  e.preventDefault();
  fmt(b.dataset.cmd, b);
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { const o = $$('.overlay').pop(); if (o) { o._close ? o._close() : o.remove(); return; } }
  const blur = e.target.closest?.('[data-blur]');
  if (blur && e.key === 'Enter') { e.preventDefault(); blur.blur(); }
  if (e.target.matches?.('.quick textarea') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) A.saveQuick();
  if (e.target.matches?.('.note-title') && e.key === 'Enter') { e.preventDefault(); e.target.closest('.notes').querySelector('.editor').focus(); }
  const ed = e.target.closest?.('.editor');
  if (!ed) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    const inList = elOf(getSelection().anchorNode)?.closest('li');
    if (inList && ed.contains(inList)) listCmd(ed, e.shiftKey ? 'outdent' : 'indent');
    else if (!e.shiftKey) document.execCommand('insertText', false, '\t');
    changed(ed);
  } else if ((e.key === '>' || e.key === '-') && !e.metaKey && !e.ctrlKey && arrowShortcut(e.key)) {
    e.preventDefault(); changed(ed);
  } else if (e.key === ' ' && !e.metaKey && !e.ctrlKey && markdownShortcut(ed)) {
    e.preventDefault(); changed(ed);
  } else if ((e.metaKey || e.ctrlKey) && e.altKey && /^Digit[0-3]$/.test(e.code)) {
    e.preventDefault();
    const tag = ['p', 'h2', 'h3', 'h4'][+e.code.slice(5)];
    tag === 'p' ? document.execCommand('formatBlock', false, 'p') : setBlock(tag);
    changed(ed);
  }
});

// Paste: images go to the gallery; text is pasted as plain text (keeps notes tidy and safe).
document.addEventListener('paste', e => {
  const ed = e.target.closest?.('.editor');
  if (!ed) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  e.preventDefault();
  if (files.length) return addImagesToNote(ed.dataset.id, files);
  const text = e.clipboardData.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
});

// Drag & drop images onto a note.
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  $$('.notes.dragging').forEach(n => n.classList.remove('dragging'));
  e.target.closest?.('[data-drop]')?.classList.add('dragging');
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) $$('.notes.dragging').forEach(n => n.classList.remove('dragging')); });
document.addEventListener('drop', e => {
  const z = e.target.closest?.('[data-drop]');
  $$('.notes.dragging').forEach(n => n.classList.remove('dragging'));
  if (hasFiles(e)) {
    e.preventDefault(); // never let the browser navigate away to a dropped file
    if (z) addImagesToNote(z.dataset.drop, e.dataTransfer.files);
    else toast('Drop images onto a note to add them.');
    return;
  }
  if (e.target.closest?.('.editor') && [...e.dataTransfer.types].includes('text/html')) {
    e.preventDefault();
    document.execCommand('insertText', false, e.dataTransfer.getData('text/plain'));
  }
});

// Vault auto-lock: 5 minutes without activity on the Vault page.
document.addEventListener('pointerdown', () => { if (V.unlocked() && ui.route === 'vault') V.touch(); }, true);
document.addEventListener('keydown', () => { if (V.unlocked() && ui.route === 'vault') V.touch(); }, true);
setInterval(() => {
  if (V.unlocked() && V.idleLeft() === 0) { V.lock(); ui.revealed.clear(); render(); toast('Vault locked after 5 minutes idle'); }
}, 10_000);

document.addEventListener('visibilitychange', () => { if (document.hidden) St.flush(); });
window.addEventListener('pagehide', () => St.flush());
window.addEventListener('hashchange', () => { document.body.classList.remove('nav-open'); parseRoute(); if (ui.route === 'vault' && V.unlocked()) V.touch(); render(); });

// Keep relative dates ("Today", "Tomorrow") correct if the app stays open past midnight.
let lastDay = today();
setInterval(() => {
  if (today() !== lastDay && !document.activeElement?.closest?.('.editor, input, textarea')) { lastDay = today(); render(); }
}, 60_000);

// ================= boot =================
(async function boot() {
  document.execCommand('defaultParagraphSeparator', false, 'p');
  await St.load();
  await Sync.init();
  ui.vaultExists = await V.exists();
  St.onChange(render);
  St.onPersist(() => Sync.schedule());
  Sync.onStatus(() => { const el = $('#syncLine'); if (el) el.innerHTML = syncLine(); });
  Sync.onRemoteChange(async kinds => {
    if (kinds.has('vault') && V.unlocked()) { V.lock(); ui.revealed.clear(); toast('Vault updated from another device — unlock again to see changes'); }
    ui.vaultExists = await V.exists();
    renderSoon();
  });
  parseRoute();
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline mode unavailable', e));
  Sync.syncNow();
  setInterval(() => Sync.syncNow(), 60_000);
  setInterval(() => { const el = $('#syncLine'); if (el) el.innerHTML = syncLine(); }, 30_000);
  window.addEventListener('online', () => Sync.syncNow());
  window.addEventListener('focus', () => Sync.schedule(300));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Sync.schedule(300); });
})();
