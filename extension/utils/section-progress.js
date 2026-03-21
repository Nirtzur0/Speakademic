function normalizeSectionIndex(sectionIndex, sectionCount) {
  if (Number.isInteger(sectionIndex)
    && sectionIndex >= 0
    && sectionIndex < sectionCount) {
    return sectionIndex;
  }
  return 0;
}

function getSectionTitle(section) {
  const title = section?.title?.trim();
  if (title) {
    return title;
  }
  return 'Untitled section';
}

function pushSegment(segments, segment, totalChunks) {
  const chunkCount = segment.endChunk - segment.startChunk + 1;
  segments.push({
    sectionIndex: segment.sectionIndex,
    title: segment.title,
    startChunk: segment.startChunk,
    endChunk: segment.endChunk,
    chunkCount,
    startRatio: segment.startChunk / totalChunks,
    widthRatio: chunkCount / totalChunks,
  });
}

function buildSectionProgressSegments(
  sections,
  chunkSectionMap,
  totalChunks
) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return [];
  }
  if (!Array.isArray(chunkSectionMap) || chunkSectionMap.length === 0) {
    return [];
  }
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    return [];
  }

  const segments = [];
  const chunkCount = Math.min(totalChunks, chunkSectionMap.length);
  let activeSegment = null;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const sectionIndex = normalizeSectionIndex(
      chunkSectionMap[chunkIndex],
      sections.length
    );
    const title = getSectionTitle(sections[sectionIndex]);

    if (!activeSegment || activeSegment.sectionIndex !== sectionIndex) {
      if (activeSegment) {
        pushSegment(segments, activeSegment, totalChunks);
      }
      activeSegment = {
        sectionIndex,
        title,
        startChunk: chunkIndex,
        endChunk: chunkIndex,
      };
      continue;
    }

    activeSegment.endChunk = chunkIndex;
  }

  if (activeSegment) {
    pushSegment(segments, activeSegment, totalChunks);
  }

  return segments;
}

export { buildSectionProgressSegments };
