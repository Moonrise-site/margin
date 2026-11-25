// App state: one plain object persisted to IndexedDB. Images and the vault live elsewhere.
import { kvGet, kvSet } from './db.js';
import { uid, today, addDays, isDate, isTime } from './util.js';

export const COLORS = ['peach', 'sage', 'blue', 'plum', 'gold', 'rose', 'teal', 'slate'];

export let state = null;

const listeners = new Set();
export const onChange = fn => listeners.add(fn);

let timer = null;
export function save() { clearTimeout(timer); timer = setTimeout(flush, 200); }
const persistFns = new Set();
/** Called after every save, including silent ones (used to schedule sync). */
export const onPersist = fn => persistFns.add(fn);
export async function flush() {
  const wasPending = timer !== null;
  clearTimeout(timer); timer = null;
  if (state) await kvSet('state', state);
  if (wasPending) persistFns.forEach(f => f());
}

/** Persist, and re-render unless {silent:true} (used while typing in the editor). */
export function commit(opts = {}) {
  save();
  if (!opts.silent) listeners.forEach(f => f());
}

export async function load() {
  state = await kvGet('state');
  if (!state) {
    state = fresh();
    seed();
    await flush();
  }
  migrate();
}

export async function replaceState(s) {
  state = s;
  migrate();
  await flush();
}

/** An empty state with no sample content. */
export function blankState() {
  const s = fresh();
  if (state?.settings?.theme) s.settings.theme = state.settings.theme;
  return s;
}

function fresh() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return { v: 1, settings: { theme: dark ? 'dark' : 'light' }, projects: [], tasks: [], notes: [], events: [] };
}

// Normalises data and makes anything that ends up in HTML attributes safe (matters for imported backups).
const safeId = x => typeof x === 'string' && /^[\w-]{1,64}$/.test(x);
function migrate() {
  const s = state;
  s.settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
  if (!['light', 'dark'].includes(s.settings.theme)) s.settings.theme = 'light';
  for (const k of ['projects', 'tasks', 'notes', 'events']) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of ['projects', 'tasks', 'notes', 'events']) s[k] = s[k].filter(x => x && typeof x === 'object');
  const all = [...s.projects, ...s.tasks, ...s.notes, ...s.events];
  all.forEach(x => { if (!safeId(x.id)) x.id = uid(); });
  const pids = new Set(s.projects.map(p => p.id));
  const ref = x => (safeId(x.projectId) && pids.has(x.projectId) ? x.projectId : null);
  s.projects.forEach(p => {
    p.name = String(p.name ?? 'Untitled');
    p.emoji = String(p.emoji ?? '');
    if (!COLORS.includes(p.color)) p.color = 'peach';
    if (!isDate(p.due)) p.due = null;
    if (!safeId(p.coverId)) p.coverId = null;
    p.created ||= Date.now();
  });
  s.tasks.forEach(t => {
    t.title = String(t.title ?? '');
    t.projectId = ref(t);
    t.done = !!t.done;
    if (!isDate(t.due)) t.due = null;
    t.created ||= Date.now();
  });
  s.notes.forEach(n => {
    n.title = String(n.title ?? '');
    n.html = String(n.html ?? '');
    n.projectId = ref(n);
    n.imageIds = Array.isArray(n.imageIds) ? n.imageIds.filter(safeId) : [];
    n.created ||= Date.now();
    n.updated ||= n.created;
  });
  s.events.forEach(e => {
    e.title = String(e.title ?? '');
    e.projectId = ref(e);
    if (!isDate(e.date)) e.date = today();
    if (!isTime(e.time)) e.time = '';
  });
}

// ---- queries ----
export const projects = () => [...state.projects].sort(byOrder);
export const proj = id => (id ? state.projects.find(p => p.id === id) : null);
export const byId = (coll, id) => state[coll].find(x => x.id === id);
export const tasksOf = pid => state.tasks.filter(t => t.projectId === (pid || null));
export const byOrder = (a, b) => (a.order ?? a.created) - (b.order ?? b.created);
export const notesOf = pid => state.notes.filter(n => n.projectId === (pid || null)).sort(byOrder);
export const eventsOn = date => state.events.filter(e => e.date === date).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));

export function coverImages(p) {
  const ids = notesOf(p.id).flatMap(n => n.imageIds);
  if (p.coverId && ids.includes(p.coverId)) return [p.coverId, ...ids.filter(i => i !== p.coverId)];
  return ids;
}

// ---- mutations (call commit() afterwards) ----
export function addProject(fields) {
  const p = { id: uid(), name: 'Untitled', emoji: '', color: 'peach', due: null, coverId: null, created: Date.now(), ...fields };
  state.projects.push(p);
  addNote(p.id, 'Notes', '');
  return p;
}
export function addTask(title, projectId = null, due = null) {
  const t = { id: uid(), title, projectId, due, done: false, created: Date.now() };
  state.tasks.push(t);
  return t;
}
export function addNote(projectId, title = 'Untitled', html = '') {
  const n = { id: uid(), projectId, title, html, imageIds: [], created: Date.now(), updated: Date.now() };
  state.notes.push(n);
  return n;
}
export function addEvent({ title, date, time = '', projectId = null }) {
  const e = { id: uid(), title, date, time, projectId };
  state.events.push(e);
  return e;
}
export function remove(coll, id) {
  const a = state[coll];
  const i = a.findIndex(x => x.id === id);
  return i >= 0 ? a.splice(i, 1)[0] : null;
}
/** Removes a project and everything in it. Returns image ids to delete from storage. */
export function deleteProject(id) {
  const imgs = state.notes.filter(n => n.projectId === id).flatMap(n => n.imageIds);
  state.notes = state.notes.filter(n => n.projectId !== id);
  state.tasks = state.tasks.filter(t => t.projectId !== id);
  state.events = state.events.filter(e => e.projectId !== id);
  remove('projects', id);
  return imgs;
}

function seed() {
  const t = today();
  const p = addProject({ name: 'Getting started', emoji: '🌿', color: 'sage', due: addDays(t, 14) });
  const n = state.notes.find(x => x.projectId === p.id);
  n.title = 'Welcome';
  n.html = [
    '<p>This is a project. Each one gets its own <b>notes</b>, <b>to‑do list</b> and <b>calendar</b>.</p>',
    '<h3>A few things to try</h3>',
    '<ul><li>Drop or paste images into a note — they collect in a small gallery strip instead of taking over the page.</li>',
    '<li>Press <b>⌘K</b> (or Ctrl+K) to jump anywhere or add a task fast.</li>',
    '<li>Click a task to rename it, click its date to reschedule.</li>',
    '<li>Open <b>Customize</b> to change a project\'s name, icon, colour and due date.</li></ul>',
    '<blockquote>Everything stays in this browser on this computer. Use Settings → Export backup now and then.</blockquote>',
  ].join('');
  addTask('Make your first real project', p.id, t);
  addTask('Add an image to this note', p.id, addDays(t, 1));
  addTask('Set up the Vault', p.id, addDays(t, 3));
  addTask('Look around', p.id).done = true;
  addTask('Things that don\'t belong to a project go here', null, t);
  addEvent({ title: 'Example event', date: addDays(t, 2), time: '10:00', projectId: p.id });
}
