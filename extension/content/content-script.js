(function() {
  'use strict';

  if (window._kokoroContentScriptLoaded) return;
  window._kokoroContentScriptLoaded = true;

  const MSG = {
    PLAY: 'PLAY',
    PAUSE: 'PAUSE',
    STOP: 'STOP',
    CHUNK_READY: 'CHUNK_READY',
    CHUNK_FINISHED: 'CHUNK_FINISHED',
    STATUS_UPDATE: 'STATUS_UPDATE',
    ERROR: 'ERROR',
  };

  const player = window.KokoroAudioPlayer;

  if (!player) {
    console.error(
      '[ContentScript] KokoroAudioPlayer not found'
    );
    return;
  }

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
})();
