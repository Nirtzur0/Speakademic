import { DEFAULT_VOICE } from './constants.js';

const CURATED_VOICE_LIMIT = 6;

// Ranked from Kokoro's stronger English voice grades first, while keeping
// enough accent and gender variety for long-form listening.
const PREFERRED_VOICES = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'bf_emma',
  'am_michael',
  'am_fenrir',
  'am_puck',
  'af_sarah',
  'af_kore',
  'af_aoede',
  'bm_george',
  'bf_isabella',
];

function getCuratedVoices(availableVoices = []) {
  if (!Array.isArray(availableVoices)) {
    return [DEFAULT_VOICE];
  }

  const available = new Set(availableVoices);
  const curated = [];

  for (const voice of PREFERRED_VOICES) {
    if (!available.has(voice)) {
      continue;
    }
    curated.push(voice);
    if (curated.length === CURATED_VOICE_LIMIT) {
      return curated;
    }
  }

  if (curated.length > 0) {
    return curated;
  }

  if (available.has(DEFAULT_VOICE)) {
    return [DEFAULT_VOICE];
  }

  return availableVoices.slice(0, CURATED_VOICE_LIMIT);
}

function normalizeVoice(voice, availableVoices = null) {
  if (availableVoices) {
    const curatedVoices = getCuratedVoices(availableVoices);
    if (curatedVoices.includes(voice)) {
      return voice;
    }
    return curatedVoices[0] || DEFAULT_VOICE;
  }

  if (PREFERRED_VOICES.includes(voice)) {
    return voice;
  }

  return DEFAULT_VOICE;
}

export {
  CURATED_VOICE_LIMIT,
  getCuratedVoices,
  normalizeVoice,
};
