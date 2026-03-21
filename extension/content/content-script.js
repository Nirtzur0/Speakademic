(function() {
  'use strict';

  if (window._kokoroContentScriptLoaded) return;
  window._kokoroContentScriptLoaded = true;

  const MSG = {
    PLAY: 'PLAY',
    PAUSE: 'PAUSE',
    STOP: 'STOP',
    SKIP_FORWARD: 'SKIP_FORWARD',
    SKIP_BACK: 'SKIP_BACK',
    SET_SPEED: 'SET_SPEED',
    CHUNK_READY: 'CHUNK_READY',
    CHUNK_FINISHED: 'CHUNK_FINISHED',
    STATUS_UPDATE: 'STATUS_UPDATE',
    ERROR: 'ERROR',
  };

  const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

  const player = window.KokoroAudioPlayer;

  if (!player) {
    console.error(
      '[ContentScript] KokoroAudioPlayer not found'
    );
    return;
  }

  let _status = 'idle';
  let _speed = 1.0;

  console.log('[ContentScript] Loaded on', window.location.href);

  chrome.runtime.onMessage.addListener(
    (msg, sender, sendResponse) => {
      switch (msg.type) {
        case MSG.CHUNK_READY:
          handleChunkReady(msg.payload);
          break;

        case MSG.PLAY:
          player.resume();
          break;

        case MSG.PAUSE:
          player.pause();
          break;

        case MSG.STOP:
          player.stop();
          break;

        case MSG.STATUS_UPDATE:
          _status = msg.payload.status;
          if (msg.payload.speed) _speed = msg.payload.speed;
          break;

        default:
          break;
      }
    }
  );

  async function handleChunkReady(payload) {
    const { audioBase64, chunkIndex } = payload;
    console.log(
      `[ContentScript] Playing chunk ${chunkIndex + 1}`
    );

    try {
      await player.play(audioBase64);
      chrome.runtime.sendMessage({
        type: MSG.CHUNK_FINISHED,
        payload: { chunkIndex },
      });
    } catch (err) {
      console.error(
        '[ContentScript] Playback failed:', err.message
      );
      chrome.runtime.sendMessage({
        type: MSG.ERROR,
        payload: {
          code: 'playback_failed',
          message: err.message,
        },
      });
    }
  }

  // --- Keyboard shortcuts ---

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT'
      || e.target.tagName === 'TEXTAREA'
      || e.target.tagName === 'SELECT'
      || e.target.isContentEditable) return;

    switch (e.code) {
      case 'Space': {
        e.preventDefault();
        const type = _status === 'playing'
          ? MSG.PAUSE : MSG.PLAY;
        chrome.runtime.sendMessage({ type, payload: {} });
        break;
      }

      case 'ArrowRight':
        if (_status === 'playing' || _status === 'paused') {
          e.preventDefault();
          chrome.runtime.sendMessage({
            type: MSG.SKIP_FORWARD, payload: {},
          });
        }
        break;

      case 'ArrowLeft':
        if (_status === 'playing' || _status === 'paused') {
          e.preventDefault();
          chrome.runtime.sendMessage({
            type: MSG.SKIP_BACK, payload: {},
          });
        }
        break;

      case 'ArrowUp':
        if (_status === 'playing' || _status === 'paused') {
          e.preventDefault();
          const curIdx = SPEED_OPTIONS.indexOf(_speed);
          if (curIdx < SPEED_OPTIONS.length - 1) {
            const newSpeed = SPEED_OPTIONS[curIdx + 1];
            _speed = newSpeed;
            chrome.runtime.sendMessage({
              type: MSG.SET_SPEED,
              payload: { speed: newSpeed },
            });
          }
        }
        break;

      case 'ArrowDown':
        if (_status === 'playing' || _status === 'paused') {
          e.preventDefault();
          const curIdx = SPEED_OPTIONS.indexOf(_speed);
          if (curIdx > 0) {
            const newSpeed = SPEED_OPTIONS[curIdx - 1];
            _speed = newSpeed;
            chrome.runtime.sendMessage({
              type: MSG.SET_SPEED,
              payload: { speed: newSpeed },
            });
          }
        }
        break;

      case 'Escape':
        if (_status !== 'idle') {
          e.preventDefault();
          chrome.runtime.sendMessage({
            type: MSG.STOP, payload: {},
          });
        }
        break;

      default:
        break;
    }
  });
})();
