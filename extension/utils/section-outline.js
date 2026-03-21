const DECIMAL_PREFIX_PATTERN =
  /^(\d+(?:\.\d+)*)(?:[.)])?(?:\s+|$)/;
const ROMAN_PREFIX_PATTERN =
  /^([IVXLCM]+)(?:[.)])(?:\s+|$)/;
const LETTER_PREFIX_PATTERN =
  /^([A-Z])(?:[.)])(?:\s+|$)/;
const MAX_OUTLINE_LEVEL = 3;

function normalizeFontSize(fontSize) {
  if (!Number.isFinite(fontSize)) {
    return null;
  }
  return Math.round(fontSize * 10) / 10;
}

function getLevelFromTitle(title) {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return null;
  }

  const decimalMatch = trimmedTitle.match(DECIMAL_PREFIX_PATTERN);
  if (decimalMatch) {
    const segments = decimalMatch[1]
      .split('.')
      .filter(Boolean);
    return Math.max(0, segments.length - 1);
  }

  if (ROMAN_PREFIX_PATTERN.test(trimmedTitle)) {
    return 0;
  }

  if (LETTER_PREFIX_PATTERN.test(trimmedTitle)) {
    return 1;
  }

  return null;
}

function buildFontSizeLevelMap(sections) {
  const normalizedSizes = [];

  for (const section of sections) {
    const fontSize = normalizeFontSize(section?.fontSize);
    if (fontSize === null || normalizedSizes.includes(fontSize)) {
      continue;
    }
    normalizedSizes.push(fontSize);
  }

  normalizedSizes.sort((left, right) => right - left);

  const fontSizeLevelMap = new Map();
  for (let i = 0; i < normalizedSizes.length; i++) {
    fontSizeLevelMap.set(
      normalizedSizes[i],
      Math.min(i, MAX_OUTLINE_LEVEL)
    );
  }

  return fontSizeLevelMap;
}

function clampLevel(level, previousLevel) {
  if (!Number.isInteger(level) || level < 0) {
    return 0;
  }

  if (!Number.isInteger(previousLevel)) {
    return Math.min(level, MAX_OUTLINE_LEVEL);
  }

  return Math.min(
    level,
    previousLevel + 1,
    MAX_OUTLINE_LEVEL
  );
}

function annotateSectionHierarchy(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return [];
  }

  const fontSizeLevelMap = buildFontSizeLevelMap(sections);
  let previousLevel = null;

  return sections.map((section) => {
    const explicitLevel = getLevelFromTitle(section?.title);
    const fallbackLevel = fontSizeLevelMap.get(
      normalizeFontSize(section?.fontSize)
    );
    const outlineLevel = clampLevel(
      explicitLevel ?? fallbackLevel ?? 0,
      previousLevel
    );

    previousLevel = outlineLevel;

    return {
      ...section,
      outlineLevel,
    };
  });
}

export { annotateSectionHierarchy };
