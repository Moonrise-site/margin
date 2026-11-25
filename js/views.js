// Pure render functions: state -> HTML strings. Interaction is wired in app.js via data-* attributes.
import { esc, today, addDays, fmtDue, fmtLong, ago, parse, ymd, monthCells, monthName, sanitize } from './util.js';
import * as St from './store.js';
import * as V from './vault.js';
import * as Sync from './sync.js';

export const ui = {
  route: 'today', param: null,
  activeNote: {},       // projectId|'general' -> noteId
  projCal: {},          // projectId|'general' -> 'YYYY-MM'
  cal: null,            // main calendar month
  showDone: {},
  quick: '', quickPid: '',
  revealed: new Set(),
  vaultQuery: '',
  vaultExists: false,
};

const S = () => St.state;
const pcolor = pid => { const p = St.proj(pid); return p ? `var(--c-${p.color})` : 'var(--muted)'; };
const pname = pid => St.proj(pid)?.name || 'General';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function projectOptions(sel, generalLabel = 'General (no project)') {
  return `<option value="">${generalLabel}</option>` +
    St.projects().map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc((p.emoji ? p.emoji + ' ' : '') + p.name)}</option>`).join('');
}

// ---------- sidebar ----------
export function sidebar() {
  const t = today();
  const open = S().tasks.filter(x => !x.done);
  const dueNow = open.filter(x => x.due && x.due <= t).length;
  const gen = open.filter(x => !x.projectId).length;
  const r = ui.route;
  const link = (href, ic, label, count, on) =>
    `<a href="${href}" class="${on ? 'on' : ''}"><span class="ic">${ic}</span><span class="nm">${label}</span><span class="count">${count || ''}</span></a>`;
  return `
    <div class="brand serif"><i></i>Margin</div>
    <div>
      <div class="sec">Everyday</div>
      <nav class="nav">
        ${link('#/today', '☀︎', 'Today', dueNow, r === 'today')}
        ${link('#/todo', '✓', 'General', gen, r === 'todo')}
        ${link('#/calendar', '▦', 'Calendar', '', r === 'calendar')}
      </nav>
    </div>
    <div>
      <div class="sec">Projects <button data-act="newProject" title="New project">+</button></div>
      <nav class="nav" data-sortable="projects">
        ${St.projects().map(p => `
          <a href="#/p/${p.id}" class="${r === 'p' && ui.param === p.id ? 'on' : ''}" data-sort-id="${p.id}" draggable="false">
            <span class="dot" style="background:var(--c-${p.color})"></span>
            <span class="nm">${p.emoji ? esc(p.emoji) + ' ' : ''}${esc(p.name)}</span>
            <span class="count">${St.tasksOf(p.id).filter(x => !x.done).length || ''}</span>
          </a>`).join('')}
        <a class="add" data-act="newProject"><span class="ic">+</span>New project</a>
      </nav>
    </div>
    <div class="side-foot">
      <div id="syncLine">${syncLine()}</div>
      <nav class="nav">${link('#/vault', V.unlocked() ? '🔓' : '🔒', 'Vault', V.unlocked() ? 'open' : '', r === 'vault')}</nav>
      <div class="foot-row">
        <div class="theme">
          <button data-act="setTheme" data-t="light" class="${S().settings.theme === 'light' ? 'on' : ''}">☼ Light</button>
          <button data-act="setTheme" data-t="dark" class="${S().settings.theme === 'dark' ? 'on' : ''}">☾ Dark</button>
        </div>
        <button class="icon-btn" data-act="settings" title="Settings & backup">⚙</button>
      </div>
    </div>`;
}

export function syncLine() {
  if (!Sync.enabled()) return '';
  const st = Sync.getStatus();
  const when = st.at ? ago(st.at) : '';
  const [cls, text] =
    st.state === 'syncing' ? ['busy', 'Syncing…'] :
    st.state === 'offline' ? ['', 'Offline — will sync later'] :
    st.state === 'error' ? ['err', st.auth ? 'Sync: sign in again' : 'Sync problem — tap for details'] :
    ['ok', when ? `Synced ${when}` : 'Sync on'];
  return `<div class="sync-line ${cls}" data-act="settings" title="${esc(st.error || '')}"><i></i>${text}</div>`;
}

// ---------- shared: task row ----------
export function taskRow(t, { showProject = true, sortable = false } = {}) {
  const p = St.proj(t.projectId);
  const hot = !t.done && t.due && t.due <= today();
  const chip = !showProject ? '' : p
    ? `<a class="chip" href="#/p/${p.id}" style="color:var(--c-${p.color})">${esc(p.name)}</a>`
    : `<a class="chip" href="#/todo">General</a>`;
  return `
    <div class="row ${t.done ? 'd' : ''}"${sortable ? ` data-sort-id="${t.id}"` : ''}>
      <button class="chk" data-act="toggleTask" data-id="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}"></button>
      <span class="t" data-act="editTask" data-id="${t.id}">${esc(t.title)}</span>
      ${chip}
      <span class="datepick ${hot ? 'hot' : ''} ${t.due ? '' : 'ghost'}" data-act="pickDate" title="Change date">
        ${t.due ? fmtDue(t.due) : '+ date'}
        <input type="date" value="${t.due || ''}" data-change="taskDue" data-id="${t.id}" tabindex="-1">
      </span>
      <button class="x" data-act="deleteTask" data-id="${t.id}" title="Delete">×</button>
    </div>`;
}
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created;

// ---------- Today ----------
export function vToday() {
  const t = today();
  const h = new Date().getHours();
  const greet = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const open = S().tasks.filter(x => !x.done);
  const overdue = open.filter(x => x.due && x.due < t).sort(byDue);
  const dueToday = open.filter(x => x.due === t);
  const doneToday = S().tasks.filter(x => x.done && x.doneAt && ymd(new Date(x.doneAt)) === t);
  const soon = open.filter(x => x.due > t && x.due <= addDays(t, 7)).sort(byDue);
  const evToday = St.eventsOn(t);

  const bits = [fmtLong(t)];
  bits.push(dueToday.length ? `${plural(dueToday.length, 'thing')} due today` : 'nothing due today');
  if (overdue.length) bits.push(`${overdue.length} overdue`);
  if (evToday.length) bits.push(plural(evToday.length, 'event'));

  const group = (label, arr, hot) => arr.length ? `<div class="grp ${hot ? 'hot' : ''}">${label}</div>${arr.map(x => taskRow(x)).join('')}` : '';
  const anything = overdue.length + dueToday.length + soon.length + doneToday.length;

  return `<div class="wrap">
    <div class="hello serif">${greet}.</div>
    <div class="sub">${bits.join(' · ')}</div>

    <h2 class="label">Projects <span>${plural(St.projects().length, 'project')}</span></h2>
    <div class="tiles" data-sortable="projects" data-axis="grid">
      ${St.projects().map(tile).join('')}
      <div class="tile new" data-act="newProject">＋ New project</div>
    </div>

    <h2 class="label">Today, across everything</h2>
    <div class="list">
      ${group('Overdue', overdue, true)}
      ${group('Today', [...dueToday, ...doneToday], false)}
      ${group('Next 7 days', soon, false)}
      ${anything ? '' : '<div class="empty">Nothing scheduled this week. Enjoy it — or add something below.</div>'}
      <form class="addrow" data-submit="addTask" data-key="today">
        <input name="title" placeholder="+ Add a task…" autocomplete="off">
        <select name="projectId" title="Project">${projectOptions('', 'General')}</select>
        <input type="date" name="due" value="${t}" title="Due date">
      </form>
    </div>
  </div>`;
}

function tile(p) {
  const ts = St.tasksOf(p.id);
  const done = ts.filter(x => x.done).length;
  const pct = ts.length ? Math.round(done / ts.length * 100) : 0;
  const imgs = St.coverImages(p).slice(0, 3);
  const cover = imgs.length
    ? imgs.map(id => `<div data-img="${id}"></div>`).join('')
    : `<div class="ph" style="--pc:var(--c-${p.color})"></div>`;
  return `<a class="tile" href="#/p/${p.id}" data-sort-id="${p.id}" draggable="false">
    <div class="cover">${cover}</div>
    <div class="tb">
      <div class="n serif"><span>${p.emoji ? esc(p.emoji) + ' ' : ''}${esc(p.name)}</span>
        <div class="ring" title="${done} of ${ts.length} done" style="background:conic-gradient(var(--c-${p.color}) ${pct}%, var(--raise2) 0)"></div></div>
      <div class="stats"><span><b>${ts.length - done}</b> open</span><span><b>${St.notesOf(p.id).length}</b> notes</span>${p.due ? `<span>Due ${fmtDue(p.due)}</span>` : ''}</div>
    </div></a>`;
}

// ---------- General ----------
export function vGeneral() {
  return `
    <div class="vhead"><h1 class="serif">General</h1><span class="subt">— to‑dos and notes that don't belong to a project</span></div>
    <div class="pgrid general">
      ${todoPanel(null, true)}
      ${notesPanel(null)}
    </div>`;
}

// ---------- Project ----------
export function vProject() {
  const p = St.proj(ui.param);
  if (!p) return `<div class="empty">That project doesn't exist anymore. <a href="#/today"><u>Back to Today</u></a></div>`;
  return `
    <div class="crumbs"><a href="#/today">← Today</a></div>
    <div class="phead" style="--pc:var(--c-${p.color})">
      ${p.emoji ? `<span class="emoji">${esc(p.emoji)}</span>` : `<span class="dot" style="background:var(--c-${p.color});width:12px;height:12px;border-radius:4px"></span>`}
      <h1 class="serif" contenteditable="plaintext-only" spellcheck="false" data-blur="renameProject" data-id="${p.id}">${esc(p.name)}</h1>
      <span class="tag datepick ${p.due ? 'set' : ''}" data-act="pickDate">${p.due ? 'Due ' + fmtDue(p.due) : '+ Due date'}
        <input type="date" value="${p.due || ''}" data-change="projectDue" data-id="${p.id}" tabindex="-1"></span>
      <span class="sp"></span>
      <button class="btn" data-act="editProject" data-id="${p.id}">Customize</button>
    </div>
    <div class="pgrid">
      ${notesPanel(p.id)}
      <div class="stack">${todoPanel(p.id)}${calPanel(p.id)}</div>
    </div>`;
}

export function todoPanel(pid, withDate = false) {
  const key = pid || 'general';
  const ts = St.tasksOf(pid);
  const open = ts.filter(t => !t.done).sort(St.byOrder);
  const done = ts.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return `<section class="panel">
    <h3 class="serif">To‑do <span>${ts.length ? `${done.length} of ${ts.length} done` : ''}</span></h3>
    <div data-sortable="tasks">${open.map(t => taskRow(t, { showProject: false, sortable: true })).join('')}</div>
    ${open.length ? '' : `<div class="empty-sm">Nothing open${ts.length ? ' — nice.' : ' yet.'}</div>`}
    <form class="addrow" style="padding:6px 0 2px" data-submit="addTask" data-key="${key}">
      <input type="hidden" name="projectId" value="${pid || ''}">
      <input name="title" placeholder="+ Add a task" autocomplete="off">
      ${withDate ? `<input type="date" name="due" title="Due date (optional)">` : ''}
    </form>
    ${done.length ? `<button class="link-btn" data-act="toggleDone" data-key="${key}">${ui.showDone[key] ? 'Hide' : 'Show'} ${done.length} completed</button>
      ${ui.showDone[key] ? done.map(t => taskRow(t, { showProject: false })).join('') : ''}` : ''}
  </section>`;
}

export function notesPanel(pid) {
  const key = pid || 'general';
  const notes = St.notesOf(pid);
  const n = notes.find(x => x.id === ui.activeNote[key]) || notes[0];
  const tabs = notes.map(x => `<button class="${x === n ? 'on' : ''}" data-act="openNote" data-pid="${pid || ''}" data-id="${x.id}" data-sort-id="${x.id}">${esc(x.title || 'Untitled')}</button>`).join('');
  const header = `<h3 class="serif">${pid ? 'Notes' : 'Loose notes'} <span>${n ? 'Edited ' + ago(n.updated) : ''}</span></h3>
    <div class="doctabs" data-sortable="notes" data-axis="x">${tabs}<button class="new" data-act="newNote" data-pid="${pid || ''}">+ New note</button></div>`;
  if (!n) return `<section class="panel notes">${header}<div class="empty">No notes yet.</div></section>`;
  return `<section class="panel notes" data-drop="${n.id}">
    ${header}
    <input class="note-title serif" value="${esc(n.title)}" placeholder="Untitled" data-input="noteTitle" data-id="${n.id}">
    <div class="toolbar">
      <button data-cmd="bold" title="Bold (⌘B)"><b>B</b></button>
      <button data-cmd="italic" title="Italic (⌘I)"><i>I</i></button>
      <button data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
      <span class="sep"></span>
      <button data-cmd="h3" title="Heading">H</button>
      <button data-cmd="insertUnorderedList" title="Bullet list">• List</button>
      <button data-cmd="insertOrderedList" title="Numbered list">1. List</button>
      <button data-cmd="blockquote" title="Callout">❝</button>
      <button data-cmd="link" title="Link">🔗</button>
      <span class="sep"></span>
      <button data-act="addImages" data-id="${n.id}" title="Add images">🖼 Images</button>
    </div>
    <div class="editor" contenteditable="true" data-input="noteBody" data-id="${n.id}">${sanitize(n.html)}</div>
    ${gallery(n)}
    <div class="note-foot"><span>${plural(n.imageIds.length, 'image')}</span><span class="sp"></span><button data-act="deleteNote" data-id="${n.id}">Delete note</button></div>
  </section>`;
}

function gallery(n) {
  const ids = n.imageIds;
  if (!ids.length) return `<div class="drop-hint" data-act="addImages" data-id="${n.id}">Drop, paste or click to add images — they'll sit here as a small gallery.</div>`;
  const show = ids.length > 4 ? ids.slice(0, 3) : ids;
  const more = ids.length - show.length;
  return `<div class="gallery">
    ${show.map((id, i) => `<button class="thumb" data-img="${id}" data-act="openImage" data-note="${n.id}" data-i="${i}" aria-label="Open image"></button>`).join('')}
    ${more ? `<button class="thumb more" data-act="openGallery" data-note="${n.id}">+${more}</button>` : ''}
    <button class="thumb add" data-act="addImages" data-id="${n.id}" title="Add images">+</button>
  </div>`;
}

export function calPanel(pid) {
  const key = pid || 'general';
  const ym = ui.projCal[key] || today().slice(0, 7);
  const t = today();
  const evs = S().events.filter(e => e.projectId === pid);
  const due = S().tasks.filter(x => x.projectId === pid && x.due && !x.done);
  const upcoming = evs.filter(e => e.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);
  return `<section class="panel">
    <h3 class="serif">${monthName(ym, ym.slice(0, 4) === t.slice(0, 4))}
      <span class="calnav" style="font:inherit">
        <button data-act="calNav" data-key="${key}" data-d="-1" title="Previous month">‹</button>
        <button data-act="calNav" data-key="${key}" data-d="0" title="This month">•</button>
        <button data-act="calNav" data-key="${key}" data-d="1" title="Next month">›</button>
      </span></h3>
    <div class="mcal">
      ${'MTWTFSS'.split('').map(d => `<div class="dow">${d}</div>`).join('')}
      ${monthCells(ym).map(c => {
        const has = evs.some(e => e.date === c.date) || due.some(x => x.due === c.date);
        return `<div class="d ${c.inMonth ? '' : 'o'} ${c.date === t ? 't' : ''}" data-act="newEvent" data-date="${c.date}" data-pid="${pid || ''}" title="Add event on ${c.date}" style="--pc:${pcolor(pid)}">${c.day}${has ? '<i></i>' : ''}</div>`;
      }).join('')}
    </div>
    <div class="evlist">
      ${upcoming.map(evRow).join('') || '<div class="empty-sm">No upcoming events.</div>'}
      <button class="link-btn" data-act="newEvent" data-pid="${pid || ''}">+ Add event</button>
    </div>
  </section>`;
}

const evRow = e => `<div class="ev" data-act="editEvent" data-id="${e.id}" style="--pc:${pcolor(e.projectId)}">
  <div class="bar"></div><div><span class="et">${esc(e.title)}</span><small>${fmtDue(e.date)}${e.time ? ' · ' + e.time : ''}${e.projectId ? ' · ' + esc(pname(e.projectId)) : ''}</small></div></div>`;

// ---------- Calendar ----------
export function vCalendar() {
  const ym = (ui.cal ||= today().slice(0, 7));
  const t = today();
  return `
    <div class="vhead">
      <h1 class="serif">${monthName(ym)}</h1><span class="sp"></span>
      <button class="btn" data-act="calNav" data-key="main" data-d="-1" title="Previous month">‹</button>
      <button class="btn" data-act="calNav" data-key="main" data-d="0">Today</button>
      <button class="btn" data-act="calNav" data-key="main" data-d="1" title="Next month">›</button>
      <button class="btn p" data-act="newEvent">+ Event</button>
    </div>
    <div class="bigcal">
      <div class="dows">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div>
      <div class="cells">
        ${monthCells(ym).map(c => {
          const items = [
            ...St.eventsOn(c.date).map(e => `<div class="ci ev" data-act="editEvent" data-id="${e.id}" style="--pc:${pcolor(e.projectId)}" title="${esc(e.title)}">${e.time ? `<b>${e.time}</b> ` : ''}${esc(e.title)}</div>`),
            ...S().tasks.filter(x => x.due === c.date).map(x => `<div class="ci tk ${x.done ? 'd' : ''}" data-act="toggleTask" data-id="${x.id}" title="${esc(x.title)} — click to ${x.done ? 'reopen' : 'complete'}">${x.done ? '☑' : '☐'} ${esc(x.title)}</div>`),
          ];
          return `<div class="cell ${c.inMonth ? '' : 'out'} ${c.date === t ? 'today' : ''}" data-act="newEvent" data-date="${c.date}">
            <span class="dn">${c.day}</span>${items.slice(0, 4).join('')}${items.length > 4 ? `<div class="ci more">+${items.length - 4} more</div>` : ''}</div>`;
        }).join('')}
      </div>
    </div>`;
}

// ---------- right column ----------
export function rightCol() {
  const t = today();
  const now = parse(t);
  const monday = addDays(t, -((now.getDay() + 6) % 7));
  const days = [...Array(7)].map((_, i) => addDays(monday, i));
  const week = days.map(d => {
    const cols = [...new Set([
      ...St.eventsOn(d).map(e => pcolor(e.projectId)),
      ...S().tasks.filter(x => x.due === d && !x.done).map(x => pcolor(x.projectId)),
    ])].slice(0, 3);
    return `<a href="#/calendar" class="${d === t ? 'on' : ''}">${parse(d).toLocaleDateString(undefined, { weekday: 'short' })}<b>${parse(d).getDate()}</b><span>${cols.map(c => `<i style="background:${c}"></i>`).join('')}</span></a>`;
  }).join('');
  const upcoming = S().events.filter(e => e.date >= t && e.date <= addDays(t, 14))
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99'))).slice(0, 6);
  const vault = V.unlocked()
    ? `<div class="box vault-mini"><div class="h">🔓 Vault <span class="muted">unlocked</span><button class="btn sm" data-act="vaultLock">Lock</button></div>
        <small><a href="#/vault"><u>${plural(V.items().length, 'item')}</u></a> · locks itself after 5 min idle</small></div>`
    : `<a class="box vault-mini" href="#/vault"><div class="h">🔒 Vault <span class="muted">${ui.vaultExists ? 'locked' : 'not set up'}</span></div>
        <small>Passwords & important info, encrypted on this device.</small></a>`;
  return `
    <div><h2 class="label">This week</h2><div class="week">${week}</div></div>
    <div>
      <h2 class="label">Coming up</h2>
      ${upcoming.map(evRow).join('') || '<div class="empty-sm">Nothing in the next two weeks.</div>'}
      <button class="link-btn" data-act="newEvent">+ Add event</button>
    </div>
    <div class="box quick">
      <h2 class="label">Quick note</h2>
      <textarea placeholder="Jot something down… (⌘↵ to save)" data-input="quickDraft">${esc(ui.quick)}</textarea>
      <div class="quick-foot">
        <select data-change="quickPid" title="Save to">${projectOptions(ui.quickPid, 'General')}</select>
        <button class="btn sm p" data-act="saveQuick">Save</button>
      </div>
    </div>
    ${vault}`;
}

// ---------- Vault ----------
export function vVault() {
  if (!ui.vaultExists) return `
    <div class="vault-card">
      <div class="big">🔒</div>
      <h1 class="serif">Set up your Vault</h1>
      <p>Choose a master password. Everything in the Vault is encrypted with it (AES‑256) and only ever stored encrypted on this computer.<br><b>There's no recovery</b> — if you forget it, the contents can't be opened.</p>
      <form class="panel" data-submit="vaultSetup">
        <label class="fld"><span>Master password (8+ characters)</span><input type="password" name="p1" autocomplete="new-password" required></label>
        <label class="fld"><span>Type it again</span><input type="password" name="p2" autocomplete="new-password" required></label>
        <div class="err"></div>
        <button class="btn p" style="width:100%">Create Vault</button>
      </form>
    </div>`;
  if (!V.unlocked()) return `
    <div class="vault-card">
      <div class="big">🔒</div>
      <h1 class="serif">Vault is locked</h1>
      <p>Enter your master password to open it.</p>
      <form class="panel" data-submit="vaultUnlock">
        <label class="fld"><span>Master password</span><input type="password" name="p" autocomplete="current-password" required autofocus></label>
        <div class="err"></div>
        <button class="btn p" style="width:100%">Unlock</button>
      </form>
    </div>`;
  return `
    <div class="vhead"><h1 class="serif">🔓 Vault</h1><span class="subt">${plural(V.items().length, 'item')}</span><span class="sp"></span>
      <button class="btn" data-act="vaultLock">Lock now</button><button class="btn p" data-act="vaultAdd">+ Add item</button></div>
    <div class="vault-tools"><input class="input" placeholder="Search the vault…" value="${esc(ui.vaultQuery)}" data-input="vaultQuery"></div>
    <div class="vgrid" id="vlist">${vaultList()}</div>
    <div class="vault-foot"><span>Locks itself after 5 minutes without activity here.</span><span class="sp"></span><button data-act="vaultChangePw">Change master password</button></div>`;
}

export function vaultList() {
  const q = ui.vaultQuery.trim().toLowerCase();
  const items = V.items().filter(it => !q || [it.label, it.username, it.note].some(s => (s || '').toLowerCase().includes(q)));
  if (!items.length) return `<div class="empty" style="grid-column:1/-1">${q ? 'No matches.' : 'Nothing here yet. Add Wi‑Fi passwords, account logins, policy numbers, door codes…'}</div>`;
  return items.map(it => {
    const shown = ui.revealed.has(it.id);
    return `<div class="panel vitem">
      <div class="vh"><b>${esc(it.label)}</b><span class="sp"></span>
        <button data-act="vaultEdit" data-id="${it.id}">Edit</button><button data-act="vaultDelete" data-id="${it.id}">Delete</button></div>
      ${it.username ? `<div class="vf"><span>Username</span><code>${esc(it.username)}</code><button data-act="vaultCopy" data-f="username" data-id="${it.id}">Copy</button></div>` : ''}
      ${it.secret ? `<div class="vf"><span>Secret</span><code class="${shown ? '' : 'masked'}">${shown ? esc(it.secret) : '••••••••'}</code>
        <button data-act="vaultReveal" data-id="${it.id}">${shown ? 'Hide' : 'Show'}</button><button data-act="vaultCopy" data-f="secret" data-id="${it.id}">Copy</button></div>` : ''}
      ${it.note ? `<div class="vnote">${esc(it.note)}</div>` : ''}
    </div>`;
  }).join('');
}
