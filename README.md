# Margin

A calm planner: projects with notes, to‑dos and a calendar, a General list, and an encrypted Vault.

## Opening it

**Online:** https://moonrise-site.github.io/margin/ (use this one on every device; install it from there).

Or run it locally: Double-click **Open Margin.command** (the first time, macOS may ask you to right-click → Open).
Or from a terminal in this folder:

```bash
python3 -m http.server 4321 --bind 127.0.0.1
```

then visit http://localhost:4321.

**Always use the same address (http://localhost:4321).** Your data is stored by the browser for that exact address; a different port or browser shows an empty app.

## Installing it as an app

Open Margin, then:
- **Safari**: File → Add to Dock
- **Chrome / Edge / Arc**: the install icon at the right of the address bar (or ⚙ Settings → Install Margin)

It gets its own Dock icon and window, and works offline. You don't need the launcher running after that.

## Sync between devices

See **SYNC-SETUP.md**. It uses a free Supabase account, and everything is encrypted on your devices first.

## Writing notes

- **Headers**: H1 / H2 / H3 in the toolbar, or type `# `, `## `, `### ` at the start of a line (⌘⌥1/2/3).
- **Lists**: `- ` for bullets, `1. ` for numbers. **Tab** indents a list item, **⇧Tab** brings it back.
- **Colours**: select text, then **A** for text colour or highlight.
- **Emoji & symbols**: the 🙂 button (hold ⇧ to insert several). `->` `<-` `=>` turn into → ← ⇒ as you type; ⌘Z undoes it.
- **Tabs or Cards**: the switch above a project's notes shows one note at a time, or all of them as stacked cards.
- Project icon and colour (any colour, via the rainbow circle) are under **Customize**.

## Reordering

Drag projects (sidebar or Today cards), tasks inside a project, note tabs or note cards, and images in the gallery view. On a phone, press and hold first.

## Where your data lives

Everything is saved in the browser's IndexedDB storage on this computer. Nothing is uploaded unless you turn on sync, and then only in encrypted form.
Use ⚙ Settings → **Export backup** regularly. It saves one `.json` file with your projects, notes, images and the (still encrypted) Vault. **Restore from backup** brings it all back.

## The Vault

Items are encrypted with AES‑256‑GCM. The key comes from your master password via PBKDF2‑SHA256 (600,000 rounds). Only encrypted data is ever written to disk. The Vault locks itself after 5 minutes without activity on the Vault page. **If you forget the master password, nobody can recover the contents.**

## Files

- `index.html`, `css/app.css`: page and styles (light and dark themes)
- `js/app.js`: actions, editor, dialogs, search palette, backups
- `js/views.js`: what each screen looks like
- `js/store.js`: data model and saving
- `js/vault.js`: encryption
- `js/images.js`, `js/db.js`: image and database storage
- `js/sync.js`: encrypted sync; `supabase-setup.sql`: the database setup it needs
- `js/sortable.js`: drag to reorder
- `js/picker.js`: emoji, symbols and colour pickers
- `sw.js`, `manifest.webmanifest`, `icons/`: installable app and offline mode
