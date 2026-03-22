const POSITIONS_KEY = 'speakademic_positions';
const SETTINGS_KEY = 'speakademic_settings';
const TTS_MODE_KEY = 'speakademic_tts_mode';
const EXPIRY_DAYS = 30;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

async function savePosition(pdfUrl, position) {
  const positions = await getPositions();
  positions[pdfUrl] = {
    ...position,
    savedAt: Date.now(),
  };
  await chrome.storage.local.set({
    [POSITIONS_KEY]: positions,
  });
  console.log(
    `[Storage] Position saved for ${pdfUrl.slice(0, 60)}`
    + ` (chunk ${position.chunkIndex})`
  );
}

async function getPosition(pdfUrl) {
  const positions = await getPositions();
  const entry = positions[pdfUrl];
  if (!entry) return null;

  if (Date.now() - entry.savedAt > EXPIRY_MS) {
    delete positions[pdfUrl];
    await chrome.storage.local.set({
      [POSITIONS_KEY]: positions,
    });
    return null;
  }

  return entry;
}

async function clearPosition(pdfUrl) {
  const positions = await getPositions();
  delete positions[pdfUrl];
  await chrome.storage.local.set({
    [POSITIONS_KEY]: positions,
  });
}

async function getPositions() {
  const data = await chrome.storage.local.get(POSITIONS_KEY);
  return data[POSITIONS_KEY] || {};
}

async function cleanExpiredPositions() {
  const positions = await getPositions();
  const now = Date.now();
  let changed = false;

  for (const [url, entry] of Object.entries(positions)) {
    if (now - entry.savedAt > EXPIRY_MS) {
      delete positions[url];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({
      [POSITIONS_KEY]: positions,
    });
    console.log('[Storage] Cleaned expired positions');
  }
}

const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:8880',
  defaultVoice: 'af_bella',
  defaultSpeed: 1.0,
  autoResume: true,
  skipReferences: true,
  equationMode: 'skip',
};

async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: merged,
  });
  return merged;
}

async function getTtsMode() {
  const data = await chrome.storage.local.get(TTS_MODE_KEY);
  return data[TTS_MODE_KEY] || 'cloud';
}

async function saveTtsMode(mode) {
  await chrome.storage.local.set({ [TTS_MODE_KEY]: mode });
}

export {
  savePosition,
  getPosition,
  clearPosition,
  cleanExpiredPositions,
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  getTtsMode,
  saveTtsMode,
};
