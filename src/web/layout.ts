import { escapeHtml } from './html.js';

export interface FlashMessage {
  type: 'success' | 'error';
  text: string;
}

export type ActiveNav = 'home' | 'users' | 'books' | 'settings';

interface LayoutOptions {
  title: string;
  active: ActiveNav;
  body: string;
  flash?: FlashMessage | null;
}

const NAV_ITEMS: { key: ActiveNav; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Overview' },
  { key: 'users', href: '/users', label: 'Users' },
  { key: 'books', href: '/books', label: 'Books' },
  { key: 'settings', href: '/settings', label: 'Settings' },
];

/**
 * Shared HTML shell for every dashboard page. Server-rendered, no build
 * step -- htmx (loaded from a CDN) is a progressive-enhancement layer on
 * top of plain forms and links, which all work fine on their own if the
 * script never loads (e.g. no internet on the LAN). `hx-boost` on <body>
 * upgrades normal navigation to snappy AJAX swaps for free, no route
 * changes needed since every page already renders through this layout.
 */
export function renderLayout({ title, active, body, flash }: LayoutOptions): string {
  const nav = NAV_ITEMS.map(
    (item) => `<a href="${item.href}" class="nav-link${item.key === active ? ' active' : ''}">${item.label}</a>`
  ).join('');

  const flashHtml = flash ? `<div class="flash flash-${flash.type}">${escapeHtml(flash.text)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} - Goodreads Sync</title>
<script src="https://unpkg.com/htmx.org@1.9.12" defer></script>
<style>${CSS}</style>
</head>
<body hx-boost="true">
<header>
  <div class="brand">Goodreads Sync</div>
  <nav>${nav}</nav>
</header>
<main>
${flashHtml}
${body}
</main>
</body>
</html>`;
}

const CSS = `
:root {
  --bg: #f7f7f5; --card: #ffffff; --border: #e5e5e2; --text: #1a1a1a; --muted: #6b7280;
  --accent: #3a6b52; --accent-light: #e8f0ec; --danger: #b3261e; --danger-light: #fbe9e7;
  --warn: #92600a; --warn-light: #fdf1dc;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: var(--card); border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 12px; }
.brand { font-weight: 600; font-size: 1.1rem; }
nav { display: flex; gap: 4px; flex-wrap: wrap; }
.nav-link { padding: 6px 12px; border-radius: 6px; text-decoration: none; color: var(--muted); font-size: 0.9rem; }
.nav-link:hover { background: var(--accent-light); color: var(--text); }
.nav-link.active { background: var(--accent); color: white; }
main { max-width: 960px; margin: 0 auto; padding: 24px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
h1 { font-size: 1.3rem; margin: 0 0 16px; }
h2 { font-size: 1.05rem; margin: 0 0 12px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.stat .value { font-size: 1.8rem; font-weight: 700; }
.stat .label { color: var(--muted); font-size: 0.85rem; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 0.9rem; vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
.badge-downloaded { background: var(--accent-light); color: var(--accent); }
.badge-pending { background: var(--warn-light); color: var(--warn); }
.badge-not_found { background: var(--danger-light); color: var(--danger); }
.badge-manual { background: #eef2ff; color: #4338ca; }
.badge-goodreads { background: #f0f0ee; color: var(--muted); }
form.inline { display: inline; }
button, .btn { font: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--card); border-radius: 6px; padding: 6px 12px; color: var(--text); text-decoration: none; display: inline-block; }
button:hover, .btn:hover { background: var(--accent-light); border-color: var(--accent); }
button.danger:hover { background: var(--danger-light); border-color: var(--danger); color: var(--danger); }
button.primary { background: var(--accent); color: white; border-color: var(--accent); }
button.primary:hover { opacity: 0.9; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.flash { padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
.flash-success { background: var(--accent-light); color: var(--accent); }
.flash-error { background: var(--danger-light); color: var(--danger); }
.muted { color: var(--muted); }
small.muted { display: block; }
input, select { font: inherit; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; width: 100%; }
input[type="checkbox"] { width: auto; padding: 0; }
.books-table th:first-child, .books-table td:first-child { width: 32px; }
.users-table td { vertical-align: middle; }
label { display: block; font-size: 0.85rem; margin-bottom: 4px; color: var(--muted); }
.field { margin-bottom: 14px; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; align-items: end; }
.filters { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.filters a { padding: 6px 12px; border-radius: 6px; text-decoration: none; color: var(--muted); border: 1px solid var(--border); font-size: 0.85rem; }
.filters a.active { background: var(--accent); color: white; border-color: var(--accent); }
.pagination { display: flex; gap: 8px; margin-top: 16px; align-items: center; }
.empty { color: var(--muted); padding: 24px 0; text-align: center; }
.row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
`;
