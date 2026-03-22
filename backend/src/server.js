import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import config from './config.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import subscriptionRoutes from './routes/subscriptions.js';
import ttsRoutes from './routes/tts.js';
import webhookRoutes from './routes/webhooks.js';

const app = Fastify({
  logger: true,
  bodyLimit: 1_048_576, // 1 MB
});

await app.register(cors, { origin: config.cors.origin });
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
});

app.get('/health', async () => ({ status: 'ok' }));

await app.register(authRoutes, { prefix: '/auth' });
await app.register(usersRoutes, { prefix: '/users' });
await app.register(subscriptionRoutes,
  { prefix: '/subscriptions' });
await app.register(ttsRoutes, { prefix: '/tts' });
await app.register(webhookRoutes, { prefix: '/webhooks' });

// The extension's TtsClient hits /v1/audio/voices for health
// checks and voice listing in both local and cloud mode.
// Proxy these so cloud mode works without changing the client.
app.get('/v1/audio/voices', async (request, reply) => {
  try {
    const { getVoices } = await import(
      './services/tts-proxy.js'
    );
    return await getVoices();
  } catch (err) {
    return reply.code(502).send({
      error: 'tts_unavailable',
      message: 'TTS server is not available',
    });
  }
});

try {
  await app.listen({
    port: config.port,
    host: config.host,
  });
  console.log(
    `[Server] listening on ${config.host}:${config.port}`
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
