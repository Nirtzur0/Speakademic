import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatResumePrompt,
  getResumeProgressPercent,
} from './resume-copy.js';

test('formatResumePrompt renders the saved section and progress', () => {
  assert.equal(
    formatResumePrompt(
      '2. The Ontology of Abstraction: Map vs. Territory',
      6,
      75
    ),
    'Resume from \u201c2. The Ontology of Abstraction:'
      + ' Map vs. Territory\u201d (8% through)?'
  );
});

test('formatResumePrompt falls back to a generic label', () => {
  assert.equal(
    formatResumePrompt('', 0, 40),
    'Resume from \u201csaved position\u201d (0% through)?'
  );
});

test('getResumeProgressPercent guards against invalid totals', () => {
  assert.equal(getResumeProgressPercent(5, 0), 0);
  assert.equal(getResumeProgressPercent(5, Number.NaN), 0);
});
