import {
  constructWebhookEvent,
  handleSubscriptionChange,
  handleSubscriptionDeleted,
} from '../services/stripe-service.js';

export default async function webhookRoutes(app) {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      // Keep raw body for Stripe signature verification
      done(null, body);
    }
  );

  app.post('/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature) {
      return reply.code(400).send({
        error: 'missing_signature',
        message: 'Stripe signature header is required',
      });
    }

    let event;
    try {
      event = constructWebhookEvent(request.body, signature);
    } catch (err) {
      request.log.error(err, 'Webhook signature failed');
      return reply.code(400).send({
        error: 'invalid_signature',
        message: 'Webhook signature verification failed',
      });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.subscription) {
            const stripe = (await import('stripe')).default;
            const s = new stripe(
              process.env.STRIPE_SECRET_KEY
            );
            const sub = await s.subscriptions.retrieve(
              session.subscription
            );
            await handleSubscriptionChange(sub);
          }
          break;
        }
        case 'customer.subscription.updated':
          await handleSubscriptionChange(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object);
          break;
        case 'invoice.payment_failed':
          if (event.data.object.subscription) {
            const stripe = (await import('stripe')).default;
            const s = new stripe(
              process.env.STRIPE_SECRET_KEY
            );
            const sub = await s.subscriptions.retrieve(
              event.data.object.subscription
            );
            await handleSubscriptionChange(sub);
          }
          break;
        default:
          request.log.info(
            `Unhandled webhook event: ${event.type}`
          );
      }
    } catch (err) {
      request.log.error(err, 'Webhook processing failed');
      return reply.code(500).send({
        error: 'webhook_failed',
        message: 'Error processing webhook',
      });
    }

    return { received: true };
  });
}
