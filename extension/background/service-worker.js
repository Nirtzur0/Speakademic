import {
  MSG,
  STATUS,
  DEFAULT_VOICE,
  DEFAULT_SPEED,
  KEEPALIVE_ALARM_NAME,
  KEEPALIVE_INTERVAL_MINUTES,
  POSITION_SAVE_INTERVAL_MS,
  SERVER_RETRY_INTERVAL_MS,
  SERVER_RETRY_MAX_ATTEMPTS,
  PREFETCH_BUFFER_SIZE,
  ADAPTIVE_SLOW_RATIO,
  ADAPTIVE_MIN_CHUNK,
  ADAPTIVE_MAX_CHUNK,
} from '../utils/constants.js';
import { TtsClient } from '../utils/tts-client.js';
import { extractText } from '../content/pdf-extractor.js';
import {
  splitIntoSentences,
  groupIntoChunks,
} from '../content/sentence-splitter.js';
import {
  savePosition,
  getPosition,
  clearPosition,
  cleanExpiredPositions,
  getSettings,
  saveSettings,
} from '../utils/storage.js';

let tts = new TtsClient();

const state = {
  status: STATUS.IDLE,
  pdfUrl: null,
  tabId: null,
  chunks: [],
  currentChunk: 0,
  totalChunks: 0,
  speed: DEFAULT_SPEED,
  voice: DEFAULT_VOICE,
  serverOnline: false,
  error: null,
  sections: [],
  chunkSectionMap: [],
};

const audioBuffer = new Map();
let _prefetchAbort = null;
let _positionSaveTimer = null;
let _serverRetryTimer = null;
let _serverRetryCount = 0;
let _pendingResumeChunk = null;

const perfMetrics = {
  samples: [],
  avgGenMs: 0,
  avgPlayMs: 0,
  adaptedChunkTarget: 300,
};

function resetState() {
  state.status = STATUS.IDLE;
  state.pdfUrl = null;
  state.tabId = null;
  state.chunks = [];
  state.currentChunk = 0;
  state.totalChunks = 0;
  state.error = null;
  state.sections = [];
  state.chunkSectionMap = [];
  clearAudioBuffer();
  _pendingResumeChunk = null;
  stopPositionSave();
  stopServerRetry();
}

function clearAudioBuffer() {
  audioBuffer.clear();
  if (_prefetchAbort) {
    _prefetchAbort.abort();
    _prefetchAbort = null;
  }
}

function getCurrentSection() {
  const idx = state.chunkSectionMap[state.currentChunk];
  if (idx !== undefined && state.sections[idx]) {
    return state.sections[idx].title;
  }
  return '';
}

function broadcastStatus() {
  const payload = {
    status: state.status,
    currentChunk: state.currentChunk,
    totalChunks: state.totalChunks,
    error: state.error,
    sections: state.sections,
    currentSection: getCurrentSection(),
    speed: state.speed,
    voice: state.voice,
    pdfUrl: state.pdfUrl,
  };

  chrome.runtime.sendMessage(
    { type: MSG.STATUS_UPDATE, payload }
  ).catch(() => {});

  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId,
      { type: MSG.STATUS_UPDATE, payload }
    ).catch(() => {});
  }
}

function broadcastServerStatus(online) {
  state.serverOnline = online;
  chrome.runtime.sendMessage(
    { type: MSG.SERVER_STATUS, payload: { online } }
  ).catch(() => {});
  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId,
      { type: MSG.SERVER_STATUS, payload: { online } }
    ).catch(() => {});
  }
}

function setError(code, message) {
  state.status = STATUS.ERROR;
  state.error = { code, message };
  broadcastStatus();
  stopKeepAlive();
  stopPositionSave();
}

function startKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
  });
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
}

// --- Position persistence ---

function startPositionSave() {
  stopPositionSave();
  _positionSaveTimer = setInterval(
    saveCurrentPosition, POSITION_SAVE_INTERVAL_MS
  );
}

function stopPositionSave() {
  if (_positionSaveTimer) {
    clearInterval(_positionSaveTimer);
    _positionSaveTimer = null;
  }
}

async function saveCurrentPosition() {
  if (!state.pdfUrl || state.status === STATUS.IDLE) return;
  await savePosition(state.pdfUrl, {
    chunkIndex: state.currentChunk,
    totalChunks: state.totalChunks,
    section: getCurrentSection(),
    speed: state.speed,
    voice: state.voice,
  });
}

// --- Server retry ---

function startServerRetry() {
  stopServerRetry();
  _serverRetryCount = 0;
  _serverRetryTimer = setInterval(
    retryServerConnection, SERVER_RETRY_INTERVAL_MS
  );
}

function stopServerRetry() {
  if (_serverRetryTimer) {
    clearInterval(_serverRetryTimer);
    _serverRetryTimer = null;
  }
  _serverRetryCount = 0;
}

async function retryServerConnection() {
  _serverRetryCount++;
  console.log(
    `[SW] Retry ${_serverRetryCount}/${SERVER_RETRY_MAX_ATTEMPTS}`
  );

  const online = await tts.checkHealth();
  broadcastServerStatus(online);

  if (online) {
    console.log('[SW] Server reconnected');
    stopServerRetry();
    if (state.status === STATUS.ERROR
      && state.error?.code === 'server_offline_mid') {
      state.status = STATUS.PAUSED;
      state.error = null;
      broadcastStatus();
    }
    return;
  }

  if (_serverRetryCount >= SERVER_RETRY_MAX_ATTEMPTS) {
    console.warn('[SW] Server retry limit reached');
    stopServerRetry();
  }
}

// --- URL type detection ---

function isPdfUrl(url) {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.pdf')) return true;
  } catch {
    // invalid URL
  }
  if (url.includes('.pdf?') || url.includes('.pdf#')) {
    return true;
  }
  if (url.startsWith('chrome-extension://')
    && url.includes('pdf')) return true;
  return false;
}

async function extractWebText(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(
        'Web text extraction timed out.'
        + ' The page may not contain readable content.'
      ));
    }, 15000);

    function listener(msg, sender) {
      if (msg.type === MSG.TEXT_EXTRACTED
        && sender.tab?.id === tabId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg.payload);
      }
    }

    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'lib/Readability.js',
        'content/web-extractor.js',
      ],
    }).catch((err) => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(
        'Cannot access this page. '
        + err.message
      ));
    });
  });
}

// --- Content script injection ---

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/overlay-player.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'utils/audio-player.js',
        'content/overlay-player.js',
        'content/content-script.js',
      ],
    });
  } catch (err) {
    console.error(
      '[SW] Content script injection failed:', err.message
    );
    throw err;
  }
}

// --- Chunk section mapping ---

function buildChunkSectionMap(chunks, sectionCharOffsets) {
  if (sectionCharOffsets.length === 0) {
    return new Array(chunks.length).fill(0);
  }
  const map = [];
  let charPos = 0;
  for (let i = 0; i < chunks.length; i++) {
    let sectionIdx = 0;
    for (let s = sectionCharOffsets.length - 1; s >= 0; s--) {
      if (charPos >= sectionCharOffsets[s]) {
        sectionIdx = s;
        break;
      }
    }
    map.push(sectionIdx);
    charPos += chunks[i].length + 1;
  }
  return map;
}

// --- Play / Pause / Stop ---

async function handlePlay() {
  if (state.status === STATUS.PLAYING) return;

  if (state.status === STATUS.PAUSED) {
    state.status = STATUS.PLAYING;
    broadcastStatus();
    chrome.tabs.sendMessage(
      state.tabId,
      { type: MSG.PLAY, payload: {} }
    ).catch(() => {});
    startKeepAlive();
    startPositionSave();
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab) {
    setError('no_tab', 'No active tab found');
    return;
  }

  const online = await tts.checkHealth();
  broadcastServerStatus(online);

  if (!online) {
    setError(
      'server_offline',
      'Kokoro server not found. Start it with'
      + ' ./server/start-server.sh'
    );
    return;
  }

  if (tab.url.startsWith('file://')) {
    const allowed =
      await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) {
      setError(
        'file_access',
        'File access not enabled. Go to chrome://extensions,'
        + ' find Kokoro PDF Reader, and enable'
        + ' "Allow access to file URLs".'
      );
      return;
    }
  }

  state.tabId = tab.id;
  state.pdfUrl = tab.url;
  state.status = STATUS.EXTRACTING;
  state.error = null;
  broadcastStatus();

  try {
    let result;
    if (isPdfUrl(tab.url)) {
      result = await extractText(tab.url);
    } else {
      result = await extractWebText(tab.id);
    }

    const {
      fullText, sections, sectionCharOffsets, meta,
    } = result;

    if (!fullText || !fullText.trim()) {
      let msg;
      if (meta?.source === 'web') {
        msg = 'No readable article content found'
          + ' on this page.';
      } else if (meta?.isLikelyScanned) {
        msg = 'This PDF appears to be scanned/image-based.'
          + ' Text extraction is not possible.'
          + ' Try a PDF with selectable text,'
          + ' or use an OCR tool first.';
      } else {
        msg = 'No text found in this document.';
      }
      setError('no_text', msg);
      return;
    }

    const sentences = splitIntoSentences(fullText);
    const chunkTarget = getAdaptedChunkTarget();
    state.chunks = groupIntoChunks(
      sentences, chunkTarget, chunkTarget + 200
    );
    state.totalChunks = state.chunks.length;
    state.currentChunk = 0;
    state.sections = sections || [];
    state.chunkSectionMap = buildChunkSectionMap(
      state.chunks, sectionCharOffsets || []
    );

    console.log(
      `[SW] ${state.totalChunks} chunks prepared`
      + ` (${state.sections.length} sections)`
    );

    await injectContentScript(tab.id);

    const settings = await getSettings();
    if (settings.autoResume) {
      const saved = await getPosition(tab.url);
      if (saved && saved.chunkIndex > 0
        && saved.chunkIndex < state.totalChunks) {
        _pendingResumeChunk = saved.chunkIndex;
        const sectionName = saved.section || 'unknown section';
        chrome.tabs.sendMessage(state.tabId, {
          type: MSG.RESUME_PROMPT,
          payload: {
            chunkIndex: saved.chunkIndex,
            totalChunks: state.totalChunks,
            section: sectionName,
          },
        }).catch(() => {});
        broadcastStatus();
        return;
      }
    }

    state.status = STATUS.LOADING;
    broadcastStatus();
    await fetchAndSendChunk(0);
  } catch (err) {
    console.error('[SW] Play failed:', err.message);
    setError(
      err.code || 'play_failed',
      err.message || 'Failed to start playback'
    );
  }
}

function handleResumeAccept() {
  if (_pendingResumeChunk === null) return;
  const chunk = _pendingResumeChunk;
  _pendingResumeChunk = null;
  state.status = STATUS.LOADING;
  broadcastStatus();
  fetchAndSendChunk(chunk);
}

function handleResumeDecline() {
  _pendingResumeChunk = null;
  if (state.pdfUrl) clearPosition(state.pdfUrl);
  state.status = STATUS.LOADING;
  broadcastStatus();
  fetchAndSendChunk(0);
}

async function fetchAudio(index) {
  if (audioBuffer.has(index)) return audioBuffer.get(index);

  const text = state.chunks[index];
  const result = await tts.synthesize(text, {
    voice: state.voice,
    speed: state.speed,
  });

  recordMetrics(result.metrics);
  audioBuffer.set(index, result.audioBase64);

  const staleKeys = [];
  for (const key of audioBuffer.keys()) {
    if (key < state.currentChunk - 1) staleKeys.push(key);
  }
  for (const key of staleKeys) audioBuffer.delete(key);

  return result.audioBase64;
}

function fillBuffer(startIndex) {
  if (_prefetchAbort) _prefetchAbort.abort();
  _prefetchAbort = new AbortController();

  const end = Math.min(
    startIndex + PREFETCH_BUFFER_SIZE, state.totalChunks
  );

  for (let i = startIndex; i < end; i++) {
    if (audioBuffer.has(i)) continue;
    const idx = i;
    const text = state.chunks[idx];
    tts.synthesize(text, {
      voice: state.voice,
      speed: state.speed,
      signal: _prefetchAbort.signal,
    }).then((result) => {
      if (state.status === STATUS.IDLE) return;
      recordMetrics(result.metrics);
      audioBuffer.set(idx, result.audioBase64);
      console.log(
        `[SW] Buffered chunk ${idx + 1}`
        + ` (buf=${audioBuffer.size})`
      );
    }).catch((err) => {
      if (err.code === 'synthesis_cancelled') return;
      console.warn(
        `[SW] Buffer ${idx + 1} failed:`, err.message
      );
    });
  }
}

async function fetchAndSendChunk(index) {
  if (index >= state.totalChunks) {
    console.log('[SW] All chunks played');
    logPerfSummary();
    if (state.pdfUrl) clearPosition(state.pdfUrl);
    resetState();
    broadcastStatus();
    stopKeepAlive();
    return;
  }

  console.log(
    `[SW] Chunk ${index + 1}/${state.totalChunks}`
    + ` (buf=${audioBuffer.size})`
  );

  try {
    const audioBase64 = await fetchAudio(index);

    if (state.status === STATUS.IDLE) return;

    state.currentChunk = index;
    state.status = STATUS.PLAYING;
    broadcastStatus();
    startKeepAlive();
    startPositionSave();

    chrome.tabs.sendMessage(state.tabId, {
      type: MSG.CHUNK_READY,
      payload: {
        audioBase64,
        chunkIndex: index,
        chunkText: state.chunks[index],
      },
    }).catch((err) => {
      console.error(
        '[SW] Failed to send chunk to tab:', err.message
      );
      setError('send_failed', 'Lost connection to PDF tab');
    });

    fillBuffer(index + 1);
  } catch (err) {
    console.error('[SW] Chunk fetch failed:', err.message);

    if (err.code === 'synthesis_failed'
      && state.status === STATUS.PLAYING) {
      state.status = STATUS.ERROR;
      state.error = {
        code: 'server_offline_mid',
        message: 'Server connection lost. Retrying...',
      };
      broadcastStatus();
      broadcastServerStatus(false);
      startServerRetry();
      return;
    }

    setError(
      err.code || 'tts_failed',
      err.message || 'TTS synthesis failed'
    );
  }
}

// --- Performance metrics & adaptive chunking ---

function recordMetrics(metrics) {
  perfMetrics.samples.push(metrics);
  if (perfMetrics.samples.length > 20) {
    perfMetrics.samples.shift();
  }

  const genTimes = perfMetrics.samples.map(
    (s) => s.generationMs
  );
  perfMetrics.avgGenMs = genTimes.reduce(
    (a, b) => a + b, 0
  ) / genTimes.length;

  const playTimes = perfMetrics.samples
    .filter((s) => s.audioSizeBytes > 0)
    .map((s) => estimatePlaybackMs(s));
  if (playTimes.length > 0) {
    perfMetrics.avgPlayMs = playTimes.reduce(
      (a, b) => a + b, 0
    ) / playTimes.length;
  }

  adaptChunkSize();
}

function estimatePlaybackMs(metrics) {
  const mp3BytesPerSec = 16000;
  return (metrics.audioSizeBytes / mp3BytesPerSec) * 1000;
}

function adaptChunkSize() {
  if (perfMetrics.samples.length < 3) return;

  const ratio = perfMetrics.avgGenMs
    / (perfMetrics.avgPlayMs || 1);

  let newTarget = perfMetrics.adaptedChunkTarget;

  if (ratio > ADAPTIVE_SLOW_RATIO) {
    newTarget = Math.min(
      newTarget + 50, ADAPTIVE_MAX_CHUNK
    );
    console.log(
      `[Perf] Server slow (ratio=${ratio.toFixed(2)}),`
      + ` increasing chunk to ${newTarget}`
    );
  } else if (ratio < 0.2) {
    newTarget = Math.max(
      newTarget - 50, ADAPTIVE_MIN_CHUNK
    );
    console.log(
      `[Perf] Server fast (ratio=${ratio.toFixed(2)}),`
      + ` decreasing chunk to ${newTarget}`
    );
  }

  perfMetrics.adaptedChunkTarget = newTarget;
}

function getAdaptedChunkTarget() {
  return perfMetrics.adaptedChunkTarget;
}

function logPerfSummary() {
  if (perfMetrics.samples.length === 0) return;
  console.log(
    `[Perf] Summary: avgGen=${perfMetrics.avgGenMs.toFixed(0)}ms`
    + ` avgPlay=${perfMetrics.avgPlayMs.toFixed(0)}ms`
    + ` chunkTarget=${perfMetrics.adaptedChunkTarget}`
    + ` samples=${perfMetrics.samples.length}`
  );
}

function handlePause() {
  if (state.status !== STATUS.PLAYING) return;

  state.status = STATUS.PAUSED;
  broadcastStatus();
  stopKeepAlive();
  saveCurrentPosition();
  stopPositionSave();

  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId,
      { type: MSG.PAUSE, payload: {} }
    ).catch(() => {});
  }
}

function handleStop() {
  if (state.pdfUrl) saveCurrentPosition();

  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId,
      { type: MSG.STOP, payload: {} }
    ).catch(() => {});
  }

  resetState();
  broadcastStatus();
  stopKeepAlive();
}

// --- Skip / Speed / Voice / Section ---

function handleSkipForward() {
  if (state.status !== STATUS.PLAYING
    && state.status !== STATUS.PAUSED) return;
  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId, { type: MSG.STOP, payload: {} }
    ).catch(() => {});
  }
  const next = Math.min(
    state.currentChunk + 1, state.totalChunks - 1
  );
  fetchAndSendChunk(next);
}

function handleSkipBack() {
  if (state.status !== STATUS.PLAYING
    && state.status !== STATUS.PAUSED) return;
  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId, { type: MSG.STOP, payload: {} }
    ).catch(() => {});
  }
  clearAudioBuffer();
  const prev = Math.max(state.currentChunk - 1, 0);
  fetchAndSendChunk(prev);
}

function handleSetSpeed(speed) {
  state.speed = speed;
  clearAudioBuffer();
  chrome.storage.local.set({ speed });
  broadcastStatus();
  console.log(`[SW] Speed set to ${speed}x`);
}

function handleSetVoice(voice) {
  state.voice = voice;
  clearAudioBuffer();
  chrome.storage.local.set({ voice });
  broadcastStatus();
  console.log(`[SW] Voice set to ${voice}`);
}

async function handleGetVoices(sendResponse) {
  try {
    const voices = await tts.getVoices();
    sendResponse({ voices });
  } catch (err) {
    console.error('[SW] Failed to get voices:', err.message);
    sendResponse({ voices: [] });
  }
}

function handleJumpToSection(sectionIndex) {
  if (sectionIndex < 0
    || sectionIndex >= state.sections.length) return;
  if (state.status !== STATUS.PLAYING
    && state.status !== STATUS.PAUSED
    && state.status !== STATUS.LOADING) return;
  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId, { type: MSG.STOP, payload: {} }
    ).catch(() => {});
  }
  clearAudioBuffer();
  const chunkIndex = state.chunkSectionMap.indexOf(
    sectionIndex
  );
  if (chunkIndex === -1) return;
  console.log(
    `[SW] Jumping to section`
    + ` "${state.sections[sectionIndex].title}"`
    + ` (chunk ${chunkIndex})`
  );
  fetchAndSendChunk(chunkIndex);
}

async function handleGetSettings(sendResponse) {
  const settings = await getSettings();
  sendResponse(settings);
}

async function handleSaveSettings(newSettings, sendResponse) {
  const settings = await saveSettings(newSettings);
  if (settings.serverUrl) {
    tts = new TtsClient(settings.serverUrl);
  }
  sendResponse(settings);
}

// --- Message listener ---

chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    switch (msg.type) {
      case MSG.PLAY:
        handlePlay();
        break;

      case MSG.PAUSE:
        handlePause();
        break;

      case MSG.STOP:
        handleStop();
        break;

      case MSG.CHUNK_FINISHED:
        if (state.status === STATUS.PLAYING) {
          fetchAndSendChunk(state.currentChunk + 1);
        }
        break;

      case MSG.SKIP_FORWARD:
        handleSkipForward();
        break;

      case MSG.SKIP_BACK:
        handleSkipBack();
        break;

      case MSG.SET_SPEED:
        handleSetSpeed(msg.payload.speed);
        break;

      case MSG.SET_VOICE:
        handleSetVoice(msg.payload.voice);
        break;

      case MSG.GET_VOICES:
        handleGetVoices(sendResponse);
        return true;

      case MSG.JUMP_TO_SECTION:
        handleJumpToSection(msg.payload.sectionIndex);
        break;

      case MSG.RESUME_ACCEPT:
        handleResumeAccept();
        break;

      case MSG.RESUME_DECLINE:
        handleResumeDecline();
        break;

      case MSG.GET_SETTINGS:
        handleGetSettings(sendResponse);
        return true;

      case MSG.SAVE_SETTINGS:
        handleSaveSettings(msg.payload, sendResponse);
        return true;

      case MSG.HEARTBEAT:
        break;

      case MSG.STATUS_UPDATE:
        sendResponse({
          status: state.status,
          currentChunk: state.currentChunk,
          totalChunks: state.totalChunks,
          error: state.error,
          sections: state.sections,
          currentSection: getCurrentSection(),
          speed: state.speed,
          voice: state.voice,
          pdfUrl: state.pdfUrl,
        });
        break;

      default:
        break;
    }

    return true;
  }
);

// --- Alarms ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    // Keep-alive ping — no action needed
  }
});

// --- Global keyboard commands ---

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-playback') {
    if (state.status === STATUS.PLAYING) {
      handlePause();
    } else {
      handlePlay();
    }
  } else if (command === 'stop-playback') {
    handleStop();
  }
});

// --- Tab close cleanup ---

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId) {
    console.log('[SW] PDF tab closed, saving position');
    saveCurrentPosition();
    resetState();
    broadcastStatus();
    stopKeepAlive();
  }
});

// --- Initialization ---

(async () => {
  const data = await chrome.storage.local.get(
    ['speed', 'voice']
  );
  if (data.speed) state.speed = data.speed;
  if (data.voice) state.voice = data.voice;

  const settings = await getSettings();
  if (settings.serverUrl) {
    tts = new TtsClient(settings.serverUrl);
  }

  await cleanExpiredPositions();

  const online = await tts.checkHealth();
  broadcastServerStatus(online);
  console.log(
    `[SW] Initialized. Server ${online ? 'online' : 'offline'}`
    + ` | speed=${state.speed}x | voice=${state.voice}`
  );
})();
