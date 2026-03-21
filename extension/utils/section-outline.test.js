import test from 'node:test';
import assert from 'node:assert/strict';

import { annotateSectionHierarchy } from './section-outline.js';

test('annotateSectionHierarchy infers nested levels from numbering', () => {
  const sections = [
    { title: '1 Introduction', fontSize: 16 },
    { title: '1.1 Problem setup', fontSize: 14 },
    { title: '1.1.1 Dataset', fontSize: 13 },
    { title: '2 Results', fontSize: 16 },
  ];

  const outline = annotateSectionHierarchy(sections);

  assert.deepEqual(
    outline.map((section) => ({
      title: section.title,
      outlineLevel: section.outlineLevel,
    })),
    [
      { title: '1 Introduction', outlineLevel: 0 },
      { title: '1.1 Problem setup', outlineLevel: 1 },
      { title: '1.1.1 Dataset', outlineLevel: 2 },
      { title: '2 Results', outlineLevel: 0 },
    ]
  );
});

test('annotateSectionHierarchy falls back to heading sizes', () => {
  const sections = [
    { title: 'Abstract', fontSize: 17 },
    { title: 'Methods', fontSize: 17 },
    { title: 'Participants', fontSize: 15 },
    { title: 'Measures', fontSize: 15 },
    { title: 'Results', fontSize: 17 },
  ];

  const outline = annotateSectionHierarchy(sections);

  assert.deepEqual(
    outline.map((section) => ({
      title: section.title,
      outlineLevel: section.outlineLevel,
    })),
    [
      { title: 'Abstract', outlineLevel: 0 },
      { title: 'Methods', outlineLevel: 0 },
      { title: 'Participants', outlineLevel: 1 },
      { title: 'Measures', outlineLevel: 1 },
      { title: 'Results', outlineLevel: 0 },
    ]
  );
});

test('annotateSectionHierarchy prevents impossible depth jumps', () => {
  const sections = [
    { title: 'I. Overview', fontSize: 16 },
    { title: '1.1.1 Deep dive', fontSize: 14 },
  ];

  const outline = annotateSectionHierarchy(sections);

  assert.equal(outline[0].outlineLevel, 0);
  assert.equal(outline[1].outlineLevel, 1);
});
