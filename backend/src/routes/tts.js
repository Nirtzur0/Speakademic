import authenticate from '../middleware/authenticate.js';
import usageGate from '../middleware/usage-gate.js';
import {
  synthesize,
  getVoices,
  checkHealth,
  recordUsage,
} from '../services/tts-proxy.js';

export default async function ttsRoutes(app) {
  app.post('/synthesize', {
    preHandler: [authenticate, usageGate],
  }, async (request, reply) => {
    const { input } = request.body || {};
    if (!input || typeof input !== 'string') {
      return reply.code(400).send({
        error: 'missing_input',
        message: 'input text is required',
      });
    }

    try {
      const ttsResponse = await synthesize(
        request.body,
        AbortSignal.timeout(30_000)
      );

      await recordUsage(
        request.userId,
        request.currentPeriod,
        input.length
      );

      const contentType = ttsResponse.headers.get(
        'content-type'
      ) || 'audio/mpeg';

      reply.header('Content-Type', contentType);

      const buffer = await ttsResponse.arrayBuffer();
      return reply.send(Buffer.from(buffer));
    } catch (err) {
      request.log.error(err, 'TTS synthesis failed');
      return reply.code(err.statusCode || 502).send({
        error: 'tts_failed',
        message: 'TTS synthesis failed',
      });
    }
  });

  app.get('/voices', async (request, reply) => {
    try {
      const data = await getVoices();
      return data;
    } catch (err) {
      request.log.error(err, 'TTS voices failed');
      return reply.code(502).send({
        error: 'tts_unavailable',
        message: 'TTS server is not available',
      });
    }
  });

  app.get('/health', async () => {
    const healthy = await checkHealth();
    return { tts: healthy ? 'ok' : 'down' };
  });
}
