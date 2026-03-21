const MARGIN_RATIO = 0.08;
const PAGE_NUMBER_PATTERNS = [
  /^\d+$/,
  /^page\s+\d+$/i,
  /^\d+\s+of\s+\d+$/i,
  /^-\s*\d+\s*-$/,
];

const MATH_FONT_PATTERNS = [
  /math/i, /symbol/i,
  /^CM/i, /CMSY/i, /CMMI/i, /CMEX/i, /CMR/i,
  /MSAM/i, /MSBM/i,
  /EUSM/i, /EURM/i,
  /STIX.*Math/i,
];

const LATEX_REMNANT_PATTERN =
  /\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|sum|prod|int|infty|partial|nabla|sqrt|frac|cdot|times|leq|geq|neq|approx|equiv|subset|supset|forall|exists|rightarrow|leftarrow|Rightarrow|Leftarrow|lim|max|min|sup|inf|log|ln|exp|sin|cos|tan)\b/;

const LATEX_SYNTAX_PATTERN = /[_^]\{[^}]*\}|\\\[|\\\]|\$\$/;

const URL_PATTERN =
  /https?:\/\/[^\s]{40,}/g;

function stripHeadersFooters(pages) {
  if (pages.length < 3) return pages;

  const topTexts = new Map();
  const bottomTexts = new Map();

  for (const page of pages) {
    if (page.items.length === 0) continue;

    const pageHeight = getPageHeight(page.items);
    const topThreshold = pageHeight * (1 - MARGIN_RATIO);
    const bottomThreshold = pageHeight * MARGIN_RATIO;

    for (const item of page.items) {
      if (item.y > topThreshold) {
        const key = normalizeMarginText(item.text);
        topTexts.set(key, (topTexts.get(key) || 0) + 1);
      }
      if (item.y < bottomThreshold) {
        const key = normalizeMarginText(item.text);
        bottomTexts.set(key, (bottomTexts.get(key) || 0) + 1);
      }
    }
  }

  const repeatedTop = new Set();
  const repeatedBottom = new Set();
  const threshold = Math.max(2, Math.floor(pages.length * 0.3));

  for (const [text, count] of topTexts) {
    if (count >= threshold) repeatedTop.add(text);
  }
  for (const [text, count] of bottomTexts) {
    if (count >= threshold) repeatedBottom.add(text);
  }

  return pages.map((page) => {
    if (page.items.length === 0) return page;

    const pageHeight = getPageHeight(page.items);
    const topThreshold = pageHeight * (1 - MARGIN_RATIO);
    const bottomThreshold = pageHeight * MARGIN_RATIO;

    const filtered = page.items.filter((item) => {
      const key = normalizeMarginText(item.text);

      if (item.y > topThreshold && repeatedTop.has(key)) {
        return false;
      }

      if (item.y < bottomThreshold) {
        if (repeatedBottom.has(key)) return false;
        if (isPageNumber(item.text)) return false;
      }

      return true;
    });

    return { ...page, items: filtered };
  });
}

function getPageHeight(items) {
  let maxY = 0;
  for (const item of items) {
    if (item.y > maxY) maxY = item.y;
  }
  return maxY + 50;
}

function normalizeMarginText(text) {
  return text.replace(/\d+/g, 'N').trim().toLowerCase();
}

function isPageNumber(text) {
  const trimmed = text.trim();
  return PAGE_NUMBER_PATTERNS.some((p) => p.test(trimmed));
}

function isMathFont(fontName) {
  return MATH_FONT_PATTERNS.some((p) => p.test(fontName));
}

function cleanEquations(items) {
  const result = [];
  let inMathRun = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (isMathFont(item.fontName)) {
      if (!inMathRun) {
        inMathRun = true;
        result.push({
          ...item,
          text: ' [equation] ',
          _isMathReplacement: true,
        });
      }
      continue;
    }

    inMathRun = false;

    let cleaned = item.text;

    if (
      LATEX_REMNANT_PATTERN.test(cleaned)
      || LATEX_SYNTAX_PATTERN.test(cleaned)
    ) {
      cleaned = ' [equation] ';
    }

    result.push({ ...item, text: cleaned });
  }

  return result;
}

function cleanSpecialContent(text) {
  let cleaned = text;

  // 1. Normalize PDF ligature codepoints
  cleaned = cleaned
    .replace(/\ufb00/g, 'ff')
    .replace(/\ufb01/g, 'fi')
    .replace(/\ufb02/g, 'fl')
    .replace(/\ufb03/g, 'ffi')
    .replace(/\ufb04/g, 'ffl');

  // 2. Rejoin words hyphenated across line breaks
  //    "exam- ination" → "examination"
  //    Preserves "well-known" (no space after hyphen)
  cleaned = cleaned.replace(/(\w)-\s+([a-z])/g, '$1$2');

  // 3. Replace long URLs with "link"
  cleaned = cleaned.replace(URL_PATTERN, 'link');

  // 4. Deduplicate equation markers
  cleaned = cleaned.replace(
    /\[equation\]\s*\[equation\]/g,
    '[equation]'
  );

  // 5. Normalize whitespace characters
  cleaned = cleaned
    .replace(/\t/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\u200C/g, '')
    .replace(/\u200D/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\s{2,}/g, ' ');

  // 6. TTS-friendly symbol replacements
  cleaned = cleaned
    .replace(/(\d)%/g, '$1 percent')
    .replace(/(\d)°\s*C\b/g, '$1 degrees Celsius')
    .replace(/(\d)°\s*F\b/g, '$1 degrees Fahrenheit')
    .replace(/(\d)°/g, '$1 degrees')
    .replace(/±/g, ' plus or minus ')
    .replace(/≈/g, ' approximately ')
    .replace(/≤/g, ' less than or equal to ')
    .replace(/≥/g, ' greater than or equal to ')
    .replace(/→/g, ' leads to ')
    .replace(/←/g, ' from ');

  return cleaned.trim();
}

function cleanPage(page) {
  const equationCleaned = cleanEquations(page.items);
  return { ...page, items: equationCleaned };
}

function cleanAllPages(pages) {
  const stripped = stripHeadersFooters(pages);
  return stripped.map(cleanPage);
}

export {
  cleanAllPages,
  stripHeadersFooters,
  cleanEquations,
  cleanSpecialContent,
  isMathFont,
};
