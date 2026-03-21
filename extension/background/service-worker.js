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
  pendingAudio: null,
  error: null,
  sections: [],
  chunkSectionMap: [],
};

let _positionSaveTimer = null;
let _serverRetryTimer = null;
let _serverRetryCount = 0;
let _pendingResumeChunk = null;

function resetState() {
  state.status = STATUS.IDLE;
  state.pdfUrl = null;
  state.tabId = null;
  state.chunks = [];
  state.currentChunk = 0;
  state.totalChunks = 0;
  state.pendingAudio = null;
  state.error = null;
  state.sections = [];
  state.chunkSectionMap = [];
  _pendingResumeChunk = null;
  stopPositionSave();
  stopServerRetry();
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

  state.tabId = tab.id;
  state.pdfUrl = tab.url;
  state.status = STATUS.EXTRACTING;
  state.error = null;
  broadcastStatus();

  try {
    const result = await extractText(tab.url);
    const { fullText, sections, sectionCharOffsets } = result;

    if (!fullText || !fullText.trim()) {
      setError(
        'no_text',
        'No text found in this PDF. It may be scanned.'
      );
      return;
    }

    const sentences = splitIntoSentences(fullText);
    state.chunks = groupIntoChunks(sentences);
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

async function fetchAndSendChunk(index) {
  if (index >= state.totalChunks) {
    console.log('[SW] All chunks played');
    if (state.pdfUrl) clearPosition(state.pdfUrl);
    resetState();
    broadcastStatus();
    stopKeepAlive();
    return;
  }

  const text = state.chunks[index];
  console.log(
    `[SW] Fetching chunk ${index + 1}/${state.totalChunks}`
    + ` (${text.length} chars)`
  );

  try {
    let audioBase64;

    if (state.pendingAudio
      && index === state.currentChunk + 1) {
      audioBase64 = state.pendingAudio;
      state.pendingAudio = null;
    } else {
      audioBase64 = await tts.synthesize(text, {
        voice: state.voice,
        speed: state.speed,
      });
    }

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

    prefetchNext(index + 1);
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

async function prefetchNext(index) {
  if (index >= state.totalChunks) return;

  try {
    state.pendingAudio = await tts.synthesize(
      state.chunks[index],
      { voice: state.voice, speed: state.speed }
    );
    console.log(`[SW] Pre-fetched chunk ${index + 1}`);
  } catch (err) {
    console.warn(
      '[SW] Pre-fetch failed (non-fatal):', err.message
    );
    state.pendingAudio = null;
  }
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
  state.pendingAudio = null;
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
  state.pendingAudio = null;
  const prev = Math.max(state.currentChunk - 1, 0);
  fetchAndSendChunk(prev);
}

function handleSetSpeed(speed) {
  state.speed = speed;
  state.pendingAudio = null;
  chrome.storage.local.set({ speed });
  broadcastStatus();
  console.log(`[SW] Speed set to ${speed}x`);
}

function handleSetVoice(voice) {
  state.voice = voice;
  state.pendingAudio = null;
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
  state.pendingAudio = null;
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
