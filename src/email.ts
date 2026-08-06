import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

export interface DigestBookRef {
  title: string | null;
  author: string | null;
}

export interface DigestContent {
  found: DigestBookRef[];
  stillSearching: DigestBookRef[];
}

// Cap how many titles get listed per section -- a user with a huge backlog
// shouldn't get a digest that's thousands of lines long. The counts in the
// subject/heading are always the true totals regardless of this cap.
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
  if (b.title && b.author) return `${b.title} - ${b.author}`;
  return b.title || b.author || 'Untitled';
}

function formatSection(heading: string, books: DigestBookRef[]): string {
  const lines = [`${heading} (${books.length}):`];
  for (const b of books.slice(0, MAX_LISTED_PER_SECTION)) {
    lines.push(`  - ${formatBook(b)}`);
  }
  const remaining = books.length - MAX_LISTED_PER_SECTION;
  if (remaining > 0) lines.push(`  ...and ${remaining} more`);
  return lines.join('\n');
}

export function buildDigestSubject(content: DigestContent): string {
  const parts: string[] = [];
  if (content.found.length > 0) parts.push(`${content.found.length} found`);
  if (content.stillSearching.length > 0) parts.push(`${content.stillSearching.length} still searching`);
  return `Goodreads Sync: ${parts.join(', ')}`;
}

export function buildDigestBody(userName: string, content: DigestContent): string {
  const sections: string[] = [];
  if (content.found.length > 0) sections.push(formatSection('Found', content.found));
  if (content.stillSearching.length > 0) {
    sections.push(formatSection('Still searching, will keep retrying', content.stillSearching));
  }
  return `Hi ${userName},\n\n${sections.join('\n\n')}\n`;
}

export async function sendDigestEmail(to: string, userName: string, content: DigestContent): Promise<void> {
  await getTransporter().sendMail({
    from: config.smtpFrom,
    to,
    subject: buildDigestSubject(content),
    text: buildDigestBody(userName, content),
  });
}
