function getResumeProgressPercent(chunkIndex, totalChunks) {
  if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
    return 0;
  }

  const safeChunkIndex = Number.isFinite(chunkIndex)
    ? Math.max(0, chunkIndex)
    : 0;
  return Math.round((safeChunkIndex / totalChunks) * 100);
}

function formatResumePrompt(section, chunkIndex, totalChunks) {
  const sectionLabel = section && section.trim()
    ? section.trim()
    : 'saved position';
  const percent = getResumeProgressPercent(
    chunkIndex,
    totalChunks
  );
  return 'Resume from \u201c' + sectionLabel
    + '\u201d (' + percent + '% through)?';
}

export {
  formatResumePrompt,
  getResumeProgressPercent,
};
