import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { extractEpubMetadata, guessMetadataFromFilename } from './epubMeta.js';

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function buildFixtureEpub(opf: string): string {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(CONTAINER_XML, 'utf-8'));
  zip.addFile('OEBPS/content.opf', Buffer.from(opf, 'utf-8'));
  const tempPath = path.join(os.tmpdir(), `epubMeta-test-${Date.now()}-${Math.random()}.epub`);
  zip.writeZip(tempPath);
  return tempPath;
}

test('extractEpubMetadata reads title and single creator from a real EPUB structure', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Consider Phlebas</dc:title>
    <dc:creator opf:role="aut" xmlns:opf="http://www.idpf.org/2007/opf">Iain M. Banks</dc:creator>
  </metadata>
</package>`;
  const filePath = buildFixtureEpub(opf);

  const meta = extractEpubMetadata(filePath);
  assert.deepEqual(meta, { title: 'Consider Phlebas', author: 'Iain M. Banks' });

  fs.unlinkSync(filePath);
});

test('extractEpubMetadata takes the first creator when there are multiple', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Good Omens</dc:title>
    <dc:creator>Terry Pratchett</dc:creator>
    <dc:creator>Neil Gaiman</dc:creator>
  </metadata>
</package>`;
  const filePath = buildFixtureEpub(opf);

  const meta = extractEpubMetadata(filePath);
  assert.deepEqual(meta, { title: 'Good Omens', author: 'Terry Pratchett' });

  fs.unlinkSync(filePath);
});

test('extractEpubMetadata returns null for a file that is not a valid EPUB', () => {
  const tempPath = path.join(os.tmpdir(), `not-an-epub-${Date.now()}.epub`);
  fs.writeFileSync(tempPath, 'this is not a zip file');

  const meta = extractEpubMetadata(tempPath);
  assert.equal(meta, null);

  fs.unlinkSync(tempPath);
});

test('guessMetadataFromFilename splits our own "Author - Title.ext" convention', () => {
  const meta = guessMetadataFromFilename('Ursula K. Le Guin - The Dispossessed.epub');
  assert.deepEqual(meta, { author: 'Ursula K. Le Guin', title: 'The Dispossessed' });
});

test('guessMetadataFromFilename falls back to the whole stem as title when there is no separator', () => {
  const meta = guessMetadataFromFilename('The Dispossessed.epub');
  assert.deepEqual(meta, { title: 'The Dispossessed', author: null });
});
