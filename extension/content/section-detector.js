const HEADING_PATTERNS = [
  /^\d+\.?\s+\w/,
  /^[IVXLC]+\.?\s+\w/,
  /^[A-Z]\.\s+\w/,
];

const REFERENCES_PATTERNS = [
  /^references$/i,
  /^bibliography$/i,
  /^works\s+cited$/i,
  /^literature\s+cited$/i,
];

const ABSTRACT_PATTERNS = [
  /^abstract$/i,
  /^summary$/i,
];

function detectSections(pages, bodyFontSize) {
  if (!bodyFontSize) {
    bodyFontSize = estimateBodyFontSize(pages);
  }

  const sections = [];
  let globalItemIndex = 0;

  for (const page of pages) {
    for (const item of page.items) {
      const fontSize = item.height;

      if (isHeading(item, fontSize, bodyFontSize)) {
        const title = item.text.trim();
        const section = {
          title,
          pageNum: page.pageNum,
          itemIndex: globalItemIndex,
          isReferences: REFERENCES_PATTERNS.some(
            (p) => p.test(title)
          ),
          isAbstract: ABSTRACT_PATTERNS.some(
            (p) => p.test(title)
          ),
        };
        sections.push(section);
      }

      globalItemIndex++;
    }
  }

  return sections;
}

function estimateBodyFontSize(pages) {
  const fontSizes = new Map();

  for (const page of pages) {
    for (const item of page.items) {
      const size = Math.round(item.height * 10) / 10;
      const charCount = item.text.length;
      fontSizes.set(
        size,
        (fontSizes.get(size) || 0) + charCount
      );
    }
  }

  let maxChars = 0;
  let bodySize = 10;

  for (const [size, chars] of fontSizes) {
    if (chars > maxChars) {
      maxChars = chars;
      bodySize = size;
    }
  }

  return bodySize;
}

function isHeading(item, fontSize, bodyFontSize) {
  const sizeRatio = fontSize / bodyFontSize;
  if (sizeRatio < 1.15) return false;

  const text = item.text.trim();
  if (text.length < 2 || text.length > 100) return false;

  if (/^\d+$/.test(text)) return false;

  if (sizeRatio >= 1.3) return true;

  if (HEADING_PATTERNS.some((p) => p.test(text))) return true;

  const words = text.split(/\s+/);
  if (words.length <= 8 && /^[A-Z]/.test(text)) return true;

  return false;
}

function buildSectionMap(sections, totalChunks) {
  return sections.map((section, i) => ({
    ...section,
    endItemIndex: i + 1 < sections.length
      ? sections[i + 1].itemIndex - 1
      : null,
  }));
}

function findReferencesStart(sections) {
  for (const section of sections) {
    if (section.isReferences) return section.itemIndex;
  }
  return null;
}

function findAbstract(sections) {
  for (const section of sections) {
    if (section.isAbstract) return section;
  }
  return null;
}

export {
  detectSections,
  buildSectionMap,
  estimateBodyFontSize,
  findReferencesStart,
  findAbstract,
};
