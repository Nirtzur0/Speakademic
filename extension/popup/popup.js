import { MSG, STATUS } from '../utils/constants.js';

const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const serverText = document.getElementById('server-text');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progress-text');
const errorEl = document.getElementById('error');

function send(type, payload = {}) {
  chrome.runtime.sendMessage({ type, payload });
}

function updateUI(state) {
  const isIdle = state.status === STATUS.IDLE;
  const isPlaying = state.status === STATUS.PLAYING;
  const isPaused = state.status === STATUS.PAUSED;
  const isLoading = state.status === STATUS.LOADING
    || state.status === STATUS.EXTRACTING;
  const isError = state.status === STATUS.ERROR;

  btnPlay.disabled = isPlaying || isLoading;
  btnPause.disabled = !isPlaying;
  btnStop.disabled = isIdle || isError;

  if (isIdle) {
    statusText.textContent = 'Ready';
  } else if (state.status === STATUS.EXTRACTING) {
    statusText.textContent = 'Extracting text...';
  } else if (state.status === STATUS.LOADING) {
    statusText.textContent = 'Loading audio...';
  } else if (isPlaying) {
    statusText.textContent = 'Playing';
  } else if (isPaused) {
    statusText.textContent = 'Paused';
  } else if (isError) {
    statusText.textContent = 'Error';
  }

  if (state.totalChunks > 0) {
    progressEl.hidden = false;
    const current = state.currentChunk + 1;
    progressText.textContent =
      `${current} / ${state.totalChunks}`;
  } else {
    progressEl.hidden = true;
  }

  if (state.error) {
    errorEl.hidden = false;
    errorEl.textContent = state.error.message;
  } else {
    errorEl.hidden = true;
  }
}

function updateServerStatus(online) {
  statusDot.className = online
    ? 'status-dot status-dot--online'
    : 'status-dot status-dot--offline';
  serverText.textContent = online
    ? 'Server online'
    : 'Server offline';
}

btnPlay.addEventListener('click', () => send(MSG.PLAY));
btnPause.addEventListener('click', () => send(MSG.PAUSE));
btnStop.addEventListener('click', () => send(MSG.STOP));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.STATUS_UPDATE) {
    updateUI(msg.payload);
  } else if (msg.type === MSG.SERVER_STATUS) {
    updateServerStatus(msg.payload.online);
  }
});

send(MSG.STATUS_UPDATE);
