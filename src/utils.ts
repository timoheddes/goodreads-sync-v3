export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collapses any run of whitespace (including a literal double space) down
 * to a single space and trims the ends. Goodreads' RSS feed sometimes
 * sends an author_name with a double space in it (e.g. "Thomas  Harris"
 * -- confirmed via a real stuck book, where that double space survived
 * unnoticed all the way into the Anna's Archive search query as a raw
 * "%20%20", and every single attempt came back with the search results
 * container missing entirely rather than a normal empty/no-match result.
 * Used wherever text from an external, not-fully-trustworthy source
 * (RSS feed fields, in particular) needs to be safe to drop straight into
 * a URL query string.
 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}
