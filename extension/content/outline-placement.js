(function(global) {
  'use strict';

  if (global.SpeakademicOutlinePlacement) {
    return;
  }

  const DEFAULT_GAP_PX = 10;
  const DEFAULT_EDGE_PADDING_PX = 12;

  function shouldPlaceOutlineLeft({
    panelLeft,
    panelRight,
    outlineWidth,
    viewportWidth,
    gapPx = DEFAULT_GAP_PX,
    edgePaddingPx = DEFAULT_EDGE_PADDING_PX,
  }) {
    if (!Number.isFinite(panelLeft)
      || !Number.isFinite(panelRight)
      || !Number.isFinite(outlineWidth)
      || !Number.isFinite(viewportWidth)
      || outlineWidth <= 0
      || viewportWidth <= 0) {
      return false;
    }

    const rightEdge = panelRight + gapPx + outlineWidth;
    const leftEdge = panelLeft - gapPx - outlineWidth;
    const maxRight = viewportWidth - edgePaddingPx;

    if (rightEdge <= maxRight) {
      return false;
    }

    if (leftEdge >= edgePaddingPx) {
      return true;
    }

    const rightOverflow = rightEdge - maxRight;
    const leftOverflow = edgePaddingPx - leftEdge;
    return leftOverflow < rightOverflow;
  }

  global.SpeakademicOutlinePlacement = {
    shouldPlaceOutlineLeft,
  };
})(typeof window !== 'undefined' ? window : globalThis);
