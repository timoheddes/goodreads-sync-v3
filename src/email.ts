import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

export interface DigestBookRef {
  title: string | null;
  author: string | null;
}

export interface DigestContent {
  found: DigestBookRef[];
  stillSearching: DigestBookRef[];
  /** Total books currently in this user's library (all time, any source). */
  totalBooks: number;
}

// Cap how many titles get listed per section -- a user with a huge backlog
// shouldn't get a digest that's thousands of lines long. The counts in the
// subject/intro are always the true totals regardless of this cap.
const MAX_LISTED_PER_SECTION = 25;

let transporter: Transporter | null = null;

/**
 * Sends straight to Gmail's SMTP servers, same as v2 used to via its local
 * relay container -- but direct, since there's no reason to run a whole
 * extra container just to forward mail on. Requires a Gmail app password
 * (SMTP_USER/SMTP_PASS), not the account's regular login password.
 */
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });
  }
  return transporter;
}

function formatBook(b: DigestBookRef): string {
  if (b.title && b.author) return `${b.title} by ${b.author}`;
  return b.title || b.author || 'Untitled';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function buildDigestSubject(content: DigestContent): string {
  if (content.found.length > 0) {
    return `${content.found.length} new ${pluralize(content.found.length, 'book')} added to your library`;
  }
  return `Still searching for ${content.stillSearching.length} ${pluralize(content.stillSearching.length, 'book')}`;
}

function introLine(content: DigestContent): string {
  if (content.found.length > 0) {
    return `This is your daily book sync update. We've found ${content.found.length} new books and they have been added to your library. You now have ${content.totalBooks} ${pluralize(content.totalBooks, 'book')}.`;
  }
  return `This is your book sync update. We didn't find any new books today, but you still have ${content.totalBooks} ${pluralize(content.totalBooks, 'book')} available to you.`;
}

// ---- plain-text version (fallback for clients that don't render HTML) ----

export function buildDigestText(userName: string, content: DigestContent): string {
  const lines: string[] = [`Hi ${userName}!`, '', introLine(content)];

  if (content.stillSearching.length > 0) {
    lines.push('', 'Unfortunately, we were unable to find the following books for you:');
    for (const b of content.stillSearching.slice(0, MAX_LISTED_PER_SECTION)) lines.push(`  - ${formatBook(b)}`);
    const remaining = content.stillSearching.length - MAX_LISTED_PER_SECTION;
    if (remaining > 0) lines.push(`  ...and ${remaining} more`);
    lines.push('', "We'll keep trying!");
  }

  if (content.found.length > 0) {
    lines.push('', 'Overview of new books:');
    for (const b of content.found.slice(0, MAX_LISTED_PER_SECTION)) lines.push(`  - ${formatBook(b)}`);
    const remaining = content.found.length - MAX_LISTED_PER_SECTION;
    if (remaining > 0) lines.push(`  ...and ${remaining} more`);
  }

  lines.push('', 'Till next time!', '', 'Timo - GoodReads Sync');
  return lines.join('\n');
}

// ---- HTML version ----

function bookListItemHtml(b: DigestBookRef): string {
  const title = escapeHtml(b.title || 'Untitled');
  const author = b.author
    ? ` <span style="color:#6b7280;">by ${escapeHtml(b.author)}</span>`
    : '';
  return `<li style="margin-bottom:6px;">${title}${author}</li>`;
}

function bookListHtml(books: DigestBookRef[]): string {
  const items = books.slice(0, MAX_LISTED_PER_SECTION).map(bookListItemHtml).join('\n');
  const remaining = books.length - MAX_LISTED_PER_SECTION;
  const moreItem =
    remaining > 0 ? `<li style="color:#6b7280; list-style:none; margin-top:4px;">...and ${remaining} more</li>` : '';
  return `<ul style="padding-left:20px; margin:0 0 16px;">${items}${moreItem}</ul>`;
}

function boldNumbers(html: string): string {
  // Wraps the intro's two counts in <strong> without duplicating the copy
  // logic above -- swap any run of digits for a bolded version.
  return html.replace(/\d+/g, (n) => `<strong>${n}</strong>`);
}

export function buildDigestHtml(userName: string, content: DigestContent): string {
  const stillSearchingSection =
    content.stillSearching.length > 0
      ? `
    <p style="margin:0 0 8px;">Unfortunately, we were unable to find the following books for you:</p>
    ${bookListHtml(content.stillSearching)}
    <p style="margin:0 0 20px;">We'll keep trying!</p>`
      : '';

  const foundSection =
    content.found.length > 0
      ? `
    <p style="margin:0 0 8px;">Overview of new books:</p>
    ${bookListHtml(content.found)}`
      : '';

  return `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1a1a1a; max-width:560px; margin:0 auto; padding:24px; line-height:1.5;">
    <p style="margin:0 0 16px;">Hi ${escapeHtml(userName)}!</p>
    <p style="margin:0 0 20px;">${boldNumbers(escapeHtml(introLine(content)))}</p>
    ${stillSearchingSection}
    ${foundSection}
    <p style="margin:24px 0 0;">Till next time!</p>
    <p style="margin:4px 0 0; color:#6b7280;">Timo - GoodReads Sync</p>
  </body>
</html>`;
}

export async function sendDigestEmail(to: string, userName: string, content: DigestContent): Promise<void> {
  await getTransporter().sendMail({
    from: config.smtpFrom,
    to,
    subject: buildDigestSubject(content),
    text: buildDigestText(userName, content),
    html: buildDigestHtml(userName, content),
  });
}
