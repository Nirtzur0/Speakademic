import { SERVER_URL } from './constants.js';

class TtsError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'TtsError';
    this.code = code;
    this.cause = cause;
  }
}

class TtsClient {
  constructor(baseUrl = SERVER_URL) {
    this._baseUrl = baseUrl;
  }

  async checkHealth() {
    try {
      const res = await fetch(
        `${this._baseUrl}/v1/audio/voices`,
        { signal: AbortSignal.timeout(3000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async getVoices() {
    try {
      const res = await fetch(
        `${this._baseUrl}/v1/audio/voices`
      );
      if (!res.ok) {
        throw new TtsError(
          'voices_failed',
          `Voices request failed: ${res.status}`
        );
      }
      const data = await res.json();
      return data.voices || [];
    } catch (err) {
      if (err instanceof TtsError) throw err;
      throw new TtsError(
        'voices_failed',
        'Cannot reach Kokoro server',
        err
      );
    }
  }

  async synthesize(text, { voice, speed } = {}) {
    try {
      const res = await fetch(
        `${this._baseUrl}/v1/audio/speech`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'kokoro',
            input: text,
            voice: voice || 'af_bella',
            speed: speed || 1.0,
            response_format: 'mp3',
          }),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new TtsError(
          'synthesis_failed',
          `TTS synthesis failed (${res.status}): ${body}`
        );
      }
      const blob = await res.blob();
      return await blobToBase64(blob);
    } catch (err) {
      if (err instanceof TtsError) throw err;
      throw new TtsError(
        'synthesis_failed',
        'Cannot reach Kokoro server. Is it running?',
        err
      );
    }
  }
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export { TtsClient, TtsError };
