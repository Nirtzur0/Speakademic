import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCuratedVoices,
  normalizeVoice,
} from './voice-catalog.js';

test('getCuratedVoices keeps the highest-ranked available voices', () => {
  const voices = [
    'am_puck',
    'af_bella',
    'bf_emma',
    'af_heart',
    'am_michael',
    'af_nicole',
    'zf_xiaoyi',
    'am_fenrir',
  ];

  assert.deepEqual(
    getCuratedVoices(voices),
    [
      'af_heart',
      'af_bella',
      'af_nicole',
      'bf_emma',
      'am_michael',
      'am_fenrir',
    ]
  );
});

test('getCuratedVoices falls back to older Kokoro voices', () => {
  const voices = [
    'af_bella',
    'af_nicole',
    'af_sarah',
    'am_michael',
    'bf_emma',
    'bf_isabella',
    'bm_george',
  ];

  assert.deepEqual(
    getCuratedVoices(voices),
    [
      'af_bella',
      'af_nicole',
      'bf_emma',
      'am_michael',
      'af_sarah',
      'bm_george',
    ]
  );
});

test('normalizeVoice resets unsupported voices to the best match', () => {
  assert.equal(normalizeVoice('af_sky'), 'af_bella');
  assert.equal(
    normalizeVoice('am_echo', ['bf_isabella', 'bf_emma']),
    'bf_emma'
  );
  assert.equal(
    normalizeVoice('bf_isabella', ['bf_isabella', 'bf_emma']),
    'bf_isabella'
  );
  assert.equal(
    normalizeVoice('af_bella', ['bf_emma', 'af_bella']),
    'af_bella'
  );
});
