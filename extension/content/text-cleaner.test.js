import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanSpecialContent } from './text-cleaner.js';

test('cleanSpecialContent strips grouped author-year citations', () => {
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

test('cleanSpecialContent strips citations with et al and page pins', () => {
  const text =
    'The result appears elsewhere (Brown et al., 2021;'
    + ' Smith and Lee, 2020, pp. 4-6).';

  assert.equal(
    cleanSpecialContent(text),
    'The result appears elsewhere.'
  );
});

test('cleanSpecialContent keeps non-citation parentheticals', () => {
  const text =
    'We summarize the ablation results (see Figure 2)'
    + ' before discussing them.';

  assert.equal(
    cleanSpecialContent(text),
    'We summarize the ablation results (see Figure 2)'
      + ' before discussing them.'
  );
});
