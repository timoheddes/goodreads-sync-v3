import { escapeHtml, formatDate } from './html.js';
import type { DashboardStats, BookStatusFilter } from '../db/repo.js';
import type { books, users } from '../db/schema.js';
import type { SettingsValues } from '../settings.js';

type Book = typeof books.$inferSelect;
type User = typeof users.$inferSelect;

// ---- home ----

export function renderHome(stats: DashboardStats, cycleRunning: boolean): string {
  const statCard = (value: number, label: string) => `
    <div class="stat">
      <div class="value">${value}</div>
      <div class="label">${label}</div>
    </div>`;

  return `
<h1>Overview</h1>
<div class="stats-grid">
  ${statCard(stats.totalUsers, 'Users')}
  ${statCard(stats.downloaded, 'Downloaded')}
  ${statCard(stats.pending, 'Pending')}
  ${statCard(stats.notFound, 'Still searching')}
  ${statCard(stats.eligibleNow, 'Eligible right now')}
  ${statCard(stats.downloadsToday, 'Downloaded today')}
</div>

<div class="card">
  <h2>Manual actions</h2>
  <p class="muted" style="margin-top:0;">
    ${
      cycleRunning
        ? 'A sync cycle is currently running.'
        : 'Normally these run on a schedule -- use these to trigger one right now.'
    }
  </p>
  <div class="actions">
    <form method="POST" action="/trigger/sync">
      <button class="primary" type="submit" ${cycleRunning ? 'disabled' : ''}>Run sync now</button>
    </form>
    <form method="POST" action="/trigger/folder-scan">
      <button type="submit">Scan folders now</button>
    </form>
    <form method="POST" action="/trigger/digest">
      <button type="submit">Send digest now</button>
    </form>
  </div>
</div>`;
}

// ---- users ----

export function renderUsers(userList: User[]): string {
  const rows = userList
    .map(
      (u) => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td class="muted">${escapeHtml(u.goodreadsId)}</td>
      <td class="muted">${escapeHtml(u.downloadPath)}</td>
      <td class="muted">${u.email ? escapeHtml(u.email) : '—'}</td>
      <td>
        <form class="inline" method="POST" action="/users/${u.id}/delete" hx-confirm="Remove ${escapeHtml(u.name)}? Their books stay in the library.">
          <button class="danger" type="submit">Remove</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const table =
    userList.length > 0
      ? `<table>
      <thead><tr><th>Name</th><th>Goodreads ID</th><th>Download path</th><th>Email</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
      : `<div class="empty">No users yet -- add one below.</div>`;

  return `
<h1>Users</h1>
<div class="card">${table}</div>

<div class="card">
  <h2>Add a user</h2>
  <form method="POST" action="/users">
    <div class="form-grid">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" name="name" required placeholder="Alice" />
      </div>
      <div class="field">
        <label for="goodreadsId">Goodreads ID</label>
        <input id="goodreadsId" name="goodreadsId" required placeholder="104614681" />
      </div>
      <div class="field">
        <label for="downloadPath">Download path</label>
        <input id="downloadPath" name="downloadPath" required placeholder="/downloads/Alice" />
      </div>
      <div class="field">
        <label for="email">Email (optional, for the daily digest)</label>
        <input id="email" name="email" type="email" placeholder="alice@example.com" />
      </div>
      <div class="field">
        <button class="primary" type="submit">Add user</button>
      </div>
    </div>
  </form>
  <p class="muted" style="margin-bottom:0;">
    Find your Goodreads ID in your profile URL: goodreads.com/user/show/<strong>104614681</strong>-yourname.
    Make sure your "to-read" shelf is public.
  </p>
</div>`;
}

// ---- books ----

const STATUS_LABELS: Record<BookStatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  downloaded: 'Downloaded',
  not_found: 'Still searching',
};

function statusBadge(status: Book['status']): string {
  const label = status === 'not_found' ? 'still searching' : status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

function sourceBadge(source: Book['source']): string {
  return `<span class="badge badge-${source}">${source}</span>`;
}

export interface RenderBooksOptions {
  books: Book[];
  usersByBookId: Map<number, string[]>;
  status: BookStatusFilter;
  page: number;
  totalPages: number;
  total: number;
}

export function renderBooks(opts: RenderBooksOptions): string {
  const filters = (Object.keys(STATUS_LABELS) as BookStatusFilter[])
    .map(
      (s) =>
        `<a href="/books?status=${s}" class="${s === opts.status ? 'active' : ''}">${STATUS_LABELS[s]}</a>`
    )
    .join('');

  // Every action button lives inside one shared form and points at its own
  // endpoint via `formaction` (a plain HTML feature -- the browser submits
  // to whichever button was clicked, no JS required). That's what lets a
  // single checked-checkbox set feed both the per-row Retry/Remove buttons
  // and the bulk Retry/Delete-selected buttons without nesting <form>s.
  const rows = opts.books
    .map((b) => {
      const owners = opts.usersByBookId.get(b.id) ?? [];
      const retryButton =
        b.status !== 'pending' ? `<button type="submit" formaction="/books/${b.id}/retry">Retry</button>` : '';
      return `
    <tr>
      <td><input type="checkbox" name="bookIds" value="${b.id}" /></td>
      <td>
        <div>${escapeHtml(b.title || 'Untitled')}</div>
        <small class="muted">${escapeHtml(b.author || 'Unknown author')}</small>
        ${b.lastError ? `<div class="error-text">${escapeHtml(b.lastError)}</div>` : ''}
      </td>
      <td>${statusBadge(b.status)} ${sourceBadge(b.source)}</td>
      <td class="muted">${owners.length > 0 ? owners.map(escapeHtml).join(', ') : '—'}</td>
      <td class="muted">${b.attempts}</td>
      <td class="muted">${formatDate(b.updatedAt)}</td>
      <td>
        <div class="row-actions">
          ${retryButton}
          <button class="danger" type="submit" formaction="/books/${b.id}/delete" hx-confirm="Remove this book from the library entirely?">Remove</button>
        </div>
      </td>
    </tr>`;
    })
    .join('');

  const table =
    opts.books.length > 0
      ? `<table class="books-table">
      <thead><tr><th><input type="checkbox" id="select-all" title="Select all" /></th><th>Book</th><th>Status</th><th>Users</th><th>Attempts</th><th>Updated</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
      : `<div class="empty">No books in this view.</div>`;

  const pagination =
    opts.totalPages > 1
      ? `<div class="pagination">
      ${opts.page > 1 ? `<a class="btn" href="/books?status=${opts.status}&page=${opts.page - 1}">&larr; Prev</a>` : ''}
      <span class="muted">Page ${opts.page} of ${opts.totalPages} (${opts.total} total)</span>
      ${opts.page < opts.totalPages ? `<a class="btn" href="/books?status=${opts.status}&page=${opts.page + 1}">Next &rarr;</a>` : ''}
    </div>`
      : '';

  const requeueAllForm =
    opts.status === 'downloaded' && opts.total > 0
      ? `<form method="POST" action="/books/requeue-all" hx-confirm="Reset all ${opts.total} downloaded books back to pending? This does not delete the files.">
           <button type="submit">Re-queue all downloaded</button>
         </form>`
      : '';

  const bulkBar =
    opts.books.length > 0
      ? `<div class="actions">
      <button type="submit" formaction="/books/bulk/retry">Retry selected</button>
      <button class="danger" type="submit" formaction="/books/bulk/delete" hx-confirm="Remove all selected books from the library entirely?">Delete selected</button>
      <span id="selected-count" class="muted"></span>
    </div>`
      : '';

  return `
<h1>Books</h1>
<div class="filters">${filters}</div>
${requeueAllForm ? `<div class="actions">${requeueAllForm}</div>` : ''}
<div class="card">
  <form method="POST" id="books-form" hx-boost="false">
    <input type="hidden" name="status" value="${opts.status}" />
    <input type="hidden" name="page" value="${opts.page}" />
    ${bulkBar}
    ${table}
    ${pagination}
  </form>
</div>
<script>
(function () {
  var form = document.getElementById('books-form');
  if (!form) return;
  var selectAll = document.getElementById('select-all');
  var countEl = document.getElementById('selected-count');
  function checkboxes() { return form.querySelectorAll('input[name="bookIds"]'); }
  function updateCount() {
    if (!countEl) return;
    var checked = Array.prototype.filter.call(checkboxes(), function (cb) { return cb.checked; }).length;
    countEl.textContent = checked > 0 ? checked + ' selected' : '';
  }
  if (selectAll) {
    selectAll.addEventListener('change', function () {
      Array.prototype.forEach.call(checkboxes(), function (cb) { cb.checked = selectAll.checked; });
      updateCount();
    });
  }
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'bookIds') updateCount();
  });
})();
</script>`;
}

// ---- settings ----

export function renderSettings(settings: SettingsValues): string {
  return `
<h1>Settings</h1>
<div class="card">
  <form method="POST" action="/settings">
    <div class="form-grid">
      <div class="field">
        <label for="maxDownloadsPerDay">Max downloads per day (all users)</label>
        <input id="maxDownloadsPerDay" name="maxDownloadsPerDay" type="number" min="1" value="${settings.maxDownloadsPerDay}" required />
      </div>
      <div class="field">
        <label for="maxDownloadsPerUserPerDay">Max downloads per user per day</label>
        <input id="maxDownloadsPerUserPerDay" name="maxDownloadsPerUserPerDay" type="number" min="1" value="${settings.maxDownloadsPerUserPerDay}" required />
      </div>
      <div class="field">
        <label for="queueCooldownMs">Delay between downloads (ms)</label>
        <input id="queueCooldownMs" name="queueCooldownMs" type="number" min="0" value="${settings.queueCooldownMs}" required />
      </div>
      <div class="field">
        <button class="primary" type="submit">Save settings</button>
      </div>
    </div>
  </form>
  <p class="muted" style="margin-bottom:0;">
    Cron schedules (sync interval, folder scan time, digest time) are set via environment
    variables (<code>SYNC_CRON</code>, <code>FOLDER_SCAN_CRON</code>, <code>DIGEST_CRON</code>)
    since changing them takes effect on container restart -- see the README.
  </p>
</div>`;
}
