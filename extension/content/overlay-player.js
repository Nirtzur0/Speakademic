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
    SHOW_OVERLAY: 'SHOW_OVERLAY',
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
  const TRANSCRIPT_SCROLL_EDGE_PX = 30;
  const TRANSCRIPT_SCROLL_LEAD_RATIO = 0.34;
  const OUTLINE_LABEL_OPEN = 'Hide outline';
  const OUTLINE_LABEL_CLOSED = 'Outline';
  const MAX_OUTLINE_LEVEL = 3;

  let _isMinimized = false;
  let _isDragging = false;
  let _dragMoved = false;
  let _isOutlineExpanded = false;
  let _hasOutlineContent = false;
  let _isResumePromptVisible = false;
  let _dragOffset = { x: 0, y: 0 };
  let _status = 'idle';
  let _currentChunk = 0;
  let _totalChunks = 0;
  let _currentSectionIndex = -1;
  let _speed = 1.0;
  let _voice = 'af_bella';
  let _isVisible = false;

  let _root;
  let _shell;
  let _panel;
  let _outlinePanel;
  let _outlineToggleBtn;
  let _outlineList;
  let _minimizedBtn;
  let _minimizedIcon;
  let _playPauseBtn;
  let _stopBtn;
  let _skipBackBtn;
  let _skipFwdBtn;
  let _progressFill;
  let _progressSections;
  let _progressTooltip;
  let _textDisplay;
  let _textContent;
  let _speedSelect;
  let _voiceSelect;
  let _outlineButtons = new Map();

  // Sentence highlighting state
  let _sentenceSpans = [];
  let _sentenceTimings = [];
  let _activeSentenceIndex = -1;
  let _highlightRAF = null;
  let _playPauseAction = null;
  let _stopAction = null;

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
    _shell = el('div', 'sp__shell');

    _panel = el('div', 'sp__panel');
    _minimizedBtn = el('button', 'sp__minimized sp__minimized--hidden');
    _minimizedBtn.title = 'Play';
    _minimizedBtn.addEventListener('click', handleMinimizedClick);
    _minimizedBtn.addEventListener('dblclick', handleExpand);

    // Minimized button content: icon + label
    _minimizedIcon = el('span', 'sp__minimized-icon');
    _minimizedIcon.innerHTML = ICONS.play || '&#9654;';
    const minLabel = el('span');
    minLabel.textContent = 'Speakademic';
    _minimizedBtn.append(_minimizedIcon, minLabel);
    initDrag(_minimizedBtn, true);

    // Accent bar at top of panel
    const accentBar = el('div', 'sp__accent-bar');

    // Header
    const header = el('div', 'sp__header');
    const title = el('span', 'sp__title');
    const dot = el('span', 'sp__title-dot');
    title.appendChild(dot);
    title.appendChild(document.createTextNode('Speakademic'));
    const headerActions = el('div', 'sp__header-actions');
    _outlineToggleBtn = el('button', 'sp__header-btn');
    _outlineToggleBtn.textContent = OUTLINE_LABEL_CLOSED;
    _outlineToggleBtn.title = 'Toggle outline';
    _outlineToggleBtn.setAttribute('aria-expanded', 'false');
    _outlineToggleBtn.addEventListener('click', toggleOutline);
    const minBtn = el('button', 'sp__minimize-btn');
    minBtn.innerHTML = ICONS.minimize || '&#8722;';
    minBtn.title = 'Minimize';
    minBtn.addEventListener('click', handleMinimize);
    headerActions.append(_outlineToggleBtn, minBtn);
    header.append(title, headerActions);
    initDrag(header, false);

    // Controls
    const controls = el('div', 'sp__controls');
    _skipBackBtn = createBtn(ICONS.skipBack || '&#9664;&#9664;', 'Skip back');
    _skipBackBtn.addEventListener('click', () => {
      send(MSG.SKIP_BACK);
    });
    _playPauseBtn = createBtn(ICONS.play || '&#9654;', 'Play', 'sp__btn--play');
    _playPauseBtn.addEventListener('click', handlePlayPauseClick);
    _stopBtn = createBtn(ICONS.stop || '&#9632;', 'Stop');
    _stopBtn.addEventListener('click', handleStopClick);
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
    _progressSections = el('div', 'sp__progress-sections');
    bar.append(_progressFill, _progressSections);
    _progressTooltip = el(
      'div',
      'sp__progress-tooltip sp__progress-tooltip--hidden'
    );
    progress.append(bar, _progressTooltip);

    // Text display
    _textDisplay = el('div', 'sp__text-display');
    _textContent = el('div', 'sp__text-content');
    _textDisplay.append(_textContent);

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

    _outlinePanel = el('aside', 'sp__outline', {
      id: 'sp-outline-panel',
    });
    const outlineHeader = el('div', 'sp__outline-header');
    const outlineTitle = el('div', 'sp__outline-title');
    outlineTitle.textContent = 'Outline';
    const outlineMeta = el('div', 'sp__outline-meta');
    outlineMeta.textContent = 'Jump between sections';
    outlineHeader.append(outlineTitle, outlineMeta);
    _outlineList = el('div', 'sp__outline-list');
    _outlinePanel.append(outlineHeader, _outlineList);

    _panel.append(accentBar, header, controls, progress,
      _textDisplay, settings);
    _shell.append(_panel, _outlinePanel);
    _root.append(_shell, _minimizedBtn);
    document.body.appendChild(_root);
    useDefaultControlActions();
    syncOutlineState();
    syncOutlineHeight();
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

  function handleStop() {
    send(MSG.STOP);
  }

  function handlePlayPauseClick() {
    if (_playPauseAction) {
      _playPauseAction();
    }
  }

  function handleStopClick() {
    if (_stopAction) {
      _stopAction();
    }
  }

  function useDefaultControlActions() {
    _isResumePromptVisible = false;
    _playPauseAction = handlePlayPause;
    _stopAction = handleStop;
  }

  function handleResumeAccept() {
    useDefaultControlActions();
    send(MSG.RESUME_ACCEPT);
  }

  function handleResumeDecline() {
    useDefaultControlActions();
    send(MSG.RESUME_DECLINE);
  }

  function handleMinimizedClick(event) {
    if (_dragMoved) {
      event.preventDefault();
      return;
    }
    handlePlayPauseClick();
  }

  function handleMinimize() {
    _isMinimized = true;
    _outlinePanel.classList.add('sp__outline--exiting');
    _panel.classList.add('sp__panel--exiting');
    setTimeout(() => {
      _shell.classList.add('sp__shell--hidden');
      _panel.classList.add('sp__panel--hidden');
      _panel.classList.remove('sp__panel--exiting');
      _outlinePanel.classList.remove('sp__outline--exiting');
      _minimizedBtn.classList.remove('sp__minimized--hidden');
    }, 200);
  }

  function handleExpand() {
    _isMinimized = false;
    _isVisible = true;
    _minimizedBtn.classList.add('sp__minimized--hidden');
    _shell.classList.remove('sp__shell--hidden');
    _panel.classList.remove('sp__panel--hidden');
    // Re-trigger entrance animation
    _panel.style.animation = 'none';
    _panel.offsetHeight; // force reflow
    _panel.style.animation = '';
    if (!_outlinePanel.classList.contains('sp__outline--collapsed')) {
      _outlinePanel.style.animation = 'none';
      _outlinePanel.offsetHeight; // force reflow
      _outlinePanel.style.animation = '';
    }
    requestAnimationFrame(syncOutlineHeight);
  }

  function showOverlay() {
    _isVisible = true;
    _root.classList.remove('sp--hidden');
    if (_isMinimized
      || _shell.classList.contains('sp__shell--hidden')) {
      handleExpand();
    }
    if (_status === 'idle' && !_textContent.textContent) {
      setTextDisplayMessage(
        'Ready to read. Press play to start this page.'
      );
    }
  }

  function toggleOutline() {
    if (!_hasOutlineContent) {
      return;
    }
    _isOutlineExpanded = !_isOutlineExpanded;
    syncOutlineState();
  }

  function syncOutlineState() {
    const isExpanded = _hasOutlineContent && _isOutlineExpanded;
    _outlinePanel.classList.toggle(
      'sp__outline--collapsed',
      !isExpanded
    );
    _outlineToggleBtn.classList.toggle(
      'sp__header-btn--hidden',
      !_hasOutlineContent
    );
    _outlineToggleBtn.textContent = isExpanded
      ? OUTLINE_LABEL_OPEN
      : OUTLINE_LABEL_CLOSED;
    _outlineToggleBtn.setAttribute(
      'aria-expanded',
      String(isExpanded)
    );
    _outlineToggleBtn.setAttribute(
      'aria-controls',
      'sp-outline-panel'
    );
    if (isExpanded) {
      requestAnimationFrame(syncOutlineHeight);
    }
  }

  function syncOutlineHeight() {
    if (!_outlinePanel || !_panel) {
      return;
    }

    const panelHeight = _panel.offsetHeight;
    if (panelHeight <= 0) {
      return;
    }

    const maxHeight = Math.max(260, window.innerHeight - 40);
    const targetHeight = Math.min(
      maxHeight,
      panelHeight + 28
    );
    _outlinePanel.style.height = targetHeight + 'px';
  }

  function initDrag(handle, allowButtonDrag) {
    handle.addEventListener('mousedown', (e) => {
      if (!allowButtonDrag && e.target.tagName === 'BUTTON') return;
      _isDragging = true;
      _dragMoved = false;
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
      _dragMoved = true;
      _root.style.left =
        (e.clientX - _dragOffset.x) + 'px';
      _root.style.top =
        (e.clientY - _dragOffset.y) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (_isDragging) {
        setTimeout(() => {
          _dragMoved = false;
        }, 0);
      }
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
    _textContent.innerHTML = '';
    _sentenceSpans = [];
    _sentenceTimings = [];
    _activeSentenceIndex = -1;

    if (sentences.length === 0) return;

    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    let cumulative = 0;

    for (let i = 0; i < sentences.length; i++) {
      const span = el('span', 'sp__sentence');
      span.textContent = sentences[i] + ' ';
      _textContent.appendChild(span);
      _sentenceSpans.push(span);

      const start = cumulative / totalChars;
      cumulative += sentences[i].length;
      const end = cumulative / totalChars;
      _sentenceTimings.push({ start, end });
    }
  }

  function setTextDisplayMessage(message) {
    _textContent.textContent = message || '';
    _sentenceSpans = [];
    _sentenceTimings = [];
    _activeSentenceIndex = -1;
  }

  function shouldScrollSentenceIntoView(span) {
    const containerRect = _textDisplay.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    return spanRect.top < containerRect.top + TRANSCRIPT_SCROLL_EDGE_PX
      || spanRect.bottom > containerRect.bottom
        - TRANSCRIPT_SCROLL_EDGE_PX;
  }

  function scrollSentenceIntoView(span) {
    if (!shouldScrollSentenceIntoView(span)) {
      return;
    }

    const maxScrollTop = Math.max(
      0,
      _textDisplay.scrollHeight - _textDisplay.clientHeight
    );
    const targetTop = span.offsetTop
      - (_textDisplay.clientHeight * TRANSCRIPT_SCROLL_LEAD_RATIO);

    _textDisplay.scrollTo({
      top: Math.min(maxScrollTop, Math.max(0, targetTop)),
      behavior: 'smooth',
    });
  }

  function hideProgressTooltip() {
    _progressTooltip.classList.add(
      'sp__progress-tooltip--hidden'
    );
  }

  function showProgressTooltip(segment) {
    if (!segment?.title) {
      hideProgressTooltip();
      return;
    }

    const centerRatio = segment.startRatio
      + (segment.widthRatio / 2);
    const clampedCenter = Math.min(
      Math.max(centerRatio, 0.08),
      0.92
    );

    _progressTooltip.textContent = segment.title;
    _progressTooltip.style.left = (clampedCenter * 100) + '%';
    _progressTooltip.classList.remove(
      'sp__progress-tooltip--hidden'
    );
  }

  function renderProgressSections(
    progressSections,
    currentSectionIndex
  ) {
    _progressSections.innerHTML = '';
    hideProgressTooltip();

    if (!Array.isArray(progressSections)
      || progressSections.length === 0) {
      return;
    }

    for (let i = 0; i < progressSections.length; i++) {
      const segment = progressSections[i];
      const className = [
        'sp__progress-section',
        i % 2 === 1 ? 'sp__progress-section--alt' : '',
        segment.sectionIndex === currentSectionIndex
          ? 'sp__progress-section--current'
          : '',
      ].filter(Boolean).join(' ');
      const sectionEl = el('button', className, {
        type: 'button',
        title: segment.title,
        'aria-label': 'Jump to ' + segment.title,
      });

      sectionEl.style.left = (segment.startRatio * 100) + '%';
      sectionEl.style.width = (segment.widthRatio * 100) + '%';
      sectionEl.addEventListener('click', () => {
        hideProgressTooltip();
        send(MSG.JUMP_TO_SECTION, {
          sectionIndex: segment.sectionIndex,
        });
      });
      sectionEl.addEventListener('mouseenter', () => {
        showProgressTooltip(segment);
      });
      sectionEl.addEventListener('focus', () => {
        showProgressTooltip(segment);
      });
      sectionEl.addEventListener('mouseleave', hideProgressTooltip);
      sectionEl.addEventListener('blur', hideProgressTooltip);
      _progressSections.append(sectionEl);
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
        let activeIndex = -1;

        for (let i = 0; i < _sentenceSpans.length; i++) {
          const span = _sentenceSpans[i];
          const timing = _sentenceTimings[i];

          span.classList.remove('sp__sentence--active', 'sp__sentence--past');

          if (progress >= timing.start && progress < timing.end) {
            activeIndex = i;
            span.classList.add('sp__sentence--active');
          } else if (progress >= timing.end) {
            span.classList.add('sp__sentence--past');
          }
        }

        if (activeIndex !== -1) {
          const activeSpan = _sentenceSpans[activeIndex];
          if (activeIndex !== _activeSentenceIndex
            || shouldScrollSentenceIntoView(activeSpan)) {
            scrollSentenceIntoView(activeSpan);
          }
          _activeSentenceIndex = activeIndex;
        } else {
          _activeSentenceIndex = -1;
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
    _activeSentenceIndex = -1;
  }

  // ---- State update ----

  function updateOverlay(state) {
    _status = state.status;
    _currentChunk = state.currentChunk || 0;
    _totalChunks = state.totalChunks || 0;
    _currentSectionIndex = Number.isInteger(
      state.currentSectionIndex
    )
      ? state.currentSectionIndex
      : -1;

    const isIdle = _status === 'idle';
    const isPlaying = _status === 'playing';
    const isActive = !isIdle && _status !== 'error';

    if (isIdle && !_isVisible) {
      _root.classList.add('sp--hidden');
      stopSentenceTracking();
      return;
    }
    _root.classList.remove('sp--hidden');

    // Play/pause icon
    if (!_isResumePromptVisible) {
      _playPauseBtn.innerHTML = isPlaying
        ? (ICONS.pause || '&#9646;&#9646;')
        : (ICONS.play || '&#9654;');
      _playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
      _stopBtn.title = 'Stop';
    }
    _minimizedIcon.innerHTML = isPlaying
      ? (ICONS.pause || '&#9646;&#9646;')
      : (ICONS.play || '&#9654;');
    _minimizedBtn.title = isPlaying
      ? 'Pause (double-click to expand)'
      : 'Play (double-click to expand)';

    _skipBackBtn.disabled = !isActive;
    _skipFwdBtn.disabled = !isActive;
    if (_isResumePromptVisible) {
      _playPauseBtn.disabled = false;
      _stopBtn.disabled = false;
      _skipBackBtn.disabled = true;
      _skipFwdBtn.disabled = true;
    } else {
      _stopBtn.disabled = !isActive;
      _playPauseBtn.disabled =
        _status === 'extracting' || _status === 'loading';
    }

    // Progress
    if (_totalChunks > 0) {
      const pct = ((_currentChunk + 1) / _totalChunks) * 100;
      _progressFill.style.width = pct + '%';
    } else {
      _progressFill.style.width = '0%';
    }

    if (state.error?.message) {
      setTextDisplayMessage(state.error.message);
    } else if (_status === 'idle' && _isVisible) {
      setTextDisplayMessage(
        'Ready to read. Press play to start this page.'
      );
    }

    if (state.speed && state.speed !== _speed) {
      _speed = state.speed;
      _speedSelect.value = _speed;
    }

    if (state.voice && state.voice !== _voice) {
      _voice = state.voice;
      _voiceSelect.value = _voice;
    }

    renderOutline(
      state.sections || [],
      _currentSectionIndex
    );
    renderProgressSections(
      state.progressSections,
      _currentSectionIndex
    );
    requestAnimationFrame(syncOutlineHeight);

    if (isPlaying) {
      startSentenceTracking();
    } else {
      stopSentenceTracking();
    }
  }

  function renderOutline(sections, currentSectionIndex) {
    _outlineList.innerHTML = '';
    _outlineButtons = new Map();

    const outlineSections = Array.isArray(sections)
      ? sections.filter((section) => !section.isReferences)
      : [];
    _hasOutlineContent = outlineSections.length > 0;
    syncOutlineState();

    if (!_hasOutlineContent) {
      return;
    }

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (!section || section.isReferences) {
        continue;
      }

      const outlineItem = el('div', 'sp__outline-item');
      const outlineButton = el('button', 'sp__outline-button', {
        type: 'button',
        title: section.title,
      });
      const outlineLevel = Math.min(
        Math.max(section.outlineLevel || 0, 0),
        MAX_OUTLINE_LEVEL
      );

      outlineButton.textContent = section.title;
      outlineButton.style.setProperty(
        '--sp-outline-level',
        String(outlineLevel)
      );
      if (i === currentSectionIndex) {
        outlineButton.classList.add(
          'sp__outline-button--active'
        );
      }
      outlineButton.addEventListener('click', () => {
        send(MSG.JUMP_TO_SECTION, { sectionIndex: i });
      });
      outlineItem.append(outlineButton);
      _outlineList.append(outlineItem);
      _outlineButtons.set(i, outlineButton);
    }

    if (_isOutlineExpanded) {
      scrollOutlineSelectionIntoView(currentSectionIndex);
    }
  }

  function scrollOutlineSelectionIntoView(currentSectionIndex) {
    const activeButton = _outlineButtons.get(currentSectionIndex);
    if (!activeButton) {
      return;
    }

    activeButton.scrollIntoView({
      block: 'nearest',
    });
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
    showOverlay();
    const pct = Math.round(
      (payload.chunkIndex / payload.totalChunks) * 100
    );
    setTextDisplayMessage(
      'Resume from \u201c' + payload.section
        + '\u201d (' + pct + '% through)?'
        + ' Play resumes. Stop starts over.'
    );

    _isResumePromptVisible = true;
    _playPauseAction = handleResumeAccept;
    _stopAction = handleResumeDecline;
    _playPauseBtn.innerHTML = ICONS.play || '&#9654;';
    _playPauseBtn.title = 'Resume';
    _playPauseBtn.disabled = false;
    _stopBtn.disabled = false;
    _stopBtn.title = 'Start over';
    _skipBackBtn.disabled = true;
    _skipFwdBtn.disabled = true;
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
        setTextDisplayMessage(msg.payload.chunkText);
      }
      _textDisplay.scrollTop = 0;
    } else if (msg.type === MSG.RESUME_PROMPT) {
      showResumePrompt(msg.payload);
    } else if (msg.type === MSG.SHOW_OVERLAY) {
      showOverlay();
    } else if (msg.type === MSG.SERVER_STATUS) {
      if (!msg.payload.online && _status === 'playing') {
        setTextDisplayMessage(
          'Server disconnected. Retrying\u2026'
        );
      }
    }
  });

  function init() {
    createOverlay();
    window.addEventListener('resize', syncOutlineHeight);

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
