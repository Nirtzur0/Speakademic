import authenticate from '../middleware/authenticate.js';
import { getUsageStatus } from '../services/usage-service.js';
import {
  createCheckoutSession,
  createPortalSession,
} from '../services/stripe-service.js';

export default async function subscriptionRoutes(app) {
  app.get('/status', {
    preHandler: authenticate,
  }, async (request) => {
    return getUsageStatus(request.userId);
  });

  app.post('/checkout', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { priceId, successUrl, cancelUrl } =
      request.body || {};
    if (!priceId) {
      return reply.code(400).send({
        error: 'missing_price',
        message: 'priceId is required',
      });
    }

    try {
      const url = await createCheckoutSession(
        request.userId, priceId, successUrl, cancelUrl
      );
      return { url };
    } catch (err) {
      request.log.error(err, 'Checkout session failed');
      return reply.code(err.statusCode || 500).send({
        error: 'checkout_failed',
        message: err.message,
      });
    }
  });

  app.get('/portal', {
    preHandler: authenticate,
  }, async (request, reply) => {
    try {
      const url = await createPortalSession(request.userId);
      return { url };
    } catch (err) {
      request.log.error(err, 'Portal session failed');
      return reply.code(err.statusCode || 500).send({
        error: 'portal_failed',
        message: err.message,
      });
    }
  });
}
