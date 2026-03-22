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
const YEAR_PATTERN =
  /(?:19|20)\d{2}[a-z]?/i;
const TRAILING_CITATION_YEAR_PATTERN =
  /(?:19|20)\d{2}[a-z]?(?:,\s*(?:p|pp)\.?\s*\d+(?:\s*[-–]\s*\d+)?)?$/i;
const CITATION_PREFIX_PATTERN =
  /^(?:see(?: also)?|e\.g\.,?|i\.e\.,?|cf\.|compare|contra|but see|for example|for discussion)\s+/i;

const AUTHOR_CONNECTOR_TOKENS = new Set([
  '&',
  'al',
  'and',
  'da',
  'de',
  'del',
  'der',
  'di',
  'et',
  'la',
  'le',
  'van',
  'von',
]);

const NON_AUTHOR_TOKENS = new Set([
  'algorithm',
  'april',
  'appendix',
  'august',
  'chapter',
  'december',
  'equation',
  'february',
  'figure',
  'friday',
  'january',
  'july',
  'june',
  'march',
  'monday',
  'november',
  'october',
  'saturday',
  'section',
  'september',
  'sunday',
  'table',
  'thursday',
  'tuesday',
  'wednesday',
]);

// Minimum consecutive math-font items to form an [equation] block.
// Single math-font chars (italic variables like x, n) are kept as-is.
const MATH_RUN_MIN_LENGTH = 2;

// Patterns for metadata junk that should never be read aloud
const METADATA_JUNK_PATTERNS = [
  // Copyright / permissions boilerplate
  /permission to (?:make|copy)\s+digital/i,
  /copyright\s+(?:©|\(c\))\s*\d{4}/i,
  /licensed under (?:a )?creative commons/i,
  /all rights reserved/i,
  // Identifiers
  /\barXiv:\s*\d{4}\.\d{4,5}/i,
  /\bDOI:\s*\S+/i,
  /\bISSN:\s*\S+/i,
  /\bISBN:\s*\S+/i,
  // ACM / IEEE reference format lines
  /ACM Reference Format:/i,
  /IEEE (?:Trans|Conference)/i,
  // Submission / acceptance dates as standalone lines
  /^(?:submitted|received|accepted|revised|published)\s*:?\s*(?:on\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|\d)/i,
  // Keywords line
  /^keywords\s*:/i,
  /^categories\s*:/i,
  /^(?:CCS )?concepts\s*:/i,
  // Email addresses
  /^\{?[\w.+-]+@[\w.-]+\}?$/,
  /^[\w.+-]+@[\w.-]+(?:,\s*[\w.+-]+@[\w.-]+)*$/,
];

// Figure / table caption patterns
const FIGURE_TABLE_CAPTION_PATTERN =
  /^(?:figure|fig\.|table|tab\.)\s*\d+[.:]/i;

// Square bracket numeric citation patterns: [1], [2, 3], [1-5], [1, 3-7]
const SQUARE_BRACKET_CITATION_PATTERN =
  /\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]/g;

// Unicode math symbol → spoken word map
const UNICODE_MATH_MAP = [
  [/∈/g, ' in '],
  [/∉/g, ' not in '],
  [/∀/g, ' for all '],
  [/∃/g, ' there exists '],
  [/∄/g, ' there does not exist '],
  [/∑/g, ' the sum of '],
  [/∏/g, ' the product of '],
  [/∫/g, ' the integral of '],
  [/∂/g, ' partial '],
  [/∇/g, ' the gradient of '],
  [/∞/g, ' infinity '],
  [/∝/g, ' proportional to '],
  [/·/g, ' times '],
  [/×/g, ' times '],
  [/÷/g, ' divided by '],
  [/≠/g, ' not equal to '],
  [/≡/g, ' equivalent to '],
  [/⊂/g, ' subset of '],
  [/⊃/g, ' superset of '],
  [/⊆/g, ' subset of or equal to '],
  [/⊇/g, ' superset of or equal to '],
  [/∅/g, ' the empty set '],
  [/∩/g, ' intersection '],
  [/∪/g, ' union '],
  [/¬/g, ' not '],
  [/∧/g, ' and '],
  [/∨/g, ' or '],
  [/⟨/g, ''],
  [/⟩/g, ''],
  [/‖/g, ' norm of '],
  [/√/g, ' the square root of '],
  [/ℝ/g, ' R '],
  [/ℤ/g, ' Z '],
  [/ℕ/g, ' N '],
  [/ℂ/g, ' C '],
  [/ℚ/g, ' Q '],
];

// Superscript / subscript Unicode → normal text
const SUPERSCRIPT_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i',
};
const SUBSCRIPT_MAP = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
};

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

/**
 * Replace math-font runs with [equation:<raw_text>] markers.
 * Single isolated math-font characters (italic variables) are kept as-is.
 */
function cleanEquations(items) {
  const result = [];
  let mathRun = [];

  function flushMathRun() {
    if (mathRun.length === 0) return;

    if (mathRun.length < MATH_RUN_MIN_LENGTH) {
      // Single math-font char — keep it as regular text (italic var name)
      for (const item of mathRun) {
        result.push(item);
      }
    } else {
      // Real equation block — collect raw text and emit marker
      const rawText = mathRun.map((it) => it.text).join('');
      const firstItem = mathRun[0];
      result.push({
        ...firstItem,
        text: ` [equation:${rawText}] `,
        _isMathReplacement: true,
      });
    }
    mathRun = [];
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (isMathFont(item.fontName)) {
      mathRun.push(item);
      continue;
    }

    flushMathRun();

    let cleaned = item.text;

    if (
      LATEX_REMNANT_PATTERN.test(cleaned)
      || LATEX_SYNTAX_PATTERN.test(cleaned)
    ) {
      cleaned = ` [equation:${item.text}] `;
    }

    result.push({ ...item, text: cleaned });
  }

  flushMathRun();
  return result;
}

function stripCitationPrefix(segment) {
  return segment.replace(CITATION_PREFIX_PATTERN, '').trim();
}

function hasCitationYear(segment) {
  return YEAR_PATTERN.test(segment);
}

function isLikelyAuthorToken(token) {
  if (!token) {
    return false;
  }

  if (/^[A-Z][A-Za-z'`-]*$/.test(token)) {
    return !NON_AUTHOR_TOKENS.has(token.toLowerCase());
  }

  return false;
}

function isLikelyAuthorList(authorText) {
  if (!authorText) {
    return false;
  }

  const normalized = authorText
    .replace(/\bet\s+al\.?$/i, 'et al')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(' ');
  let hasAuthorToken = false;

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    if (AUTHOR_CONNECTOR_TOKENS.has(lowerToken)) {
      continue;
    }
    if (!isLikelyAuthorToken(token)) {
      return false;
    }
    hasAuthorToken = true;
  }

  return hasAuthorToken;
}

function isLikelyCitationSegment(segment) {
  const trimmed = stripCitationPrefix(
    segment.replace(/\s+/g, ' ').trim()
  );

  if (!trimmed || !hasCitationYear(trimmed)) {
    return false;
  }

  const yearMatch = trimmed.match(TRAILING_CITATION_YEAR_PATTERN);
  if (!yearMatch || yearMatch.index === undefined) {
    return false;
  }

  const authorText = trimmed
    .slice(0, yearMatch.index)
    .replace(/,\s*$/, '')
    .trim();

  return isLikelyAuthorList(authorText);
}

function isLikelyCitationGroup(content) {
  const parts = content
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return false;
  }

  return parts.every(isLikelyCitationSegment);
}

/**
 * Remove parenthetical author-year citations: (Smith, 2020)
 */
function stripParentheticalCitations(text) {
  return text.replace(/\(([^()]*)\)/g, (match, content) => {
    if (!isLikelyCitationGroup(content)) {
      return match;
    }
    return '';
  });
}

/**
 * Remove square bracket numeric citations: [1], [2, 3], [1-5]
 */
function stripSquareBracketCitations(text) {
  return text.replace(SQUARE_BRACKET_CITATION_PATTERN, '');
}

/**
 * Remove metadata junk lines (DOI, arXiv, copyright, emails, keywords).
 */
function stripMetadataJunk(text) {
  return text.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !METADATA_JUNK_PATTERNS.some((p) => p.test(trimmed));
  }).join('\n');
}

/**
 * Remove or mute figure/table captions so they don't interrupt flow.
 * Captions starting with "Figure N:" or "Table N:" are removed.
 */
function stripFigureTableCaptions(text) {
  return text.split('\n').filter((line) => {
    return !FIGURE_TABLE_CAPTION_PATTERN.test(line.trim());
  }).join('\n');
}

/**
 * Convert Unicode superscripts/subscripts to readable form.
 * "x²" → "x to the 2", "x₁" → "x 1"
 */
function convertSuperSubscripts(text) {
  let result = text;

  // Superscripts: group consecutive ones
  const superRe = new RegExp(
    `[${Object.keys(SUPERSCRIPT_MAP).join('')}]+`, 'g'
  );
  result = result.replace(superRe, (match) => {
    const digits = [...match].map((ch) => SUPERSCRIPT_MAP[ch] || ch).join('');
    return ` to the ${digits}`;
  });

  // Subscripts: group consecutive ones
  const subRe = new RegExp(
    `[${Object.keys(SUBSCRIPT_MAP).join('')}]+`, 'g'
  );
  result = result.replace(subRe, (match) => {
    const digits = [...match].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
    return ` sub ${digits}`;
  });

  return result;
}

/**
 * Convert Unicode math symbols to spoken words.
 */
function convertUnicodeMathSymbols(text) {
  let result = text;
  for (const [pattern, replacement] of UNICODE_MATH_MAP) {
    result = result.replace(pattern, replacement);
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

  // 4. Remove metadata junk (inline — works even without newlines)
  cleaned = cleaned.replace(
    /arXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?\s*\[[^\]]*\]\s*\d+\s+\w+\s+\d{4}/g,
    ''
  );

  // 5. Remove metadata junk lines
  cleaned = stripMetadataJunk(cleaned);

  // 6. Remove figure/table captions (inline too)
  cleaned = cleaned.replace(
    /(?:Figure|Fig\.|Table|Tab\.)\s*\d+[.:]\s*[^.]*?\./gi,
    ''
  );
  cleaned = stripFigureTableCaptions(cleaned);

  // 7. Remove parenthetical author-year citations
  cleaned = stripParentheticalCitations(cleaned);

  // 8. Remove square bracket numeric citations
  cleaned = stripSquareBracketCitations(cleaned);

  // 9. Deduplicate equation markers (handles any number in a row)
  cleaned = cleaned.replace(
    /(\[equation(?::[^\]]*?)?\]\s*)+/g,
    (match) => {
      // Keep only the first marker from a consecutive run
      const first = match.match(/\[equation(?::[^\]]*?)?\]/);
      return first ? first[0] + ' ' : match;
    }
  );

  // 10. Convert Unicode superscript/subscript to words
  cleaned = convertSuperSubscripts(cleaned);

  // 11. Convert Unicode math symbols to spoken words
  cleaned = convertUnicodeMathSymbols(cleaned);

  // 12. Normalize whitespace characters
  cleaned = cleaned
    .replace(/\t/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\u200C/g, '')
    .replace(/\u200D/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1');

  // 13. TTS-friendly symbol replacements
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
  stripParentheticalCitations,
  stripSquareBracketCitations,
  stripMetadataJunk,
  stripFigureTableCaptions,
  convertSuperSubscripts,
  convertUnicodeMathSymbols,
  isMathFont,
};
