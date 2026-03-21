import {
  MSG,
  STATUS,
  DEFAULT_VOICE,
  DEFAULT_SPEED,
  KEEPALIVE_ALARM_NAME,
  KEEPALIVE_INTERVAL_MINUTES,
} from '../utils/constants.js';
import { TtsClient } from '../utils/tts-client.js';
import { extractText } from '../content/pdf-extractor.js';
import {
  splitIntoSentences,
  groupIntoChunks,
} from '../content/sentence-splitter.js';

const tts = new TtsClient();

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
};

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
}

function broadcastStatus() {
  const payload = {
    status: state.status,
    currentChunk: state.currentChunk,
    totalChunks: state.totalChunks,
    error: state.error,
    sections: state.sections,
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
}

function setError(code, message) {
  state.status = STATUS.ERROR;
  state.error = { code, message };
  broadcastStatus();
  stopKeepAlive();
}

function startKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
  });
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['utils/audio-player.js', 'content/content-script.js'],
    });
  } catch (err) {
    console.error(
      '[SW] Content script injection failed:', err.message
    );
    throw err;
  }
}

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
      'Kokoro server not found. Start it with ./start-server.sh'
    );
    return;
  }

  state.tabId = tab.id;
  state.pdfUrl = tab.url;
  state.status = STATUS.EXTRACTING;
  state.error = null;
  broadcastStatus();

  try {
    const { fullText, sections } = await extractText(tab.url);

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

    console.log(
      `[SW] ${state.totalChunks} chunks prepared`
      + ` (${state.sections.length} sections)`
    );

    await injectContentScript(tab.id);

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

async function fetchAndSendChunk(index) {
  if (index >= state.totalChunks) {
    console.log('[SW] All chunks played');
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

    if (state.pendingAudio && index === state.currentChunk) {
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

    chrome.tabs.sendMessage(state.tabId, {
      type: MSG.CHUNK_READY,
      payload: { audioBase64, chunkIndex: index },
    }).catch((err) => {
      console.error(
        '[SW] Failed to send chunk to tab:', err.message
      );
      setError('send_failed', 'Lost connection to PDF tab');
    });

    prefetchNext(index + 1);
  } catch (err) {
    console.error('[SW] Chunk fetch failed:', err.message);
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

  if (state.tabId) {
    chrome.tabs.sendMessage(
      state.tabId,
      { type: MSG.PAUSE, payload: {} }
    ).catch(() => {});
  }
}

function handleStop() {
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

    case MSG.STATUS_UPDATE:
      sendResponse({
        status: state.status,
        currentChunk: state.currentChunk,
        totalChunks: state.totalChunks,
        error: state.error,
        sections: state.sections,
      });
      break;

    default:
      break;
  }

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    console.log('[SW] Keep-alive ping');
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId) {
    console.log('[SW] PDF tab closed, stopping playback');
    resetState();
    broadcastStatus();
    stopKeepAlive();
  }
});

(async () => {
  const online = await tts.checkHealth();
  broadcastServerStatus(online);
  console.log(
    `[SW] Initialized. Server ${online ? 'online' : 'offline'}`
  );
})();
