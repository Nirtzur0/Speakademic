const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
  'fig', 'figs', 'eq', 'eqs', 'ref', 'refs',
  'vol', 'no', 'pp', 'ed', 'eds',
  'al', 'vs', 'etc', 'approx',
  'dept', 'univ', 'assoc', 'corp', 'inc', 'ltd',
  'jan', 'feb', 'mar', 'apr', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]);

const ABBREVIATION_PAIRS = [
  'e.g', 'i.e', 'cf', 'viz',
];

function splitIntoSentences(text) {
  if (!text || !text.trim()) return [];

  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/\n{2,}/g, '\n\n')
    .trim();

  const sentences = [];
  let current = '';
  let insideBracket = 0;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    current += ch;

    // Track bracket depth so we never split inside [equation:...]
    if (ch === '[') insideBracket++;
    if (ch === ']') insideBracket = Math.max(0, insideBracket - 1);
    if (insideBracket > 0) continue;

    if (ch !== '.' && ch !== '?' && ch !== '!') continue;

    const next = normalized[i + 1];
    if (!next || next !== ' ') continue;

    if (ch === '.') {
      if (isAbbreviation(normalized, i)) continue;
      if (isDecimalNumber(normalized, i)) continue;
      if (isEllipsis(normalized, i)) continue;
      if (isInitial(normalized, i)) continue;
    }

    const trimmed = current.trim();
    if (trimmed) sentences.push(trimmed);
    current = '';
  }

  const remaining = current.trim();
  if (remaining) sentences.push(remaining);

  return sentences;
}

function isAbbreviation(text, dotIndex) {
  let wordStart = dotIndex - 1;
  while (wordStart >= 0 && /[a-zA-Z]/.test(text[wordStart])) {
    wordStart--;
  }
  const word = text.slice(wordStart + 1, dotIndex).toLowerCase();

  if (ABBREVIATIONS.has(word)) return true;

  for (const pair of ABBREVIATION_PAIRS) {
    const full = pair + '.';
    const start = dotIndex - full.length + 1;
    if (start >= 0) {
      const slice = text.slice(start, dotIndex + 1).toLowerCase();
      if (slice === full) return true;
    }
  }

  return false;
}

function isDecimalNumber(text, dotIndex) {
  const before = text[dotIndex - 1];
  const after = text[dotIndex + 1];
  return before && /\d/.test(before) && after && /\d/.test(after);
}

function isEllipsis(text, dotIndex) {
  return (
    (dotIndex >= 2
      && text[dotIndex - 1] === '.'
      && text[dotIndex - 2] === '.')
    || (dotIndex + 2 < text.length
      && text[dotIndex + 1] === '.'
      && text[dotIndex + 2] === '.')
  );
}

function isInitial(text, dotIndex) {
  if (dotIndex < 1) return false;
  const before = text[dotIndex - 1];
  if (!/[A-Z]/.test(before)) return false;
  if (dotIndex >= 2 && /[a-zA-Z]/.test(text[dotIndex - 2])) {
    return false;
  }
  const after = text[dotIndex + 1];
  if (after === ' ' && dotIndex + 2 < text.length) {
    return /[A-Z]/.test(text[dotIndex + 2]);
  }
  return false;
}

function groupIntoChunks(
  sentences,
  targetLength = 300,
  maxLength = 500
) {
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(sentence);
      continue;
    }

    const combined = current
      ? current + ' ' + sentence
      : sentence;

    if (combined.length > maxLength && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = combined;
    }

    if (current.length >= targetLength) {
      chunks.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export { splitIntoSentences, groupIntoChunks };
