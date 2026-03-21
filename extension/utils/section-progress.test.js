import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSectionProgressSegments } from './section-progress.js';

test('buildSectionProgressSegments groups contiguous chunks', () => {
  const sections = [
    { title: 'Abstract' },
    { title: 'Introduction' },
    { title: 'Method' },
  ];

  const segments = buildSectionProgressSegments(
    sections,
    [0, 0, 1, 1, 1, 2],
    6
  );

  assert.deepEqual(
    segments.map((segment) => ({
      title: segment.title,
      startChunk: segment.startChunk,
      endChunk: segment.endChunk,
      widthRatio: segment.widthRatio,
    })),
    [
      {
        title: 'Abstract',
        startChunk: 0,
        endChunk: 1,
        widthRatio: 2 / 6,
      },
      {
        title: 'Introduction',
        startChunk: 2,
        endChunk: 4,
        widthRatio: 3 / 6,
      },
      {
        title: 'Method',
        startChunk: 5,
        endChunk: 5,
        widthRatio: 1 / 6,
      },
    ]
  );
});

test('buildSectionProgressSegments falls back for invalid indexes', () => {
  const sections = [
    { title: 'Only section' },
    { title: 'Unused section' },
  ];

  const segments = buildSectionProgressSegments(
    sections,
    [99, 0, 0],
    3
  );

  assert.equal(segments.length, 1);
  assert.equal(segments[0].title, 'Only section');
  assert.equal(segments[0].startChunk, 0);
  assert.equal(segments[0].endChunk, 2);
});
