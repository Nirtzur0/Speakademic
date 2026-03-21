import * as pdfjsLib from '../lib/pdf.mjs';
import { detectColumns } from './column-detector.js';
import {
  cleanAllPages,
  cleanSpecialContent,
} from './text-cleaner.js';
import {
  detectSections,
  buildSectionMap,
  findReferencesStart,
} from './section-detector.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '';

class PdfError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
    this.cause = cause;
  }
}

async function extractText(pdfUrl) {
  console.log('[PDF] Extracting text from:', pdfUrl);

  let pdfBytes;
  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) {
      throw new PdfError(
        'fetch_failed',
        `Failed to fetch PDF: ${res.status}`
      );
    }
    pdfBytes = await res.arrayBuffer();
  } catch (err) {
    if (err instanceof PdfError) throw err;
    throw new PdfError(
      'fetch_failed',
      `Cannot fetch PDF: ${err.message}`,
      err
    );
  }

  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  } catch (err) {
    throw new PdfError(
      'parse_failed',
      `Cannot parse PDF: ${err.message}`,
      err
    );
  }

  console.log(`[PDF] ${doc.numPages} pages found`);

  const rawPages = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();

    const items = content.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
        fontName: item.fontName,
      }));

    const ordered = detectColumns(items, viewport.width);

    rawPages.push({
      pageNum: i,
      items: ordered,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
  }

  const cleanedPages = cleanAllPages(rawPages);

  const sections = detectSections(cleanedPages);
  const sectionMap = buildSectionMap(sections);
  const referencesStart = findReferencesStart(sections);

  const textParts = [];
  let globalItemIndex = 0;

  for (const page of cleanedPages) {
    const pageTexts = [];

    for (const item of page.items) {
      if (
        referencesStart !== null
        && globalItemIndex >= referencesStart
      ) {
        break;
      }
      pageTexts.push(item.text);
      globalItemIndex++;
    }

    if (
      referencesStart !== null
      && globalItemIndex >= referencesStart
    ) {
      const text = pageTexts.join(' ').trim();
      if (text) textParts.push(text);
      break;
    }

    const pageText = pageTexts.join(' ').trim();
    if (pageText) textParts.push(pageText);
  }

  let fullText = textParts.join('\n\n');
  fullText = cleanSpecialContent(fullText);

  console.log(
    `[PDF] Extracted ${fullText.length} chars from`
    + ` ${cleanedPages.length} pages`
    + ` (${sectionMap.length} sections detected)`
  );

  return {
    pages: cleanedPages,
    fullText,
    sections: sectionMap,
  };
}

export { extractText, PdfError };
