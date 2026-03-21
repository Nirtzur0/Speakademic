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
        'Cannot reach TTS server',
        err
      );
    }
  }

  async synthesize(text, { voice, speed, signal } = {}) {
    const startTime = performance.now();
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
          signal,
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
      const audioBase64 = await blobToBase64(blob);
      const genTime = performance.now() - startTime;

      return {
        audioBase64,
        metrics: {
          generationMs: Math.round(genTime),
          textLength: text.length,
          audioSizeBytes: blob.size,
        },
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new TtsError(
          'synthesis_cancelled', 'Synthesis cancelled'
        );
      }
      if (err instanceof TtsError) throw err;
      throw new TtsError(
        'synthesis_failed',
        'Cannot reach TTS server. Is it running?',
        err
      );
    }
  }

  async synthesizeStreaming(
    text, { voice, speed, signal } = {}
  ) {
    const startTime = performance.now();
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
            stream: true,
          }),
          signal,
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new TtsError(
          'synthesis_failed',
          `TTS streaming failed (${res.status}): ${body}`
        );
      }

      const reader = res.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      let firstChunkMs = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkMs === null) {
          firstChunkMs = Math.round(
            performance.now() - startTime
          );
        }
        chunks.push(value);
        totalBytes += value.length;
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const audioBase64 = uint8ToBase64(combined);
      const genTime = performance.now() - startTime;

      return {
        audioBase64,
        metrics: {
          generationMs: Math.round(genTime),
          firstByteMs: firstChunkMs,
          textLength: text.length,
          audioSizeBytes: totalBytes,
          streamed: true,
        },
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new TtsError(
          'synthesis_cancelled', 'Synthesis cancelled'
        );
      }
      if (err instanceof TtsError) throw err;
      throw new TtsError(
        'synthesis_failed',
        'Cannot reach TTS server. Is it running?',
        err
      );
    }
  }
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  return uint8ToBase64(new Uint8Array(buffer));
}

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export { TtsClient, TtsError };
