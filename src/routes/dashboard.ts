import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import {
  listUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  getDashboardStats,
  listBooksPage,
  countBooksByStatus,
  getBookById,
  deleteBook,
  deleteBooks,
  requeueBook,
  requeueBooks,
  requeueAllDownloaded,
  getUsersForBook,
  type BookStatusFilter,
} from '../db/repo.js';
import { getAllSettings, setSetting } from '../settings.js';
import { renderLayout, type FlashMessage } from '../web/layout.js';
import { renderHome, renderUsers, renderEditUser, renderBooks, renderSettings } from '../web/pages.js';
import { runCycle, isCycleRunning } from '../cycle.js';
import { scanAllUserFolders } from '../folderScan.js';
import { sendDailyDigests } from '../digest.js';
import { logger } from '../logger.js';

const PAGE_SIZE = 25;
const STATUS_VALUES: BookStatusFilter[] = ['all', 'pending', 'downloaded', 'not_found'];

function parseFlash(query: Record<string, unknown>): FlashMessage | null {
  const msg = typeof query.msg === 'string' ? query.msg : undefined;
  if (!msg) return null;
  return { type: query.type === 'error' ? 'error' : 'success', text: msg };
}

function redirect(reply: FastifyReply, to: string, msg: string, type: 'success' | 'error' = 'success'): void {
  const sep = to.includes('?') ? '&' : '?';
  const params = `msg=${encodeURIComponent(msg)}${type === 'error' ? '&type=error' : ''}`;
  reply.redirect(`${to}${sep}${params}`, 303);
}

/** Books forms carry status/page as hidden fields so actions redirect back to where the user was. */
function booksReturnUrl(body: Record<string, string>): string {
  const status = STATUS_VALUES.includes(body.status as BookStatusFilter) ? body.status : 'all';
  const page = parseInt(body.page, 10) || 1;
  return `/books?status=${status}&page=${page}`;
}

/** Checkbox values come through form-encoded as a single string or an array, depending on how many were checked. */
function parseBookIds(value: string | string[] | undefined): number[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n));
}

interface UserFormValues {
  name: string;
  goodreadsId: string;
  downloadPath: string;
  email: string | null;
}

/** Shared by add-user and edit-user: trims fields, returns null if a required one is missing. */
function parseUserForm(body: Record<string, string>): UserFormValues | null {
  const name = (body.name || '').trim();
  const goodreadsId = (body.goodreadsId || '').trim();
  const downloadPath = (body.downloadPath || '').trim();
  const email = (body.email || '').trim();
  if (!name || !goodreadsId || !downloadPath) return null;
  return { name, goodreadsId, downloadPath, email: email || null };
}

/**
 * Registers the Phase 4 dashboard: server-rendered pages (users, books,
 * settings, manual trigger buttons) using plain forms/links that all work
 * without JS, with htmx layered on top purely for progressive enhancement
 * (see src/web/layout.ts). No auth -- intended for LAN-only access, same
 * as the rest of this app.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  await app.register(formbody);

  // ---- home ----

  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const flash = parseFlash(req.query as Record<string, unknown>);
    const body = renderHome(getDashboardStats(), isCycleRunning());
    reply.type('text/html').send(renderLayout({ title: 'Overview', active: 'home', body, flash }));
  });

  app.post('/trigger/sync', async (_req: FastifyRequest, reply: FastifyReply) => {
    if (isCycleRunning()) {
      redirect(reply, '/', 'A sync is already running.', 'error');
      return;
    }
    void runCycle('dashboard');
    redirect(reply, '/', 'Sync started -- refresh in a bit to see progress.');
  });

  app.post('/trigger/folder-scan', async (_req: FastifyRequest, reply: FastifyReply) => {
    scanAllUserFolders(listUsers());
    redirect(reply, '/', 'Folder scan complete.');
  });

  app.post('/trigger/digest', async (_req: FastifyRequest, reply: FastifyReply) => {
    void sendDailyDigests();
    redirect(reply, '/', 'Digest send started.');
  });

  // ---- users ----

  app.get('/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const flash = parseFlash(req.query as Record<string, unknown>);
    const body = renderUsers(listUsers());
    reply.type('text/html').send(renderLayout({ title: 'Users', active: 'users', body, flash }));
  });

  app.post('/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const values = parseUserForm(req.body as Record<string, string>);
    if (!values) {
      redirect(reply, '/users', 'Name, Goodreads ID, and download path are required.', 'error');
      return;
    }

    try {
      createUser(values);
      redirect(reply, '/users', `Added ${values.name}.`);
    } catch (err) {
      const isUniqueViolation = (err as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE';
      logger.error({ err }, '[Dashboard] Failed to create user');
      redirect(
        reply,
        '/users',
        isUniqueViolation ? 'A user with this Goodreads ID already exists.' : 'Could not add user.',
        'error'
      );
    }
  });

  app.get('/users/:id/edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const user = Number.isNaN(id) ? undefined : getUserById(id);
    if (!user) {
      redirect(reply, '/users', 'User not found.', 'error');
      return;
    }
    const flash = parseFlash(req.query as Record<string, unknown>);
    const body = renderEditUser(user);
    reply.type('text/html').send(renderLayout({ title: 'Edit user', active: 'users', body, flash }));
  });

  app.post('/users/:id/edit', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (Number.isNaN(id) || !getUserById(id)) {
      redirect(reply, '/users', 'User not found.', 'error');
      return;
    }

    const values = parseUserForm(req.body as Record<string, string>);
    if (!values) {
      redirect(reply, `/users/${id}/edit`, 'Name, Goodreads ID, and download path are required.', 'error');
      return;
    }

    try {
      updateUser(id, values);
      redirect(reply, '/users', `Updated ${values.name}.`);
    } catch (err) {
      const isUniqueViolation = (err as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE';
      logger.error({ err }, '[Dashboard] Failed to update user');
      redirect(
        reply,
        `/users/${id}/edit`,
        isUniqueViolation ? 'A user with this Goodreads ID already exists.' : 'Could not save changes.',
        'error'
      );
    }
  });

  app.post('/users/:id/delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isNaN(id)) deleteUser(id);
    redirect(reply, '/users', 'User removed.');
  });

  // ---- books ----

  app.get('/books', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const status: BookStatusFilter = STATUS_VALUES.includes(query.status as BookStatusFilter)
      ? (query.status as BookStatusFilter)
      : 'all';
    const requestedPage = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const total = countBooksByStatus(status);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const bookRows = listBooksPage(status, PAGE_SIZE, (page - 1) * PAGE_SIZE);

    const usersByBookId = new Map<number, string[]>();
    for (const b of bookRows) {
      usersByBookId.set(
        b.id,
        getUsersForBook(b.id).map((u) => u.name)
      );
    }

    const flash = parseFlash(query);
    const body = renderBooks({ books: bookRows, usersByBookId, status, page, totalPages, total });
    reply.type('text/html').send(renderLayout({ title: 'Books', active: 'books', body, flash }));
  });

  app.post('/books/:id/retry', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isNaN(id) && getBookById(id)) requeueBook(id);
    redirect(reply, booksReturnUrl(req.body as Record<string, string>), 'Book re-queued.');
  });

  app.post('/books/:id/delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isNaN(id)) deleteBook(id);
    redirect(reply, booksReturnUrl(req.body as Record<string, string>), 'Book removed.');
  });

  app.post('/books/requeue-all', async (_req: FastifyRequest, reply: FastifyReply) => {
    const count = requeueAllDownloaded();
    redirect(reply, '/books?status=downloaded', `Re-queued ${count} book(s).`);
  });

  app.post('/books/bulk/retry', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string | string[]>;
    const ids = parseBookIds(body.bookIds);
    const returnUrl = booksReturnUrl(body as Record<string, string>);
    if (ids.length === 0) {
      redirect(reply, returnUrl, 'No books selected.', 'error');
      return;
    }
    const count = requeueBooks(ids);
    redirect(reply, returnUrl, `Re-queued ${count} book(s).`);
  });

  app.post('/books/bulk/delete', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string | string[]>;
    const ids = parseBookIds(body.bookIds);
    const returnUrl = booksReturnUrl(body as Record<string, string>);
    if (ids.length === 0) {
      redirect(reply, returnUrl, 'No books selected.', 'error');
      return;
    }
    const count = deleteBooks(ids);
    redirect(reply, returnUrl, `Removed ${count} book(s).`);
  });

  // ---- settings ----

  app.get('/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const flash = parseFlash(req.query as Record<string, unknown>);
    const body = renderSettings(getAllSettings());
    reply.type('text/html').send(renderLayout({ title: 'Settings', active: 'settings', body, flash }));
  });

  app.post('/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const b = req.body as Record<string, string>;
    const maxDownloadsPerDay = parseInt(b.maxDownloadsPerDay, 10);
    const maxDownloadsPerUserPerDay = parseInt(b.maxDownloadsPerUserPerDay, 10);
    const queueCooldownMs = parseInt(b.queueCooldownMs, 10);

    const values = [maxDownloadsPerDay, maxDownloadsPerUserPerDay, queueCooldownMs];
    if (values.some((n) => Number.isNaN(n) || n < 0)) {
      redirect(reply, '/settings', 'Settings must be non-negative numbers.', 'error');
      return;
    }

    setSetting('maxDownloadsPerDay', maxDownloadsPerDay);
    setSetting('maxDownloadsPerUserPerDay', maxDownloadsPerUserPerDay);
    setSetting('queueCooldownMs', queueCooldownMs);
    redirect(reply, '/settings', 'Settings saved.');
  });
}
