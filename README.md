# Margin

A calm planner: projects with notes, to‑dos and a calendar, a General list, and an encrypted Vault.

## Opening it

Double-click **Open Margin.command** (the first time, macOS may ask you to right-click → Open).
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

## Reordering

Drag projects (sidebar or Today cards), tasks inside a project, note tabs, and images in the gallery view. On a phone, press and hold first.

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
- `sw.js`, `manifest.webmanifest`, `icons/`: installable app and offline mode
