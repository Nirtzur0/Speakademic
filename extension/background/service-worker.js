import {
  MSG,
  STATUS,
  DEFAULT_VOICE,
  DEFAULT_SPEED,
  SERVER_URL,
  CLOUD_SERVER_URL,
  TTS_MODE,
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
  getTtsMode,
  saveTtsMode,
} from '../utils/storage.js';
import {
  buildSectionProgressSegments,
} from '../utils/section-progress.js';
import {
  formatResumePrompt,
} from '../utils/resume-copy.js';
import {
  login as authLogin,
  logout as authLogout,
  isLoggedIn,
  getUserProfile,
  getAuthHeaders,
  onAuthStateChanged,
} from '../utils/auth-client.js';
import {
  getSubscriptionStatus,
  createCheckout,
  getPortalUrl,
  clearCache as clearSubCache,
} from '../utils/subscription-client.js';
import {
  EquationeerClient,
} from '../utils/equationeer-client.js';
import {
  getCuratedVoices,
  normalizeVoice,
} from '../utils/voice-catalog.js';

let tts = new TtsClient();
let _currentTtsMode = TTS_MODE.CLOUD;
let _availableVoices = [];
let _curatedVoices = [];
const equationeer = new EquationeerClient();

// Cache health check result for 30s to avoid repeated round-trips
let _healthCache = { online: false, ts: 0 };
const HEALTH_CACHE_TTL = 30000;

async function cachedHealthCheck() {
  if (Date.now() - _healthCache.ts < HEALTH_CACHE_TTL) {
    return _healthCache.online;
  }
  const online = await tts.checkHealth();
  _healthCache = { online, ts: Date.now() };
  return online;
}

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
  progressSections: [],
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
  state.progressSections = [];
  state.equationMode = 'skip';
  clearAudioBuffer();
  _pendingResumeChunk = null;
  stopPositionSave();
  stopServerRetry();
  equationeer.closeThread();
}

function clearAudioBuffer() {
  audioBuffer.clear();
  if (_prefetchAbort) {
    _prefetchAbort.abort();
    _prefetchAbort = null;
  }
}

function getCurrentSectionIndex() {
  const idx = state.chunkSectionMap[state.currentChunk];
  if (idx !== undefined && state.sections[idx]) {
    return idx;
  }
  return -1;
}

function getCurrentSection() {
  const idx = getCurrentSectionIndex();
  if (idx !== -1) {
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
    progressSections: state.progressSections,
    currentSectionIndex: getCurrentSectionIndex(),
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

async function showOverlayForTab(tab) {
  if (!tab?.id) return;

  try {
    await injectContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: MSG.SHOW_OVERLAY,
      payload: {},
    });
  } catch (err) {
    console.error('[SW] Show overlay failed:', err.message);
  }
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
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith('.pdf')) return true;

    // arxiv.org/pdf/<id> serves actual PDF files
    if ((u.hostname === 'arxiv.org'
      || u.hostname === 'www.arxiv.org')
      && path.startsWith('/pdf/')) {
      return true;
    }
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
    // 25s timeout: allows 8s for SPA content to render + margin
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(
        'Web text extraction timed out.'
        + ' The page may not contain readable content.'
      ));
    }, 25000);

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
        'content/site-adapters.js',
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

// --- PDF extraction via offscreen document ---

async function extractPdfText(url) {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification:
        'PDF text extraction requires Web Workers (pdf.js)',
    });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(
        'PDF extraction timed out.'
        + ' The file may be too large or inaccessible.'
      ));
    }, 30000);

    function listener(msg) {
      if (msg.type !== 'PDF_EXTRACTED') return;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      if (msg.error) {
        const err = new Error(msg.error.message);
        err.code = msg.error.code;
        reject(err);
      } else {
        resolve(msg.result);
      }
    }

    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ type: 'EXTRACT_PDF', url });
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
        'content/icons.js',
        'content/outline-placement.js',
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

  // Run health check and file access check in parallel
  const healthPromise = cachedHealthCheck();
  const fileCheckPromise = tab.url.startsWith('file://')
    ? chrome.extension.isAllowedFileSchemeAccess()
    : Promise.resolve(true);

  let [online, fileAllowed] = await Promise.all([
    healthPromise, fileCheckPromise,
  ]);

  if (!online) {
    _healthCache.ts = 0; // bust cache
    await rebuildTtsClient();
    online = await tts.checkHealth();
    _healthCache = { online, ts: Date.now() };
  }
  broadcastServerStatus(online);

  if (!online) {
    setError('server_offline',
      'TTS server not available.'
      + ' Make sure a local TTS server is running'
      + ' (e.g. Kokoro on localhost:8880).');
    return;
  }

  if (!fileAllowed) {
    setError('file_access',
      'File access not enabled. Go to chrome://extensions,'
      + ' find Speakademic, and enable'
      + ' "Allow access to file URLs".');
    return;
  }

  state.tabId = tab.id;
  state.pdfUrl = tab.url;
  state.status = STATUS.EXTRACTING;
  state.error = null;
  broadcastStatus();

  try {
    // Start overlay injection early (in parallel with extraction)
    const overlayPromise = injectContentScript(tab.id)
      .catch((err) => {
        console.warn('[SW] Early overlay inject failed:', err.message);
      });

    // Start settings + position fetch early (parallel with extraction)
    const settingsPromise = getSettings();

    let result;
    if (isPdfUrl(tab.url)) {
      result = await extractPdfText(tab.url);
    } else {
      try {
        result = await extractWebText(tab.id);
      } catch (webErr) {
        console.warn(
          '[SW] Web extraction failed, trying PDF fallback:',
          webErr.message
        );
        try {
          result = await extractPdfText(tab.url);
        } catch {
          throw webErr;
        }
      }
    }

    const {
      fullText, sections, sectionCharOffsets, meta,
    } = result;

    if (!fullText || !fullText.trim()) {
      let msg;
      if (meta?.source === 'web') {
        msg = 'No readable article content found on this page.';
      } else if (meta?.isLikelyScanned) {
        msg = 'This PDF appears to be scanned/image-based.'
          + ' Text extraction is not possible.';
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
    state.progressSections = buildSectionProgressSegments(
      state.sections,
      state.chunkSectionMap,
      state.totalChunks
    );

    console.log(
      `[SW] ${state.totalChunks} chunks prepared`
      + ` (${state.sections.length} sections)`
    );

    // Wait for overlay injection to finish before sending chunks
    await overlayPromise;

    const settings = await settingsPromise;
    state.equationMode = settings.equationMode || 'skip';

    // Initialize Equationeer if enabled (don't await — non-blocking)
    if (state.equationMode === 'explain') {
      equationeer.isHealthy().then(async (healthy) => {
        if (healthy) {
          try {
            await equationeer.createThread(
              meta?.title || '', meta?.abstract || ''
            );
            console.log('[SW] Equationeer thread started');
          } catch (err) {
            console.warn('[SW] Equationeer init failed:', err.message);
            state.equationMode = 'skip';
          }
        } else {
          state.equationMode = 'skip';
        }
      }).catch(() => { state.equationMode = 'skip'; });
    }

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
            message: formatResumePrompt(
              sectionName,
              saved.chunkIndex,
              state.totalChunks
            ),
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

  let text = state.chunks[index];

  // Handle equation chunks (supports both [equation] and [equation:raw_text])
  const hasEquation = /\[equation(?::[^\]]*?)?\]/.test(text);
  if (hasEquation && state.equationMode === 'explain'
    && equationeer.threadId) {
    text = await _resolveEquationChunk(text, index);
  } else if (hasEquation) {
    // Skip mode: remove equation markers
    text = text.replace(/\[equation(?::[^\]]*?)?\]/g, '').trim();
    if (!text) {
      // Pure equation chunk with nothing else — generate tiny silence
      text = '...';
    }
  }

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

/**
 * Replace [equation:...] markers in a chunk with AI-generated narrations.
 * Extracts raw equation text from the marker and passes it to Equationeer
 * along with surrounding prose context.
 */
async function _resolveEquationChunk(text, index) {
  const sectionIdx = state.chunkSectionMap[index];
  const section = state.sections[sectionIdx] || '';

  const eqStripRe = /\[equation(?::[^\]]*?)?\]/g;

  // Get pre/post context from surrounding chunks
  const preContext = index > 0
    ? state.chunks[index - 1].replace(eqStripRe, '').slice(-200)
    : '';
  const postContext = index < state.totalChunks - 1
    ? state.chunks[index + 1].replace(eqStripRe, '').slice(0, 200)
    : '';

  // Parse the chunk into alternating prose / equation-marker segments
  const eqMarkerRe = /\[equation(?::([^\]]*?))?\]/g;
  const resolved = [];
  let lastIndex = 0;
  let match;

  while ((match = eqMarkerRe.exec(text)) !== null) {
    // Prose before this marker
    const prose = text.slice(lastIndex, match.index).trim();
    if (prose) resolved.push(prose);
    lastIndex = match.index + match[0].length;

    // Raw equation content (may be LaTeX, glyph chars, or empty)
    const rawEquation = (match[1] || '').trim();

    try {
      const narration = await equationeer.explainEquation(
        rawEquation || '(equation from document)',
        preContext + ' ' + prose,
        text.slice(lastIndex).replace(eqStripRe, '').trim().slice(0, 200)
          || postContext,
        section
      );
      if (narration) {
        resolved.push(narration);
      }
    } catch (err) {
      console.warn(
        `[SW] Equation explanation failed:`, err.message
      );
      // Silently skip on failure
    }
  }

  // Trailing prose after last marker
  const trailing = text.slice(lastIndex).trim();
  if (trailing) resolved.push(trailing);

  return resolved.join(' ') || '...';
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

    // Use fetchAudio which handles equation resolution
    fetchAudio(idx).then(() => {
      if (state.status === STATUS.IDLE) return;
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
    // Start prefetching next chunks while current one synthesizes
    fillBuffer(index + 1);

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
  } catch (err) {
    console.error('[SW] Chunk fetch failed:', err.message);

    if (err.code === 'auth_expired') {
      setError(
        'auth_expired',
        'Session expired. Please sign in again.'
      );
      return;
    }

    if (err.code === 'quota_exceeded') {
      setError(
        'quota_exceeded',
        'Usage limit reached. Upgrade for more.'
      );
      return;
    }

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
  const nextVoice = normalizeVoice(
    voice,
    _availableVoices.length > 0 ? _availableVoices : null
  );
  if (nextVoice !== voice) {
    console.warn(
      `[SW] Unsupported voice "${voice}", using ${nextVoice}`
    );
  }
  state.voice = nextVoice;
  clearAudioBuffer();
  chrome.storage.local.set({ voice: nextVoice });
  broadcastStatus();
  console.log(`[SW] Voice set to ${nextVoice}`);
}

async function refreshVoiceCatalog({
  shouldBroadcast = true,
} = {}) {
  const voices = await tts.getVoices();
  _availableVoices = Array.isArray(voices) ? voices : [];
  _curatedVoices = getCuratedVoices(_availableVoices);

  const nextVoice = normalizeVoice(
    state.voice,
    _availableVoices
  );
  if (nextVoice !== state.voice) {
    state.voice = nextVoice;
    await chrome.storage.local.set({ voice: nextVoice });
    if (shouldBroadcast) {
      broadcastStatus();
    }
    console.log(
      `[SW] Voice reset to ${nextVoice} after catalog refresh`
    );
  }

  return _curatedVoices;
}

async function handleGetVoices(sendResponse) {
  try {
    const voices = await refreshVoiceCatalog();
    sendResponse({ voices });
  } catch (err) {
    console.error('[SW] Failed to get voices:', err.message);
    sendResponse({
      voices: _availableVoices.length > 0 ? _curatedVoices : [],
    });
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
  const nextSettings = { ...newSettings };
  if (nextSettings.defaultVoice) {
    nextSettings.defaultVoice = normalizeVoice(
      nextSettings.defaultVoice,
      _availableVoices.length > 0 ? _availableVoices : null
    );
  }

  const settings = await saveSettings(nextSettings);
  if (_currentTtsMode === TTS_MODE.LOCAL
    && settings.serverUrl) {
    tts = new TtsClient(settings.serverUrl);
  }
  sendResponse(settings);
}

async function rebuildTtsClient() {
  const mode = await getTtsMode();
  _currentTtsMode = mode;

  if (mode === TTS_MODE.CLOUD) {
    tts = new TtsClient(CLOUD_SERVER_URL, getAuthHeaders);
    console.log('[SW] TTS mode: cloud');

    // If cloud is unreachable, silently fall back to local
    const cloudOk = await tts.checkHealth();
    if (!cloudOk) {
      const settings = await getSettings();
      const localUrl = settings.serverUrl || SERVER_URL;
      const localTts = new TtsClient(localUrl);
      const localOk = await localTts.checkHealth();
      if (localOk) {
        tts = localTts;
        _currentTtsMode = TTS_MODE.LOCAL;
        console.log(
          '[SW] Cloud unavailable, fell back to local TTS at',
          localUrl
        );
      } else {
        console.warn(
          '[SW] Both cloud and local TTS unavailable'
        );
      }
    }
  } else {
    const settings = await getSettings();
    tts = new TtsClient(settings.serverUrl);
    console.log('[SW] TTS mode: local');
  }

  try {
    await refreshVoiceCatalog({ shouldBroadcast: false });
  } catch (err) {
    _availableVoices = [];
    _curatedVoices = [];
    state.voice = normalizeVoice(state.voice);
    await chrome.storage.local.set({ voice: state.voice });
    console.warn('[SW] Voice catalog unavailable:', err.message);
  }
}

async function handleLogin(sendResponse) {
  try {
    const user = await authLogin();
    await rebuildTtsClient();
    sendResponse({ ok: true, user });
  } catch (err) {
    console.error('[SW] Login failed:', err.message);
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleLogout(sendResponse) {
  await authLogout();
  clearSubCache();
  // Stay in cloud mode — rebuild client without auth headers
  tts = new TtsClient(CLOUD_SERVER_URL);
  sendResponse({ ok: true });
}

async function handleAuthState(sendResponse) {
  const loggedIn = await isLoggedIn();
  const user = loggedIn ? await getUserProfile() : null;
  const sub = loggedIn
    ? await getSubscriptionStatus().catch(() => null)
    : null;
  sendResponse({
    loggedIn,
    user,
    subscription: sub,
    ttsMode: _currentTtsMode,
  });
}

async function handleSetTtsMode(mode, sendResponse) {
  if (mode === TTS_MODE.CLOUD) {
    const loggedIn = await isLoggedIn();
    if (!loggedIn) {
      sendResponse({
        ok: false,
        error: 'Sign in to use cloud TTS',
      });
      return;
    }
  }
  await saveTtsMode(mode);
  await rebuildTtsClient();
  sendResponse({ ok: true, ttsMode: _currentTtsMode });
}

async function handleUpgrade(sendResponse, priceId) {
  try {
    const pid = priceId || '__STRIPE_PRO_PRICE_ID__';
    const url = await createCheckout(pid);
    if (url) chrome.tabs.create({ url });
    sendResponse({ ok: true });
  } catch (err) {
    console.error('[SW] Upgrade failed:', err.message);
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleManageSubscription(sendResponse) {
  try {
    const url = await getPortalUrl();
    if (url) chrome.tabs.create({ url });
    sendResponse({ ok: true });
  } catch (err) {
    console.error('[SW] Manage sub failed:', err.message);
    sendResponse({ ok: false, error: err.message });
  }
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

      case MSG.LOGIN:
        handleLogin(sendResponse);
        return true;

      case MSG.LOGOUT:
        handleLogout(sendResponse);
        return true;

      case MSG.AUTH_STATE:
        handleAuthState(sendResponse);
        return true;

      case MSG.SET_TTS_MODE:
        handleSetTtsMode(msg.payload.mode, sendResponse);
        return true;

      case MSG.UPGRADE:
        handleUpgrade(sendResponse, msg.payload?.priceId);
        return true;

      case MSG.MANAGE_SUBSCRIPTION:
        handleManageSubscription(sendResponse);
        return true;

      case MSG.SUBSCRIPTION_STATUS:
        getSubscriptionStatus(true).then((status) => {
          sendResponse(status);
        }).catch(() => sendResponse(null));
        return true;

      case MSG.HEARTBEAT:
        break;

      case MSG.SERVER_STATUS:
        tts.checkHealth().then((online) => {
          sendResponse({ online });
        });
        return true;

      case MSG.SHOW_OVERLAY:
        if (msg.tabId) {
          chrome.tabs.get(msg.tabId, (tab) => {
            if (!chrome.runtime.lastError && tab) {
              showOverlayForTab(tab);
            }
          });
        }
        break;

      case MSG.STATUS_UPDATE:
        sendResponse({
          status: state.status,
          currentChunk: state.currentChunk,
          totalChunks: state.totalChunks,
          error: state.error,
          sections: state.sections,
          progressSections: state.progressSections,
          currentSectionIndex: getCurrentSectionIndex(),
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

// Popup handles action click; keep listener for programmatic fallback
chrome.action.onClicked.addListener((tab) => {
  showOverlayForTab(tab);
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
  if (data.voice) {
    state.voice = normalizeVoice(data.voice);
  }

  await rebuildTtsClient();
  await cleanExpiredPositions();

  const online = await tts.checkHealth();
  broadcastServerStatus(online);

  const loggedIn = await isLoggedIn();
  console.log(
    `[SW] Initialized. Server ${online ? 'online' : 'offline'}`
    + ` | mode=${_currentTtsMode}`
    + ` | auth=${loggedIn}`
    + ` | speed=${state.speed}x | voice=${state.voice}`
  );
})();
