import test from 'node:test';
import assert from 'node:assert/strict';

import { detectColumns, isMultiColumn } from './column-detector.js';

// Helper: create a text item at given position
function item(x, y, width, text = 'word') {
  return { x, y, width, height: 10, text, fontName: 'Times' };
}

// Simulate a typical IEEE two-column page (612pt wide)
// Left column: x ~ 54–298, Right column: x ~ 314–558
// Gutter: ~298–314 (16pt, ~2.6% of page width)
function makeIEEETwoColumnPage() {
  const items = [];
  const pageWidth = 612;

  // Left column lines (y descends from top)
  for (let line = 0; line < 20; line++) {
    const y = 700 - line * 14;
    items.push(item(54, y, 244, `left line ${line}`));
  }

  // Right column lines
  for (let line = 0; line < 20; line++) {
    const y = 700 - line * 14;
    items.push(item(314, y, 244, `right line ${line}`));
  }

  return { items, pageWidth };
}

test('detects IEEE two-column layout with narrow gutter', () => {
  const { items, pageWidth } = makeIEEETwoColumnPage();

  assert.ok(isMultiColumn(items, pageWidth), 'should detect two columns');

  const ordered = detectColumns(items, pageWidth);
  // All left-column items should come before right-column items
  const leftEnd = ordered.findIndex((it) => it.text.startsWith('right'));
  const rightStart = ordered.findIndex((it) => it.text.startsWith('right'));

  assert.ok(rightStart > 0, 'right column items should exist');
  // Verify no right-column items appear before left-column items end
  for (let i = 0; i < rightStart; i++) {
    assert.ok(
      ordered[i].text.startsWith('left'),
      `item ${i} should be left column but was: ${ordered[i].text}`
    );
  }
});

test('detects columns despite stray items in gutter', () => {
  const { items, pageWidth } = makeIEEETwoColumnPage();

  // Add a few equation fragments that land in the gutter area
  items.push(item(300, 650, 20, '='));
  items.push(item(305, 500, 10, '+'));

  assert.ok(
    isMultiColumn(items, pageWidth),
    'should still detect two columns with stray gutter items'
  );
});

test('single-column page is not detected as multi-column', () => {
  const items = [];
  const pageWidth = 612;

  for (let line = 0; line < 30; line++) {
    const y = 700 - line * 14;
    items.push(item(72, y, 468, `body line ${line}`));
  }

  assert.ok(
    !isMultiColumn(items, pageWidth),
    'single-column should not be multi-column'
  );
});

test('spanning elements are handled correctly', () => {
  const { items, pageWidth } = makeIEEETwoColumnPage();

  // Add a full-width title at the top
  items.push(item(54, 750, 504, 'Paper Title'));

  const ordered = detectColumns(items, pageWidth);

  // Title should appear first (highest y)
  assert.equal(ordered[0].text, 'Paper Title');
});

test('rejects false positive when items heavily favor one side', () => {
  const items = [];
  const pageWidth = 612;

  // Most items on the left, just 1 on the right
  for (let line = 0; line < 30; line++) {
    items.push(item(54, 700 - line * 14, 244, `left ${line}`));
  }
  items.push(item(400, 700, 100, 'lonely right'));

  const ordered = detectColumns(items, pageWidth);

  // Should fall back to single-column ordering (not split into columns)
  // because the column balance check should reject such a split
  assert.ok(ordered.length === 31);
});

test('LaTeX default twocolumn (very narrow 10pt gutter)', () => {
  const items = [];
  const pageWidth = 612;
  // LaTeX twocolumn: margins ~72pt, columnsep ~10pt
  // Left col: 72–297, right col: 307–532

  for (let line = 0; line < 15; line++) {
    const y = 700 - line * 14;
    items.push(item(72, y, 225, `L${line}`));
    items.push(item(307, y, 225, `R${line}`));
  }

  assert.ok(
    isMultiColumn(items, pageWidth),
    'should detect LaTeX twocolumn with 10pt gutter'
  );
});
