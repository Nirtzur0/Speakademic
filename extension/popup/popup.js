import { MSG, STATUS } from '../utils/constants.js';

const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const btnSkipBack = document.getElementById('btn-skip-back');
const btnSkipFwd = document.getElementById('btn-skip-fwd');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const serverText = document.getElementById('server-text');
const progressSection = document.getElementById('progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const timeRemaining = document.getElementById('time-remaining');
const errorEl = document.getElementById('error');
const pdfInfo = document.getElementById('pdf-info');
const pdfTitle = document.getElementById('pdf-title');
const sectionInfo = document.getElementById('section-info');
const currentSectionEl =
  document.getElementById('current-section');
const sectionNav = document.getElementById('section-nav');
const sectionSelect =
  document.getElementById('section-select');

function send(type, payload = {}) {
  chrome.runtime.sendMessage({ type, payload });
}

function extractPdfName(url) {
  if (!url) return '';
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').pop() || '';
    return decodeURIComponent(
      name.replace('.pdf', '').replace(/[_-]/g, ' ')
    );
  } catch {
    return url.slice(0, 50);
  }
}

function estimateTimeRemaining(current, total) {
  if (total <= 0 || current >= total) return '';
  const remaining = total - current;
  const secsPerChunk = 8;
  const totalSecs = remaining * secsPerChunk;
  if (totalSecs < 60) return `~${totalSecs}s left`;
  const mins = Math.ceil(totalSecs / 60);
  return `~${mins}m left`;
}

function updateUI(state) {
  const isIdle = state.status === STATUS.IDLE;
  const isPlaying = state.status === STATUS.PLAYING;
  const isPaused = state.status === STATUS.PAUSED;
  const isLoading = state.status === STATUS.LOADING
    || state.status === STATUS.EXTRACTING;
  const isError = state.status === STATUS.ERROR;
  const isActive = isPlaying || isPaused;

  btnPlay.disabled = isPlaying || isLoading;
  btnPause.disabled = !isPlaying;
  btnStop.disabled = isIdle || isError;
  btnSkipBack.disabled = !isActive;
  btnSkipFwd.disabled = !isActive;

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

  if (state.pdfUrl && !isIdle) {
    pdfInfo.hidden = false;
    pdfTitle.textContent = extractPdfName(state.pdfUrl);
  } else {
    pdfInfo.hidden = true;
  }

  if (state.totalChunks > 0) {
    progressSection.hidden = false;
    const current = state.currentChunk + 1;
    const pct = (current / state.totalChunks) * 100;
    progressFill.style.width = pct + '%';
    progressText.textContent =
      `${current} / ${state.totalChunks}`;
    timeRemaining.textContent = estimateTimeRemaining(
      state.currentChunk, state.totalChunks
    );
  } else {
    progressSection.hidden = true;
  }

  if (state.currentSection) {
    sectionInfo.hidden = false;
    currentSectionEl.textContent = state.currentSection;
  } else {
    sectionInfo.hidden = true;
  }

  if (state.sections && state.sections.length > 0
    && !isIdle) {
    sectionNav.hidden = false;
    populateSections(state.sections);
  } else {
    sectionNav.hidden = true;
  }

  if (state.error) {
    errorEl.hidden = false;
    errorEl.textContent = state.error.message;
  } else {
    errorEl.hidden = true;
  }
}

function populateSections(sections) {
  const current = sectionSelect.value;
  if (sectionSelect.options.length > 1
    && current === '') return;

  sectionSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Jump to section...';
  sectionSelect.append(def);

  for (let i = 0; i < sections.length; i++) {
    if (sections[i].isReferences) continue;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = sections[i].title;
    sectionSelect.append(opt);
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
btnSkipBack.addEventListener('click', () => {
  send(MSG.SKIP_BACK);
});
btnSkipFwd.addEventListener('click', () => {
  send(MSG.SKIP_FORWARD);
});

sectionSelect.addEventListener('change', () => {
  const idx = parseInt(sectionSelect.value, 10);
  if (!isNaN(idx)) {
    send(MSG.JUMP_TO_SECTION, { sectionIndex: idx });
  }
  sectionSelect.value = '';
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.STATUS_UPDATE) {
    updateUI(msg.payload);
  } else if (msg.type === MSG.SERVER_STATUS) {
    updateServerStatus(msg.payload.online);
  }
});

send(MSG.STATUS_UPDATE);
