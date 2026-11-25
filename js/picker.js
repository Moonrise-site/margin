// Small popovers: emoji & special characters, and text colours.
// Buttons act on mousedown with preventDefault, so the note editor keeps its cursor/selection.
import { esc, TINTS } from './util.js';

const split = s => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment).filter(x => x.trim());

export const EMOJI = {
  'Smileys': split('😀 😄 😊 🙂 😉 😍 🥰 😎 🤓 🤔 😴 😅 😂 🥲 😬 😮 😢 😤 🤯 🥳 🤗 🙃 😇 🫠 👍 👎 👏 🙌 🙏 💪 ✌️ 🤞 👋 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍'),
  'Nature': split('🌿 🌱 🌳 🌲 🌵 🌸 🌼 🌻 🌷 🍀 🍁 🍂 🌊 🔥 ⭐ 🌙 ☀️ 🌈 ⛅ ❄️ ⚡ 🌍 🐶 🐱 🐰 🦊 🐻 🐼 🐝 🦋 🐢 🐟 🐦 🐾'),
  'Food': split('☕ 🍵 🍷 🍺 🥂 🍎 🍋 🍓 🍑 🥑 🥕 🌽 🍞 🧀 🍳 🥗 🍝 🍕 🍣 🍰 🎂 🍪 🍫 🍿'),
  'Activity & travel': split('✈️ 🚗 🚲 🚆 🚢 🏠 🏡 🏢 🏖️ ⛰️ 🏕️ 🗺️ 🧳 🎒 ⚽ 🏀 🎾 🏃 🧘 🏊 🎨 🎬 🎵 🎸 🎮 🎲 🎉 🎁 🏆 🎯'),
  'Objects': split('📌 📍 📎 📝 ✏️ 🖊️ 📓 📔 📚 📖 📅 📆 🗓️ ⏰ ⌛ 📊 📈 📉 🗂️ 📁 📦 🏷️ 💼 💻 🖥️ 📱 📷 🎥 🎧 💡 🔦 🔧 🔨 🧰 🛠️ 🔑 🔒 🔓 💳 💰 🧾 ✉️ 📬 📞 🛒 🧴 🪴 🛏️ 🧹'),
  'Signs': split('✅ ☑️ ✔️ ❌ ❎ ⚠️ ❗ ❓ 💬 💭 🔔 🔕 🚩 🏁 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ ♻️ ➕ ➖ ✳️ 💯 🆕 🆗 🔜'),
};
export const SYMBOLS = {
  'Arrows': split('→ ← ↑ ↓ ↔ ↕ ⇒ ⇐ ⇔ ⇧ ⇩ ↗ ↘ ↙ ↖ ↩ ↪ ⟶ ⟵ ➜ ➔ ➝ ↻ ↺ ▸ ▹ ► ◄ ▲ ▼'),
  'Bullets & marks': split('• ◦ ▪ ▫ ‣ ⁃ ✓ ✔ ✗ ✘ ☐ ☑ ☒ ★ ☆ ✦ ✧ ♥ ♡ ◆ ◇ ● ○ ■ □ ◉ ◎ ※ ✱ ⚑ ⚐ ⌘ ⌥ ⇧ ⏎'),
  'Punctuation': split('— – … · « » “ ” ‘ ’ ¶ § † ‡ © ® ™ ° ′ ″ ¿ ¡ ⁂ ❝ ❞'),
  'Maths & units': split('± × ÷ ≈ ≠ ≤ ≥ ∞ √ ∑ ∆ π µ ‰ ½ ⅓ ⅔ ¼ ¾ ⁰ ¹ ² ³ ⁴ ₀ ₁ ₂ ∈ ∅ ∩ ∪ ∴ ∵ ∠'),
  'Currency': split('€ £ $ ¥ ¢ ₿ ₹ ₩ ₽ ₺ ₪ ฿ ₫ ₣'),
};

const RECENT_KEY = 'margin-recent-chars';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const remember = ch => localStorage.setItem(RECENT_KEY, JSON.stringify([ch, ...recent().filter(x => x !== ch)].slice(0, 18)));

let open = null;
export function closePicker() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  document.removeEventListener('keydown', open.key, true);
  open = null;
}

function popover(anchor, html, onClick) {
  closePicker();
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = html;
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.left = left + 'px'; el.style.top = top + 'px';
  el.addEventListener('mousedown', e => e.preventDefault()); // keep the editor's selection
  el.addEventListener('click', e => onClick(e, el));
  const outside = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePicker(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePicker(); } };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  open = { el, outside, key, anchor };
  return el;
}
export const pickerOpenFor = a => open?.anchor === a;

// Emoji & symbols. opts: { tabs: ['emoji','symbols'], onPick(ch), onClear?, clearLabel? }
export function charPicker(anchor, opts) {
  const tabs = opts.tabs || ['emoji', 'symbols'];
  let tab = tabs[0];
  const sets = { emoji: EMOJI, symbols: SYMBOLS };
  const grid = () => {
    const rec = recent().filter(ch => tab === 'symbols' ? !/\p{Extended_Pictographic}/u.test(ch) : /\p{Extended_Pictographic}/u.test(ch));
    const groups = rec.length ? { 'Recent': rec, ...sets[tab] } : sets[tab];
    return Object.entries(groups).map(([g, list]) => `<div class="pg">${esc(g)}</div>
      <div class="pgrid-ch ${tab}">${list.map(ch => `<button type="button" data-ch="${esc(ch)}" title="${esc(ch)}">${esc(ch)}</button>`).join('')}</div>`).join('');
  };
  const html = () => `
    ${tabs.length > 1 ? `<div class="ptabs">${tabs.map(t => `<button type="button" data-tab="${t}" class="${t === tab ? 'on' : ''}">${t === 'emoji' ? '☺ Emoji' : '→ Symbols'}</button>`).join('')}</div>` : ''}
    <div class="pbody">${grid()}</div>
    <div class="pfoot">${opts.onClear ? `<button type="button" data-clear>${esc(opts.clearLabel || 'None')}</button>` : ''}<span>More: <kbd>⌃⌘Space</kbd></span></div>`;
  const el = popover(anchor, `<div class="charpick">${html()}</div>`, (e, el) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; el.firstElementChild.innerHTML = html(); return; }
    if (e.target.closest('[data-clear]')) { closePicker(); opts.onClear(); return; }
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    remember(b.dataset.ch);
    if (!e.shiftKey) closePicker(); // hold Shift to insert several
    opts.onPick(b.dataset.ch);
  });
  return el;
}

// Text colour + highlight. onPick('tc'|'hl', name|null)
const TINT_LABEL = { ink: 'Default', muted: 'Grey', rose: 'Red', peach: 'Orange', gold: 'Yellow', sage: 'Green', teal: 'Teal', blue: 'Blue', plum: 'Purple' };
export function colorPicker(anchor, onPick) {
  const row = kind => TINTS.map(t => {
    const none = t === 'ink';
    const label = kind === 'hl' && none ? 'No highlight' : TINT_LABEL[t];
    return `<button type="button" class="sw ${kind} ${none ? 'none' : ''}" data-kind="${kind}" data-t="${none ? '' : t}" data-tint="${t}" title="${label}">${kind === 'tc' ? 'A' : ''}</button>`;
  }).join('');
  popover(anchor, `<div class="colpick">
      <div class="pg">Text colour</div><div class="swrow">${row('tc')}</div>
      <div class="pg">Highlight</div><div class="swrow">${row('hl')}</div>
    </div>`, e => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    closePicker();
    onPick(b.dataset.kind, b.dataset.t || null);
  });
}
