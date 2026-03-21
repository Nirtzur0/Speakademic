(function() {
  'use strict';

  if (window._kokoroOverlayLoaded) return;
  window._kokoroOverlayLoaded = true;

  const MSG = {
    PLAY: 'PLAY',
    PAUSE: 'PAUSE',
    STOP: 'STOP',
    SKIP_FORWARD: 'SKIP_FORWARD',
    SKIP_BACK: 'SKIP_BACK',
    SET_SPEED: 'SET_SPEED',
    SET_VOICE: 'SET_VOICE',
    GET_VOICES: 'GET_VOICES',
    JUMP_TO_SECTION: 'JUMP_TO_SECTION',
    CHUNK_READY: 'CHUNK_READY',
    RESUME_PROMPT: 'RESUME_PROMPT',
    RESUME_ACCEPT: 'RESUME_ACCEPT',
    RESUME_DECLINE: 'RESUME_DECLINE',
    HEARTBEAT: 'HEARTBEAT',
    STATUS_UPDATE: 'STATUS_UPDATE',
    SERVER_STATUS: 'SERVER_STATUS',
  };

  const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

  const VOICE_PREFIXES = {
    af: 'American Female',
    am: 'American Male',
    bf: 'British Female',
    bm: 'British Male',
  };

  let _isMinimized = false;
  let _isDragging = false;
  let _dragOffset = { x: 0, y: 0 };
  let _status = 'idle';
  let _currentChunk = 0;
  let _totalChunks = 0;
  let _speed = 1.0;
  let _voice = 'af_bella';

  let _root;
  let _panel;
  let _minimizedBtn;
  let _playPauseBtn;
  let _stopBtn;
  let _skipBackBtn;
  let _skipFwdBtn;
  let _progressFill;
  let _progressText;
  let _textDisplay;
  let _speedSelect;
  let _voiceSelect;
  let _sectionSelect;
  let _sectionCurrent;

  function send(type, payload = {}) {
    chrome.runtime.sendMessage({ type, payload });
  }

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        e.setAttribute(k, v);
      }
    }
    return e;
  }

  function createOverlay() {
    _root = el('div', 'kokoro-reader kokoro-reader--hidden', {
      'data-kokoro-role': 'player',
    });

    _panel = el('div', 'kokoro-reader__panel');
    _minimizedBtn = el('button',
      'kokoro-reader__minimized kokoro-reader__minimized--hidden'
    );
    _minimizedBtn.innerHTML = '&#9654;';
    _minimizedBtn.title = 'Expand player';
    _minimizedBtn.addEventListener('click', handleExpand);

    // Header
    const header = el('div', 'kokoro-reader__header');
    const title = el('span', 'kokoro-reader__title');
    title.textContent = 'Kokoro Reader';
    const minBtn = el('button', 'kokoro-reader__minimize-btn');
    minBtn.innerHTML = '&#8722;';
    minBtn.title = 'Minimize';
    minBtn.addEventListener('click', handleMinimize);
    header.append(title, minBtn);
    initDrag(header);

    // Controls
    const controls = el('div', 'kokoro-reader__controls');
    _skipBackBtn = createBtn('&#9664;&#9664;', 'Skip back');
    _skipBackBtn.addEventListener('click', () => {
      send(MSG.SKIP_BACK);
    });
    _playPauseBtn = createBtn('&#9654;', 'Play',
      'kokoro-reader__btn--play');
    _playPauseBtn.addEventListener('click', handlePlayPause);
    _stopBtn = createBtn('&#9632;', 'Stop');
    _stopBtn.addEventListener('click', () => send(MSG.STOP));
    _skipFwdBtn = createBtn('&#9654;&#9654;', 'Skip forward');
    _skipFwdBtn.addEventListener('click', () => {
      send(MSG.SKIP_FORWARD);
    });
    controls.append(
      _skipBackBtn, _playPauseBtn, _stopBtn, _skipFwdBtn
    );

    // Progress
    const progress = el('div', 'kokoro-reader__progress');
    const bar = el('div', 'kokoro-reader__progress-bar');
    _progressFill = el('div', 'kokoro-reader__progress-fill');
    bar.append(_progressFill);
    _progressText = el('div', 'kokoro-reader__progress-text');
    _progressText.textContent = '0 / 0';
    progress.append(bar, _progressText);

    // Text display
    _textDisplay = el('div', 'kokoro-reader__text-display');
    _textDisplay.textContent = '';

    // Settings
    const settings = el('div', 'kokoro-reader__settings');

    const speedSetting = el('div', 'kokoro-reader__setting');
    const speedLabel = el('span',
      'kokoro-reader__setting-label');
    speedLabel.textContent = 'Speed';
    _speedSelect = el('select');
    for (const s of SPEED_OPTIONS) {
      const opt = el('option');
      opt.value = s;
      opt.textContent = s + 'x';
      if (s === _speed) opt.selected = true;
      _speedSelect.append(opt);
    }
    _speedSelect.addEventListener('change', () => {
      const val = parseFloat(_speedSelect.value);
      _speed = val;
      send(MSG.SET_SPEED, { speed: val });
    });
    speedSetting.append(speedLabel, _speedSelect);

    const voiceSetting = el('div', 'kokoro-reader__setting');
    const voiceLabel = el('span',
      'kokoro-reader__setting-label');
    voiceLabel.textContent = 'Voice';
    _voiceSelect = el('select');
    const defaultOpt = el('option');
    defaultOpt.value = _voice;
    defaultOpt.textContent = _voice;
    _voiceSelect.append(defaultOpt);
    _voiceSelect.addEventListener('change', () => {
      _voice = _voiceSelect.value;
      send(MSG.SET_VOICE, { voice: _voice });
    });
    voiceSetting.append(voiceLabel, _voiceSelect);

    settings.append(speedSetting, voiceSetting);

    // Sections
    const sectionsWrap = el('div', 'kokoro-reader__sections');
    const secLabel = el('div',
      'kokoro-reader__section-label');
    secLabel.textContent = 'Section';
    _sectionCurrent = el('div',
      'kokoro-reader__section-current');
    _sectionCurrent.textContent = '\u2014';
    _sectionSelect = el('select',
      'kokoro-reader__section-select');
    const secDefault = el('option');
    secDefault.value = '';
    secDefault.textContent = 'Jump to section...';
    _sectionSelect.append(secDefault);
    _sectionSelect.addEventListener('change', () => {
      const idx = parseInt(_sectionSelect.value, 10);
      if (!isNaN(idx)) {
        send(MSG.JUMP_TO_SECTION, { sectionIndex: idx });
      }
      _sectionSelect.value = '';
    });
    sectionsWrap.append(secLabel, _sectionCurrent,
      _sectionSelect);

    _panel.append(header, controls, progress, _textDisplay,
      settings, sectionsWrap);
    _root.append(_panel, _minimizedBtn);
    document.body.appendChild(_root);
  }

  function createBtn(html, title, extraClass) {
    const cls = 'kokoro-reader__btn'
      + (extraClass ? ' ' + extraClass : '');
    const btn = el('button', cls);
    btn.innerHTML = html;
    btn.title = title;
    return btn;
  }

  function handlePlayPause() {
    const type = _status === 'playing'
      ? MSG.PAUSE : MSG.PLAY;
    send(type);
  }

  function handleMinimize() {
    _isMinimized = true;
    _panel.classList.add('kokoro-reader__panel--hidden');
    _minimizedBtn.classList.remove(
      'kokoro-reader__minimized--hidden'
    );
  }

  function handleExpand() {
    _isMinimized = false;
    _panel.classList.remove('kokoro-reader__panel--hidden');
    _minimizedBtn.classList.add(
      'kokoro-reader__minimized--hidden'
    );
  }

  function initDrag(header) {
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      _isDragging = true;
      const rect = _root.getBoundingClientRect();
      _dragOffset.x = e.clientX - rect.left;
      _dragOffset.y = e.clientY - rect.top;
      _root.style.bottom = 'auto';
      _root.style.right = 'auto';
      _root.style.left = rect.left + 'px';
      _root.style.top = rect.top + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!_isDragging) return;
      _root.style.left =
        (e.clientX - _dragOffset.x) + 'px';
      _root.style.top =
        (e.clientY - _dragOffset.y) + 'px';
    });

    document.addEventListener('mouseup', () => {
      _isDragging = false;
    });
  }

  function updateOverlay(state) {
    _status = state.status;
    _currentChunk = state.currentChunk || 0;
    _totalChunks = state.totalChunks || 0;

    const isIdle = _status === 'idle';
    const isPlaying = _status === 'playing';
    const isPaused = _status === 'paused';
    const isActive = !isIdle && _status !== 'error';

    if (isIdle) {
      _root.classList.add('kokoro-reader--hidden');
      return;
    }
    _root.classList.remove('kokoro-reader--hidden');

    _playPauseBtn.innerHTML = isPlaying
      ? '&#9646;&#9646;' : '&#9654;';
    _playPauseBtn.title = isPlaying ? 'Pause' : 'Play';

    _skipBackBtn.disabled = !isActive;
    _skipFwdBtn.disabled = !isActive;
    _stopBtn.disabled = !isActive;
    _playPauseBtn.disabled =
      _status === 'extracting' || _status === 'loading';

    if (_totalChunks > 0) {
      const pct = ((_currentChunk + 1) / _totalChunks) * 100;
      _progressFill.style.width = pct + '%';
      _progressText.textContent =
        (_currentChunk + 1) + ' / ' + _totalChunks;
    } else {
      _progressFill.style.width = '0%';
      _progressText.textContent =
        _status === 'extracting'
          ? 'Extracting text...'
          : 'Loading...';
    }

    if (state.currentSection) {
      _sectionCurrent.textContent = state.currentSection;
    }

    if (state.speed && state.speed !== _speed) {
      _speed = state.speed;
      _speedSelect.value = _speed;
    }

    if (state.voice && state.voice !== _voice) {
      _voice = state.voice;
      _voiceSelect.value = _voice;
    }

    if (state.sections && state.sections.length > 0) {
      populateSections(state.sections);
    }
  }

  function populateSections(sections) {
    const current = _sectionSelect.value;
    _sectionSelect.innerHTML = '';
    const defaultOpt = el('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Jump to section...';
    _sectionSelect.append(defaultOpt);

    for (let i = 0; i < sections.length; i++) {
      if (sections[i].isReferences) continue;
      const opt = el('option');
      opt.value = i;
      opt.textContent = sections[i].title;
      _sectionSelect.append(opt);
    }
    _sectionSelect.value = current;
  }

  function populateVoices(voices) {
    _voiceSelect.innerHTML = '';
    const groups = {};

    for (const v of voices) {
      const prefix = v.substring(0, 2);
      const groupName = VOICE_PREFIXES[prefix] || 'Other';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(v);
    }

    for (const [group, voiceList] of Object.entries(groups)) {
      const optgroup = el('optgroup');
      optgroup.label = group;
      for (const v of voiceList) {
        const opt = el('option');
        opt.value = v;
        const name = v.substring(3).replace(/_/g, ' ');
        opt.textContent = name.charAt(0).toUpperCase()
          + name.slice(1);
        if (v === _voice) opt.selected = true;
        optgroup.append(opt);
      }
      _voiceSelect.append(optgroup);
    }
  }

  function showResumePrompt(payload) {
    _root.classList.remove('kokoro-reader--hidden');
    const pct = Math.round(
      (payload.chunkIndex / payload.totalChunks) * 100
    );
    _textDisplay.textContent =
      `Resume from "${payload.section}" (${pct}% through)?`;

    _playPauseBtn.innerHTML = '&#9654;';
    _playPauseBtn.title = 'Resume';
    _playPauseBtn.disabled = false;
    _playPauseBtn.onclick = () => {
      send(MSG.RESUME_ACCEPT);
      _playPauseBtn.onclick = null;
      _playPauseBtn.addEventListener(
        'click', handlePlayPause
      );
    };

    _stopBtn.disabled = false;
    _stopBtn.onclick = () => {
      send(MSG.RESUME_DECLINE);
      _stopBtn.onclick = null;
    };
  }

  let _heartbeatTimer = null;
  function startHeartbeat() {
    stopHeartbeat();
    _heartbeatTimer = setInterval(() => {
      send(MSG.HEARTBEAT);
    }, 20000);
  }
  function stopHeartbeat() {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.STATUS_UPDATE) {
      updateOverlay(msg.payload);
      if (msg.payload.status === 'playing') {
        startHeartbeat();
      } else {
        stopHeartbeat();
      }
    } else if (msg.type === MSG.CHUNK_READY
      && msg.payload.chunkText) {
      _textDisplay.textContent = msg.payload.chunkText;
      _textDisplay.scrollTop = 0;
    } else if (msg.type === MSG.RESUME_PROMPT) {
      showResumePrompt(msg.payload);
    } else if (msg.type === MSG.SERVER_STATUS) {
      if (!msg.payload.online && _status === 'playing') {
        _textDisplay.textContent =
          'Server disconnected. Retrying...';
      }
    }
  });

  function init() {
    createOverlay();

    chrome.storage.local.get(['speed', 'voice'], (data) => {
      if (data.speed) {
        _speed = data.speed;
        _speedSelect.value = _speed;
      }
      if (data.voice) {
        _voice = data.voice;
      }
    });

    chrome.runtime.sendMessage(
      { type: MSG.GET_VOICES, payload: {} },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.voices) {
          populateVoices(response.voices);
        }
      }
    );

    chrome.runtime.sendMessage(
      { type: MSG.STATUS_UPDATE, payload: {} },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response) updateOverlay(response);
      }
    );
  }

  init();
  console.log('[Overlay] Loaded');
})();
