import config from '../config.js';
import pool from '../db/pool.js';

export async function synthesize(body, signal) {
  const url = `${config.tts.internalUrl}/v1/audio/speech`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: body.model || 'kokoro',
      input: body.input,
      voice: body.voice || 'af_bella',
      speed: body.speed || 1.0,
      response_format: body.response_format || 'mp3',
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `TTS server error (${res.status}): ${text}`
    );
    err.statusCode = 502;
    throw err;
  }

  return res;
}

export async function getVoices() {
  const url = `${config.tts.internalUrl}/v1/audio/voices`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const err = new Error(`TTS voices failed: ${res.status}`);
    err.statusCode = 502;
    throw err;
  }
  return res.json();
}

export async function checkHealth() {
  try {
    const url = `${config.tts.internalUrl}/v1/audio/voices`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function recordUsage(
  userId, period, charCount
) {
  await pool.query(
    `INSERT INTO usage (user_id, period, char_count, request_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id, period)
     DO UPDATE SET
       char_count = usage.char_count + $3,
       request_count = usage.request_count + 1,
       updated_at = NOW()`,
    [userId, period, charCount]
  );
}
