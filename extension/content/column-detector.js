const PAGE_WIDTH_FALLBACK = 612;
const GAP_THRESHOLD_RATIO = 0.10;
const COLUMN_Y_TOLERANCE = 3;
const SPANNING_WIDTH_RATIO = 0.6;

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

  sortColumnItems(left);
  sortColumnItems(right);

  return mergeColumnsWithSpanning(left, right, spanning);
}

function findColumnGap(items, pageWidth) {
  const bucketCount = 100;
  const bucketWidth = pageWidth / bucketCount;
  const histogram = new Array(bucketCount).fill(0);

  for (const item of items) {
    if (item.width > pageWidth * SPANNING_WIDTH_RATIO) continue;

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

  const middleStart = Math.floor(bucketCount * 0.3);
  const middleEnd = Math.floor(bucketCount * 0.7);

  let bestGapStart = -1;
  let bestGapEnd = -1;
  let bestGapLength = 0;

  let gapStart = -1;
  for (let b = middleStart; b <= middleEnd; b++) {
    if (histogram[b] === 0) {
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

  return {
    start: bestGapStart * bucketWidth,
    end: bestGapEnd * bucketWidth,
  };
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
