(function() {
  'use strict';

  if (window._speakademicOverlayLoaded) return;
  window._speakademicOverlayLoaded = true;

  const ICONS = window._spIcons || {};

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
  let _soundBars;

  // Sentence highlighting state
  let _sentenceSpans = [];
  let _sentenceTimings = [];
  let _highlightRAF = null;

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
    _root = el('div', 'sp sp--hidden', {
      'data-sp-role': 'player',
    });

    _panel = el('div', 'sp__panel');
    _minimizedBtn = el('button', 'sp__minimized sp__minimized--hidden');
    _minimizedBtn.title = 'Expand player';
    _minimizedBtn.addEventListener('click', handleExpand);

    // Minimized button content: icon + sound bars + label
    const minIcon = el('span', 'sp__minimized-icon');
    minIcon.innerHTML = ICONS.play || '&#9654;';
    _soundBars = el('span', 'sp__sound-bars');
    for (let i = 0; i < 3; i++) {
      _soundBars.appendChild(el('span', 'sp__sound-bar'));
    }
    const minLabel = el('span');
    minLabel.textContent = 'Speakademic';
    _minimizedBtn.append(minIcon, _soundBars, minLabel);

    // Accent bar at top of panel
    const accentBar = el('div', 'sp__accent-bar');

    // Header
    const header = el('div', 'sp__header');
    const title = el('span', 'sp__title');
    const dot = el('span', 'sp__title-dot');
    title.appendChild(dot);
    title.appendChild(document.createTextNode('Speakademic'));
    const minBtn = el('button', 'sp__minimize-btn');
    minBtn.innerHTML = ICONS.minimize || '&#8722;';
    minBtn.title = 'Minimize';
    minBtn.addEventListener('click', handleMinimize);
    header.append(title, minBtn);
    initDrag(header);

    // Controls
    const controls = el('div', 'sp__controls');
    _skipBackBtn = createBtn(ICONS.skipBack || '&#9664;&#9664;', 'Skip back');
    _skipBackBtn.addEventListener('click', () => {
      send(MSG.SKIP_BACK);
    });
    _playPauseBtn = createBtn(ICONS.play || '&#9654;', 'Play', 'sp__btn--play');
    _playPauseBtn.addEventListener('click', handlePlayPause);
    _stopBtn = createBtn(ICONS.stop || '&#9632;', 'Stop');
    _stopBtn.addEventListener('click', () => send(MSG.STOP));
    _skipFwdBtn = createBtn(ICONS.skipForward || '&#9654;&#9654;', 'Skip forward');
    _skipFwdBtn.addEventListener('click', () => {
      send(MSG.SKIP_FORWARD);
    });
    controls.append(
      _skipBackBtn, _playPauseBtn, _stopBtn, _skipFwdBtn
    );

    // Progress
    const progress = el('div', 'sp__progress');
    const bar = el('div', 'sp__progress-bar');
    _progressFill = el('div', 'sp__progress-fill');
    bar.append(_progressFill);
    _progressText = el('div', 'sp__progress-text');
    _progressText.textContent = '0 / 0';
    progress.append(bar, _progressText);

    // Text display
    _textDisplay = el('div', 'sp__text-display');
    _textDisplay.textContent = '';

    // Settings
    const settings = el('div', 'sp__settings');

    const speedSetting = el('div', 'sp__setting');
    const speedLabel = el('span', 'sp__setting-label');
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

    const voiceSetting = el('div', 'sp__setting');
    const voiceLabel = el('span', 'sp__setting-label');
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
    const sectionsWrap = el('div', 'sp__sections');
    const secLabel = el('div', 'sp__section-label');
    secLabel.textContent = 'Section';
    _sectionCurrent = el('div', 'sp__section-current');
    _sectionCurrent.textContent = '\u2014';
    _sectionSelect = el('select', 'sp__section-select');
    const secDefault = el('option');
    secDefault.value = '';
    secDefault.textContent = 'Jump to section\u2026';
    _sectionSelect.append(secDefault);
    _sectionSelect.addEventListener('change', () => {
      const idx = parseInt(_sectionSelect.value, 10);
      if (!isNaN(idx)) {
        send(MSG.JUMP_TO_SECTION, { sectionIndex: idx });
      }
      _sectionSelect.value = '';
    });
    sectionsWrap.append(secLabel, _sectionCurrent, _sectionSelect);

    _panel.append(accentBar, header, controls, progress,
      _textDisplay, settings, sectionsWrap);
    _root.append(_panel, _minimizedBtn);
    document.body.appendChild(_root);
  }

  function createBtn(html, title, extraClass) {
    const cls = 'sp__btn' + (extraClass ? ' ' + extraClass : '');
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
    _panel.classList.add('sp__panel--exiting');
    setTimeout(() => {
      _panel.classList.add('sp__panel--hidden');
      _panel.classList.remove('sp__panel--exiting');
      _minimizedBtn.classList.remove('sp__minimized--hidden');
    }, 200);
  }

  function handleExpand() {
    _isMinimized = false;
    _minimizedBtn.classList.add('sp__minimized--hidden');
    _panel.classList.remove('sp__panel--hidden');
    // Re-trigger entrance animation
    _panel.style.animation = 'none';
    _panel.offsetHeight; // force reflow
    _panel.style.animation = '';
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

  // ---- Sentence highlighting ----

  function splitIntoSentences(text) {
    if (!text || !text.trim()) return [];
    // Split on sentence-ending punctuation followed by space
    const parts = text.split(/(?<=[.!?])\s+/);
    return parts.filter(s => s.trim().length > 0);
  }

  function renderSentences(sentences) {
    _textDisplay.innerHTML = '';
    _sentenceSpans = [];
    _sentenceTimings = [];

    if (sentences.length === 0) return;

    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    let cumulative = 0;

    for (let i = 0; i < sentences.length; i++) {
      const span = el('span', 'sp__sentence');
      span.textContent = sentences[i] + ' ';
      _textDisplay.appendChild(span);
      _sentenceSpans.push(span);

      const start = cumulative / totalChars;
      cumulative += sentences[i].length;
      const end = cumulative / totalChars;
      _sentenceTimings.push({ start, end });
    }
  }

  function startSentenceTracking() {
    stopSentenceTracking();

    const player = window.SpeakademicAudioPlayer;
    if (!player || !player.getCurrentTime) return;

    function tick() {
      const duration = player.getDuration();
      const current = player.getCurrentTime();

      if (duration > 0 && _sentenceSpans.length > 0) {
        const progress = current / duration;

        for (let i = 0; i < _sentenceSpans.length; i++) {
          const span = _sentenceSpans[i];
          const timing = _sentenceTimings[i];

          span.classList.remove('sp__sentence--active', 'sp__sentence--past');

          if (progress >= timing.start && progress < timing.end) {
            span.classList.add('sp__sentence--active');
            // Auto-scroll active sentence into view
            if (span.offsetTop > _textDisplay.scrollTop + _textDisplay.clientHeight - 20
              || span.offsetTop < _textDisplay.scrollTop) {
              span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else if (progress >= timing.end) {
            span.classList.add('sp__sentence--past');
          }
        }
      }

      if (player.isPlaying()) {
        _highlightRAF = requestAnimationFrame(tick);
      }
    }

    _highlightRAF = requestAnimationFrame(tick);
  }

  function stopSentenceTracking() {
    if (_highlightRAF) {
      cancelAnimationFrame(_highlightRAF);
      _highlightRAF = null;
    }
  }

  // ---- State update ----

  function updateOverlay(state) {
    _status = state.status;
    _currentChunk = state.currentChunk || 0;
    _totalChunks = state.totalChunks || 0;

    const isIdle = _status === 'idle';
    const isPlaying = _status === 'playing';
    const isActive = !isIdle && _status !== 'error';

    if (isIdle) {
      _root.classList.add('sp--hidden');
      stopSentenceTracking();
      return;
    }
    _root.classList.remove('sp--hidden');

    // Play/pause icon
    _playPauseBtn.innerHTML = isPlaying
      ? (ICONS.pause || '&#9646;&#9646;')
      : (ICONS.play || '&#9654;');
    _playPauseBtn.title = isPlaying ? 'Pause' : 'Play';

    _skipBackBtn.disabled = !isActive;
    _skipFwdBtn.disabled = !isActive;
    _stopBtn.disabled = !isActive;
    _playPauseBtn.disabled =
      _status === 'extracting' || _status === 'loading';

    // Progress
    if (_totalChunks > 0) {
      const pct = ((_currentChunk + 1) / _totalChunks) * 100;
      _progressFill.style.width = pct + '%';
      _progressText.textContent =
        (_currentChunk + 1) + ' / ' + _totalChunks;
    } else {
      _progressFill.style.width = '0%';
      _progressText.textContent =
        _status === 'extracting'
          ? 'Extracting text\u2026'
          : 'Loading\u2026';
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

    // Sound bars animation on minimized button
    if (isPlaying) {
      _minimizedBtn.classList.add('sp__minimized--playing');
      startSentenceTracking();
    } else {
      _minimizedBtn.classList.remove('sp__minimized--playing');
      stopSentenceTracking();
    }
  }

  function populateSections(sections) {
    const current = _sectionSelect.value;
    _sectionSelect.innerHTML = '';
    const defaultOpt = el('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Jump to section\u2026';
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
    _root.classList.remove('sp--hidden');
    const pct = Math.round(
      (payload.chunkIndex / payload.totalChunks) * 100
    );
    _textDisplay.textContent =
      'Resume from \u201c' + payload.section + '\u201d (' + pct + '% through)?';

    _playPauseBtn.innerHTML = ICONS.play || '&#9654;';
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
      const sentences = splitIntoSentences(msg.payload.chunkText);
      if (sentences.length > 0) {
        renderSentences(sentences);
        startSentenceTracking();
      } else {
        _textDisplay.textContent = msg.payload.chunkText;
      }
      _textDisplay.scrollTop = 0;
    } else if (msg.type === MSG.RESUME_PROMPT) {
      showResumePrompt(msg.payload);
    } else if (msg.type === MSG.SERVER_STATUS) {
      if (!msg.payload.online && _status === 'playing') {
        _textDisplay.textContent =
          'Server disconnected. Retrying\u2026';
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
  console.log('[Speakademic] Overlay loaded');
})();
