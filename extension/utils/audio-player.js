(function() {
  'use strict';

  if (window.SpeakademicAudioPlayer) return;

  let _audio = null;
  let _onEnded = null;
  let _onError = null;

  function play(base64Audio) {
    return new Promise((resolve, reject) => {
      try {
        stop();
        const dataUri = 'data:audio/mp3;base64,' + base64Audio;
        _audio = new Audio(dataUri);

        _audio.addEventListener('ended', () => {
          console.log('[AudioPlayer] Chunk playback ended');
          if (_onEnded) _onEnded();
          resolve();
        }, { once: true });

        _audio.addEventListener('error', (e) => {
          const msg = 'Audio playback error: '
            + (_audio.error?.message || 'unknown');
          console.error('[AudioPlayer]', msg);
          if (_onError) _onError(msg);
          reject(new Error(msg));
        }, { once: true });

        _audio.play().catch((err) => {
          console.error(
            '[AudioPlayer] Play failed:', err.message
          );
          if (_onError) _onError(err.message);
          reject(err);
        });
      } catch (err) {
        console.error(
          '[AudioPlayer] Setup failed:', err.message
        );
        reject(err);
      }
    });
  }

  function pause() {
    if (_audio && !_audio.paused) {
      _audio.pause();
      console.log('[AudioPlayer] Paused');
    }
  }

  function resume() {
    if (_audio && _audio.paused) {
      _audio.play().catch((err) => {
        console.error(
          '[AudioPlayer] Resume failed:', err.message
        );
      });
      console.log('[AudioPlayer] Resumed');
    }
  }

  function stop() {
    if (_audio) {
      _audio.pause();
      _audio.src = '';
      _audio = null;
      console.log('[AudioPlayer] Stopped');
    }
  }

  function setCallbacks({ onEnded, onError }) {
    _onEnded = onEnded || null;
    _onError = onError || null;
  }

  function getDuration() {
    return _audio ? _audio.duration : 0;
  }

  function getCurrentTime() {
    return _audio ? _audio.currentTime : 0;
  }

  function isPlaying() {
    return _audio ? !_audio.paused : false;
  }

  window.SpeakademicAudioPlayer = {
    play,
    pause,
    resume,
    stop,
    setCallbacks,
    getDuration,
    getCurrentTime,
    isPlaying,
  };
})();
