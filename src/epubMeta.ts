import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

export interface BookMeta {
  title: string | null;
  author: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/** dc:creator (and similar Dublin Core fields) can be a plain string, an
 * object with a #text node (when it has attributes like opf:role), or an
 * array of either when there are multiple authors -- normalize to the
 * first author's plain text name. */
function firstText(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return firstText(value[0]);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return firstText((value as Record<string, unknown>)['#text']);
  }
  return null;
}

/**
 * Reads the real title/author out of an EPUB's own metadata (it's just a
 * zip file containing an OPF package document with Dublin Core fields),
 * rather than guessing from the filename. Returns null if the file isn't a
 * readable EPUB or doesn't have the expected structure.
 */
export function extractEpubMetadata(filePath: string): BookMeta | null {
  try {
    const zip = new AdmZip(filePath);

    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) return null;
    const container = xmlParser.parse(containerEntry.getData().toString('utf-8'));

    let rootfile = container?.container?.rootfiles?.rootfile;
    if (Array.isArray(rootfile)) rootfile = rootfile[0];
    const opfPath: string | undefined = rootfile?.['@_full-path'];
    if (!opfPath) return null;

    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) return null;
    const opf = xmlParser.parse(opfEntry.getData().toString('utf-8'));

    const metadata = opf?.package?.metadata;
    if (!metadata) return null;

    const title = firstText(metadata['dc:title']);
    const author = firstText(metadata['dc:creator']);

    if (!title && !author) return null;
    return { title, author };
  } catch {
    return null;
  }
}

/**
 * Best-effort fallback for files we can't (or don't try to) read real
 * metadata from: our own naming convention is "Author - Title.ext", so
 * split on the first " - " if present; otherwise the whole stem becomes
 * the title with no known author.
 */
export function guessMetadataFromFilename(filename: string): BookMeta {
  const stem = filename.replace(/\.[^./]+$/, '');
  const sepIndex = stem.indexOf(' - ');
  if (sepIndex > 0) {
    return {
      author: stem.slice(0, sepIndex).trim() || null,
      title: stem.slice(sepIndex + 3).trim() || null,
    };
  }
  return { title: stem.trim() || null, author: null };
}
