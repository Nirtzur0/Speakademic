const PAGE_WIDTH_FALLBACK = 612;
const GAP_THRESHOLD_RATIO = 0.008;
const COLUMN_Y_TOLERANCE = 3;
const SPANNING_WIDTH_RATIO = 0.6;
// Fraction of median bucket count below which a bucket counts as "empty"
const LOW_DENSITY_RATIO = 0.1;
// Minimum fraction of non-spanning items on each side to confirm two columns
const MIN_COLUMN_BALANCE = 0.15;

function detectColumns(pageItems, pageWidth = PAGE_WIDTH_FALLBACK) {
  if (pageItems.length === 0) return pageItems;

  const gap = findColumnGap(pageItems, pageWidth);

  if (!gap) {
    return sortSingleColumn(pageItems);
  }

  const midpoint = gap.start + (gap.end - gap.start) / 2;
  const left = [];
  const right = [];
  const spanning = [];

  for (const item of pageItems) {
    const itemRight = item.x + item.width;
    const itemCenter = item.x + item.width / 2;

    if (item.width > pageWidth * SPANNING_WIDTH_RATIO) {
      spanning.push(item);
    } else if (itemCenter < midpoint) {
      left.push(item);
    } else {
      right.push(item);
    }
  }

  // Validate column balance — both sides need substantial content
  const nonSpanning = left.length + right.length;
  if (nonSpanning < 4) {
    return sortSingleColumn(pageItems);
  }
  const minSide = Math.min(left.length, right.length);
  if (minSide / nonSpanning < MIN_COLUMN_BALANCE) {
    return sortSingleColumn(pageItems);
  }

  sortColumnItems(left);
  sortColumnItems(right);

  return mergeColumnsWithSpanning(left, right, spanning);
}

function findColumnGap(items, pageWidth) {
  const bucketCount = 200;
  const bucketWidth = pageWidth / bucketCount;
  const histogram = new Array(bucketCount).fill(0);

  let nonSpanningCount = 0;
  for (const item of items) {
    if (item.width > pageWidth * SPANNING_WIDTH_RATIO) continue;
    nonSpanningCount++;

    const startBucket = Math.floor(item.x / bucketWidth);
    const endBucket = Math.floor(
      (item.x + item.width) / bucketWidth
    );

    for (
      let b = Math.max(0, startBucket);
      b <= Math.min(bucketCount - 1, endBucket);
      b++
    ) {
      histogram[b]++;
    }
  }

  // Need enough non-spanning items to meaningfully split into columns
  if (nonSpanningCount < 4) return null;

  const middleStart = Math.floor(bucketCount * 0.3);
  const middleEnd = Math.floor(bucketCount * 0.7);

  // Compute low-density threshold: buckets at or below this count
  // are treated as "empty". This tolerates stray items (equation
  // fragments, line numbers) that land in the gutter.
  const middleBuckets = histogram.slice(middleStart, middleEnd + 1);
  const nonZero = middleBuckets.filter((c) => c > 0).sort((a, b) => a - b);
  const median = nonZero.length > 0
    ? nonZero[Math.floor(nonZero.length / 2)]
    : 0;
  const lowThreshold = Math.max(1, Math.floor(median * LOW_DENSITY_RATIO));

  // First pass: strict (zero only)
  let gap = findBestGap(histogram, middleStart, middleEnd, bucketCount, 0);
  if (gap) return { start: gap.start * bucketWidth, end: gap.end * bucketWidth };

  // Second pass: relaxed (low-density tolerance)
  gap = findBestGap(histogram, middleStart, middleEnd, bucketCount, lowThreshold);
  if (gap) return { start: gap.start * bucketWidth, end: gap.end * bucketWidth };

  return null;
}

function findBestGap(histogram, middleStart, middleEnd, bucketCount, maxCount) {
  let bestGapStart = -1;
  let bestGapEnd = -1;
  let bestGapLength = 0;

  let gapStart = -1;
  for (let b = middleStart; b <= middleEnd; b++) {
    if (histogram[b] <= maxCount) {
      if (gapStart === -1) gapStart = b;
    } else {
      if (gapStart !== -1) {
        const gapLength = b - gapStart;
        if (gapLength > bestGapLength) {
          bestGapLength = gapLength;
          bestGapStart = gapStart;
          bestGapEnd = b;
        }
        gapStart = -1;
      }
    }
  }

  if (gapStart !== -1) {
    const gapLength = middleEnd + 1 - gapStart;
    if (gapLength > bestGapLength) {
      bestGapLength = gapLength;
      bestGapStart = gapStart;
      bestGapEnd = middleEnd + 1;
    }
  }

  const gapWidthRatio = bestGapLength / bucketCount;
  if (gapWidthRatio < GAP_THRESHOLD_RATIO) return null;

  return { start: bestGapStart, end: bestGapEnd };
}

function sortColumnItems(items) {
  items.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > COLUMN_Y_TOLERANCE) return yDiff;
    return a.x - b.x;
  });
}

function sortSingleColumn(items) {
  const sorted = [...items];
  sortColumnItems(sorted);
  return sorted;
}

function mergeColumnsWithSpanning(left, right, spanning) {
  if (spanning.length === 0) {
    return [...left, ...right];
  }

  spanning.sort((a, b) => b.y - a.y);

  const result = [];
  let leftIdx = 0;
  let rightIdx = 0;
  let spanIdx = 0;

  while (spanIdx < spanning.length) {
    const spanItem = spanning[spanIdx];

    while (leftIdx < left.length && left[leftIdx].y > spanItem.y) {
      result.push(left[leftIdx]);
      leftIdx++;
    }

    while (
      rightIdx < right.length
      && right[rightIdx].y > spanItem.y
    ) {
      result.push(right[rightIdx]);
      rightIdx++;
    }

    result.push(spanItem);
    spanIdx++;
  }

  while (leftIdx < left.length) {
    result.push(left[leftIdx]);
    leftIdx++;
  }

  while (rightIdx < right.length) {
    result.push(right[rightIdx]);
    rightIdx++;
  }

  return result;
}

function isMultiColumn(pageItems, pageWidth = PAGE_WIDTH_FALLBACK) {
  return findColumnGap(pageItems, pageWidth) !== null;
}

export { detectColumns, isMultiColumn };
