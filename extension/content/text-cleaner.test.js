import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanSpecialContent,
  cleanEquations,
  stripParentheticalCitations,
  stripSquareBracketCitations,
  stripMetadataJunk,
  stripFigureTableCaptions,
  convertSuperSubscripts,
  convertUnicodeMathSymbols,
  isMathFont,
} from './text-cleaner.js';

// ── Existing citation tests ──────────────────────────────────

test('strips grouped author-year citations', () => {
  const text = [
    'With the massive returns we see from scaling compute',
    '(Bubeck, 2023; Hoffmann, 2022; Kaplan, 2020;',
    'Sutton, 2019), the prevailing paradigm continues.',
  ].join(' ');

  assert.equal(
    cleanSpecialContent(text),
    'With the massive returns we see from scaling compute,'
      + ' the prevailing paradigm continues.'
  );
});

test('strips citations with et al and page pins', () => {
  const text =
    'The result appears elsewhere (Brown et al., 2021;'
    + ' Smith and Lee, 2020, pp. 4-6).';

  assert.equal(
    cleanSpecialContent(text),
    'The result appears elsewhere.'
  );
});

test('keeps non-citation parentheticals', () => {
  const text =
    'We summarize the ablation results (see Figure 2)'
    + ' before discussing them.';

  assert.equal(
    cleanSpecialContent(text),
    'We summarize the ablation results (see Figure 2)'
      + ' before discussing them.'
  );
});

// ── Paper 1: Attention Is All You Need ───────────────────────
// Single math-font chars (italic vars) should NOT become [equation]

test('single math-font char kept as text (italic variable)', () => {
  const items = [
    { text: 'where ', fontName: 'TimesNewRoman', height: 10, x: 0, y: 700 },
    { text: 'd', fontName: 'CMMI10', height: 10, x: 40, y: 700 },
    { text: ' is the dimension', fontName: 'TimesNewRoman', height: 10, x: 50, y: 700 },
  ];
  const result = cleanEquations(items);
  const text = result.map(i => i.text).join('');
  assert.ok(text.includes('d'), 'variable d preserved');
  assert.ok(!text.includes('[equation'), 'no equation marker');
});

test('multi-item math run becomes [equation:raw_text]', () => {
  const items = [
    { text: 'We define ', fontName: 'TimesNewRoman', height: 10, x: 0, y: 700 },
    { text: 'Attention', fontName: 'CMMI10', height: 10, x: 60, y: 700 },
    { text: '(', fontName: 'CMR10', height: 10, x: 100, y: 700 },
    { text: 'Q', fontName: 'CMMI10', height: 10, x: 110, y: 700 },
    { text: ',', fontName: 'CMR10', height: 10, x: 120, y: 700 },
    { text: 'K', fontName: 'CMMI10', height: 10, x: 130, y: 700 },
    { text: ')', fontName: 'CMR10', height: 10, x: 160, y: 700 },
    { text: ' follows.', fontName: 'TimesNewRoman', height: 10, x: 170, y: 700 },
  ];
  const result = cleanEquations(items);
  const text = result.map(i => i.text).join('');
  assert.ok(text.includes('[equation:'), 'math run has equation marker');
  assert.ok(text.includes('Attention'), 'raw text preserved');
  assert.ok(text.includes('follows'), 'surrounding text intact');
});

// ── Paper 2: GPT-4 (square bracket citations) ────────────────

test('strips square bracket numeric citations', () => {
  const text = 'Recent work [1] has shown [2, 3] improvements [14-17].';
  const result = stripSquareBracketCitations(text);
  assert.ok(!result.includes('[1]'));
  assert.ok(!result.includes('[2, 3]'));
  assert.ok(!result.includes('[14-17]'));
  assert.ok(result.includes('Recent work'));
});

test('preserves non-citation square brackets', () => {
  const text = 'The loss L[f(x)] converges.';
  const result = stripSquareBracketCitations(text);
  assert.ok(result.includes('L[f(x)]'), 'function brackets preserved');
});

// ── Paper 3: ViT (figures/tables, superscripts) ──────────────

test('strips figure and table captions', () => {
  const text = [
    'The model achieves 88% accuracy.',
    'Figure 1: Overview of the architecture.',
    'Table 2: Comparison results.',
    'We split images into patches.',
  ].join('\n');
  const result = stripFigureTableCaptions(text);
  assert.ok(!result.includes('Figure 1:'));
  assert.ok(!result.includes('Table 2:'));
  assert.ok(result.includes('88%'));
  assert.ok(result.includes('patches'));
});

test('converts superscript Unicode', () => {
  const text = 'R² complexity O(n²).';
  const result = convertSuperSubscripts(text);
  assert.ok(result.includes('to the 2'));
  assert.ok(!result.includes('²'));
});

// ── Paper 4: Chain-of-Thought (parenthetical citations) ──────

test('strips multi-author parenthetical citations', () => {
  const text = 'Prior work (Brown et al., 2020; Wei et al., 2022) showed this.';
  const result = stripParentheticalCitations(text);
  assert.ok(!result.includes('Brown'));
  assert.ok(!result.includes('2020'));
  assert.ok(result.includes('Prior work'));
});

test('preserves non-citation parentheses', () => {
  const text = 'The model (see Figure 3) works (over 90%).';
  const result = stripParentheticalCitations(text);
  assert.ok(result.includes('see Figure 3'));
  assert.ok(result.includes('over 90%'));
});

// ── Paper 5: Physics (Unicode math symbols) ──────────────────

test('converts Unicode math symbols to spoken words', () => {
  const text = 'For all x ∈ ℝ, ∃ a solution where ∂f = ∇ψ.';
  const result = convertUnicodeMathSymbols(text);
  assert.ok(result.includes(' in '), '∈ → in');
  assert.ok(result.includes(' R '), 'ℝ → R');
  assert.ok(result.includes('there exists'), '∃ → there exists');
  assert.ok(result.includes('partial'), '∂ → partial');
  assert.ok(result.includes('gradient'), '∇ → gradient');
});

test('converts set/logic symbols', () => {
  const text = 'A ∩ B ≠ ∅ and A ∪ B = C.';
  const result = convertUnicodeMathSymbols(text);
  assert.ok(result.includes('intersection'));
  assert.ok(result.includes('not equal to'));
  assert.ok(result.includes('empty set'));
  assert.ok(result.includes('union'));
});

// ── Paper 6: ACM format (metadata junk) ──────────────────────

test('strips metadata junk lines', () => {
  const text = [
    'Permission to make digital or hard copies of all or part.',
    'DOI: 10.1145/1234567.1234568',
    'arXiv: 2301.12345',
    'Keywords: machine learning, transformers',
    'CCS Concepts: Computing methodologies',
    'john.doe@university.edu',
    'The attention mechanism is widely used.',
  ].join('\n');
  const result = stripMetadataJunk(text);
  assert.ok(!result.includes('Permission to make'));
  assert.ok(!result.includes('DOI:'));
  assert.ok(!result.includes('arXiv:'));
  assert.ok(!result.includes('Keywords:'));
  assert.ok(!result.includes('CCS Concepts'));
  assert.ok(!result.includes('@university'));
  assert.ok(result.includes('attention mechanism'));
});

// ── Paper 7: Pure math (LaTeX remnants) ──────────────────────

test('detects LaTeX remnants and preserves raw text', () => {
  const items = [
    { text: 'Let ', fontName: 'TimesNewRoman', height: 10, x: 0, y: 700 },
    { text: '\\alpha \\in \\mathbb{R}', fontName: 'TimesNewRoman', height: 10, x: 20, y: 700 },
    { text: ' be given.', fontName: 'TimesNewRoman', height: 10, x: 100, y: 700 },
  ];
  const result = cleanEquations(items);
  const text = result.map(i => i.text).join('');
  assert.ok(text.includes('[equation:'), 'LaTeX remnant detected');
  assert.ok(text.includes('\\alpha'), 'raw LaTeX preserved');
});

// ── Paper 8: NLP (subscripts) ────────────────────────────────

test('converts subscript Unicode', () => {
  const text = 'The hidden state h₁ combines with h₂.';
  const result = convertSuperSubscripts(text);
  assert.ok(result.includes('sub 1'));
  assert.ok(result.includes('sub 2'));
  assert.ok(!result.includes('₁'));
});

// ── Paper 9: Equation deduplication ──────────────────────────

test('deduplicates consecutive equation markers', () => {
  const text = 'Some text [equation:x=1] [equation:y=2] [equation:z=3] more text.';
  const result = cleanSpecialContent(text);
  const count = (result.match(/\[equation/g) || []).length;
  assert.equal(count, 1, 'triple deduped to 1');
});

test('keeps separated equation markers', () => {
  const text = 'A [equation:a] B [equation:b] C.';
  const result = cleanSpecialContent(text);
  const count = (result.match(/\[equation/g) || []).length;
  assert.equal(count, 2, 'separated markers both kept');
});

// ── Paper 10: Full pipeline integration ──────────────────────

test('full pipeline integration', () => {
  const text = [
    'arXiv: 2401.00001',
    'DOI: 10.1234/test',
    'john@example.com, jane@example.com',
    'The model achieves 95% accuracy (Brown et al., 2023).',
    'Results are shown in [1, 2].',
    'Figure 3: The main architecture.',
    'The gradient ∇L converges for x ∈ ℝ.',
    'Performance scales as O(n²).',
    '[equation:E=mc^2] [equation:F=ma] This follows from Newton.',
    'The coefficient α₁ = 3.14.',
  ].join('\n');
  const result = cleanSpecialContent(text);

  assert.ok(!result.includes('arXiv:'), 'arXiv stripped');
  assert.ok(!result.includes('DOI:'), 'DOI stripped');
  assert.ok(!result.includes('@example'), 'emails stripped');
  assert.ok(!result.includes('Brown'), 'author citations stripped');
  assert.ok(!result.includes('[1, 2]'), 'numeric citations stripped');
  assert.ok(!result.includes('Figure 3:'), 'figure caption stripped');
  assert.ok(result.includes('gradient'), '∇ converted');
  assert.ok(result.includes(' in '), '∈ converted');
  assert.ok(result.includes('to the 2'), '² converted');
  assert.ok(result.includes('sub 1'), '₁ converted');
  const eqCount = (result.match(/\[equation/g) || []).length;
  assert.equal(eqCount, 1, 'consecutive equations deduplicated');
  assert.ok(result.includes('Newton'), 'prose preserved');
  assert.ok(result.includes('3.14'), 'decimal preserved');
  assert.ok(result.includes('95 percent'), 'percent converted');
});

// ── Math font detection ──────────────────────────────────────

test('math font detection', () => {
  assert.ok(isMathFont('CMMI10'));
  assert.ok(isMathFont('CMSY8'));
  assert.ok(isMathFont('STIXTwoMath'));
  assert.ok(isMathFont('Symbol'));
  assert.ok(!isMathFont('TimesNewRoman'));
  assert.ok(!isMathFont('Helvetica'));
  assert.ok(!isMathFont('ArialMT'));
});
