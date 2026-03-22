import * as pdfjsLib from '../lib/pdf.mjs';
import { detectColumns } from './column-detector.js';
import {
  cleanAllPages,
  cleanSpecialContent,
} from './text-cleaner.js';
import {
  detectSections,
  buildSectionMap,
  estimateBodyFontSize,
  findReferencesStart,
  findAbstract,
} from './section-detector.js';
import {
  annotateSectionHierarchy,
} from '../utils/section-outline.js';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  chrome.runtime.getURL('lib/pdf.worker.mjs');

class PdfError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
    this.cause = cause;
  }
}

// Email pattern for front-matter detection
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+/;
// Common affiliation indicators
const AFFILIATION_PATTERNS = [
  /\buniversity\b/i, /\binstitute\b/i, /\bdepartment\b/i,
  /\bcollege\b/i, /\blaborator/i, /\bschool of\b/i,
  /\bresearch\b/i, /\bcorporation\b/i, /\binc\./i,
  /\bgoogle\b/i, /\bmicrosoft\b/i, /\bmeta\b/i,
  /\bopenai\b/i, /\bdeepmind\b/i, /\bamazon\b/i,
];
// Superscript markers often used for author footnotes: *, †, ‡, §, ¶, 1, 2
const AUTHOR_MARKER_PATTERN = /^[*†‡§¶∗⋆\d,\s]+$/;

// ---- Figure / caption detection at item level ----
// Figure/table labels that start a caption
const FIGURE_LABEL_RE =
  /^(?:figure|fig\.|table|tab\.)\s*\d+/i;
// arxiv watermark
const ARXIV_WATERMARK_RE =
  /^arXiv:\s*\d{4}\.\d{4,5}/i;

/**
 * Detect if an item is likely a figure caption or label.
 * Uses font-size heuristic: captions are typically smaller than body text,
 * and appear near figures (which are detected by vertical gaps).
 */
function isCaptionItem(item, bodyFontSize) {
  const text = item.text.trim();

  // Obvious figure/table labels
  if (FIGURE_LABEL_RE.test(text)) return true;

  // arxiv watermark
  if (ARXIV_WATERMARK_RE.test(text)) return true;

  return false;
}

/**
 * Detect items that are visually isolated from body text —
 * likely figure labels, axis labels, or annotations inside figures.
 * We detect "figure zones" by looking for large vertical gaps
 * between text items on a page.
 */
function detectFigureZoneItems(pages, bodyFontSize) {
  const figureItems = new Set();

  for (const page of pages) {
    const items = page.items;
    if (items.length < 3) continue;

    // Sort items by Y position (top of page = highest Y in PDF coords)
    const sorted = items.slice().sort((a, b) => b.y - a.y);

    // Find large gaps that indicate figure regions
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i].y - sorted[i + 1].y;
      const normalGap = bodyFontSize * 2;

      // A gap > 4x the normal line spacing suggests a figure
      if (gap > normalGap * 4) {
        // Items just below a big gap are likely captions
        // Check the next few items
        for (let j = i + 1; j < Math.min(i + 4, sorted.length); j++) {
          const candidate = sorted[j];
          const text = candidate.text.trim();
          // Small font items near the gap are likely captions/labels
          if (candidate.height < bodyFontSize * 0.95
            && text.length < 120) {
            figureItems.add(candidate);
          }
          if (FIGURE_LABEL_RE.test(text)) {
            figureItems.add(candidate);
          }
        }
      }
    }

    // Also catch isolated small-font short items that look like
    // figure annotations (axis labels, legend text, etc.)
    for (const item of items) {
      const text = item.text.trim();
      if (item.height < bodyFontSize * 0.8
        && text.length < 30
        && text.length > 0) {
        // Very small font + very short = likely figure annotation
        figureItems.add(item);
      }
    }
  }

  return figureItems;
}

/**
 * Find the global item index where front matter ends and real content begins.
 * Front matter = title + authors + affiliations + emails before abstract or
 * first section. Returns 0 if no front matter is detected.
 */
function detectFrontMatterEnd(pages, sections) {
  if (pages.length === 0 || !pages[0].items.length) return 0;

  // Find the first meaningful section (abstract or first numbered section)
  let firstSectionIndex = null;
  for (const sec of sections) {
    if (sec.isAbstract || sec.pageNum === 1) {
      firstSectionIndex = sec.itemIndex;
      break;
    }
  }

  // If there's an abstract or section on page 1, everything before it
  // on page 1 is front matter
  if (firstSectionIndex !== null && firstSectionIndex > 0) {
    return firstSectionIndex;
  }

  // Fallback heuristic: scan page 1 items for the transition from
  // front-matter (large title, author names, emails, affiliations)
  // to body text (consistent body-size font).
  const page1 = pages[0];
  const items = page1.items;
  if (items.length < 3) return 0;

  // Find the largest font on page 1 (likely the title)
  let maxHeight = 0;
  for (const item of items) {
    if (item.height > maxHeight) maxHeight = item.height;
  }

  // Find the most common font size (body text)
  const sizeMap = new Map();
  for (const item of items) {
    const h = Math.round(item.height * 10) / 10;
    sizeMap.set(h, (sizeMap.get(h) || 0) + item.text.length);
  }
  let bodySize = 0;
  let bodyChars = 0;
  for (const [size, chars] of sizeMap) {
    if (chars > bodyChars) { bodyChars = chars; bodySize = size; }
  }

  // Walk items: skip the title zone, then skip author/affiliation items,
  // stop when we hit consistent body-size text
  let pastTitle = false;
  let frontMatterEnd = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const h = Math.round(item.height * 10) / 10;
    const text = item.text.trim();

    // Skip the title (largest font)
    if (h >= maxHeight * 0.85) {
      pastTitle = true;
      frontMatterEnd = i + 1;
      continue;
    }

    if (!pastTitle) continue;

    // Check if this looks like front-matter content
    const isFrontMatter =
      EMAIL_PATTERN.test(text)
      || AFFILIATION_PATTERNS.some((p) => p.test(text))
      || AUTHOR_MARKER_PATTERN.test(text)
      || (h > bodySize * 1.08 && text.length < 60);

    if (isFrontMatter) {
      frontMatterEnd = i + 1;
      continue;
    }

    // If we see body-size text that's long enough, front matter is over
    if (h <= bodySize * 1.08 && text.length > 30) {
      break;
    }

    // Short items right after title could still be author names
    if (text.length < 50 && i < 20) {
      frontMatterEnd = i + 1;
      continue;
    }

    break;
  }

  return frontMatterEnd;
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
    doc = await pdfjsLib.getDocument({
      data: pdfBytes,
      password: '',
    }).promise;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('password')
      || msg.includes('encrypted')
      || err.name === 'PasswordException') {
      throw new PdfError(
        'password_protected',
        'This PDF is password-protected.'
        + ' Please open an unprotected PDF.',
        err
      );
    }
    throw new PdfError(
      'parse_failed',
      `Cannot parse PDF: ${msg}`,
      err
    );
  }

  console.log(`[PDF] ${doc.numPages} pages found`);

  if (doc.numPages > 500) {
    console.warn(
      `[PDF] Very large PDF (${doc.numPages} pages).`
      + ' Performance may be slow.'
    );
  }

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

  const sections = annotateSectionHierarchy(
    detectSections(cleanedPages)
  );
  const sectionMap = buildSectionMap(sections);
  const referencesStart = findReferencesStart(sections);

  // Estimate body font size for filtering
  const bodyFontSize = estimateBodyFontSize(cleanedPages);

  // Detect front matter (authors, affiliations, emails) on page 1.
  // Everything before the abstract or first real section is skipped.
  const frontMatterEnd = detectFrontMatterEnd(cleanedPages, sections);

  // Detect items that are inside figure zones (captions, labels, etc.)
  const figureZoneItems = detectFigureZoneItems(
    cleanedPages, bodyFontSize
  );

  console.log(
    `[PDF] bodyFontSize=${bodyFontSize.toFixed(1)}`
    + ` frontMatterEnd=${frontMatterEnd}`
    + ` figureZoneItems=${figureZoneItems.size}`
  );

  const textParts = [];
  const sectionCharOffsets = [];
  let globalItemIndex = 0;
  let charPos = 0;
  let sectionPtr = 0;
  let isFirstPage = true;

  for (const page of cleanedPages) {
    const pageTexts = [];

    for (const item of page.items) {
      if (
        referencesStart !== null
        && globalItemIndex >= referencesStart
      ) {
        break;
      }

      // Skip front matter items (authors, affiliations, emails)
      if (globalItemIndex < frontMatterEnd) {
        globalItemIndex++;
        continue;
      }

      // Skip figure captions and annotations
      if (isCaptionItem(item, bodyFontSize)
        || figureZoneItems.has(item)) {
        globalItemIndex++;
        continue;
      }

      while (
        sectionPtr < sectionMap.length
        && sectionMap[sectionPtr].itemIndex <= globalItemIndex
      ) {
        sectionCharOffsets.push(charPos);
        sectionPtr++;
      }

      pageTexts.push(item.text);
      globalItemIndex++;
    }

    if (
      referencesStart !== null
      && globalItemIndex >= referencesStart
    ) {
      const text = pageTexts.join(' ').trim();
      if (text) {
        textParts.push(text);
        charPos += text.length;
      }
      break;
    }

    const pageText = pageTexts.join(' ').trim();
    if (pageText) {
      if (!isFirstPage) charPos += 2;
      textParts.push(pageText);
      charPos += pageText.length;
      isFirstPage = false;
    }
  }

  let fullText = textParts.join('\n\n');
  fullText = cleanSpecialContent(fullText);

  const avgCharsPerPage = doc.numPages > 0
    ? fullText.length / doc.numPages : 0;

  if (fullText.length > 0 && avgCharsPerPage < 100) {
    console.warn(
      `[PDF] Low text density: ${avgCharsPerPage.toFixed(0)}`
      + ' chars/page. Possibly scanned.'
    );
  }

  console.log(
    `[PDF] Extracted ${fullText.length} chars from`
    + ` ${cleanedPages.length} pages`
    + ` (${sectionMap.length} sections detected)`
  );

  return {
    pages: cleanedPages,
    fullText,
    sections: sectionMap,
    sectionCharOffsets,
    meta: {
      numPages: doc.numPages,
      avgCharsPerPage: Math.round(avgCharsPerPage),
      isLikelyScanned: avgCharsPerPage < 100
        && doc.numPages > 1,
    },
  };
}

export { extractText, PdfError };
