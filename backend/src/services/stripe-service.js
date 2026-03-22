import Stripe from 'stripe';
import config from '../config.js';
import pool from '../db/pool.js';

const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey) : null;

function requireStripe() {
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.statusCode = 503;
    throw err;
  }
  return stripe;
}

export async function getOrCreateCustomer(userId) {
  const s = requireStripe();

  const { rows } = await pool.query(
    'SELECT email, name, stripe_customer_id FROM users WHERE id = $1',
    [userId]
  );
  if (rows.length === 0) throw new Error('User not found');

  const user = rows[0];
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await s.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId },
  });

  await pool.query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, userId]
  );

  return customer.id;
}

export async function createCheckoutSession(
  userId, priceId, successUrl, cancelUrl
) {
  const s = requireStripe();
  const customerId = await getOrCreateCustomer(userId);

  // Stripe doesn't accept chrome-extension:// URLs.
  // Store the extension URLs as metadata and redirect
  // from our /checkout/success and /checkout/cancel routes.
  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl
      || 'https://speakademic.com/success',
    cancel_url: cancelUrl
      || 'https://speakademic.com/cancel',
    metadata: { userId },
  });

  return session.url;
}

export async function createPortalSession(userId) {
  const s = requireStripe();
  const customerId = await getOrCreateCustomer(userId);

  const session = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: 'https://speakademic.com/settings',
  });

  return session.url;
}

export function constructWebhookEvent(body, signature) {
  const s = requireStripe();
  return s.webhooks.constructEvent(
    body, signature, config.stripe.webhookSecret
  );
}

export async function handleSubscriptionChange(
  stripeSubscription
) {
  const customerId = stripeSubscription.customer;

  const { rows: userRows } = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );
  if (userRows.length === 0) return;

  const userId = userRows[0].id;
  const tier = mapPriceToTier(
    stripeSubscription.items.data[0]?.price?.id
  );
  const status = mapStripeStatus(stripeSubscription.status);

  await pool.query(
    `INSERT INTO subscriptions
       (user_id, stripe_subscription_id, tier, status,
        current_period_start, current_period_end)
     VALUES ($1, $2, $3, $4,
       to_timestamp($5), to_timestamp($6))
     ON CONFLICT (stripe_subscription_id)
     DO UPDATE SET
       tier = $3, status = $4,
       current_period_start = to_timestamp($5),
       current_period_end = to_timestamp($6),
       updated_at = NOW()`,
    [
      userId,
      stripeSubscription.id,
      tier,
      status,
      stripeSubscription.current_period_start,
      stripeSubscription.current_period_end,
    ]
  );
}

export async function handleSubscriptionDeleted(
  stripeSubscription
) {
  const customerId = stripeSubscription.customer;
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );
  if (rows.length === 0) return;

  await pool.query(
    `UPDATE subscriptions
     SET tier = 'free', status = 'cancelled', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [stripeSubscription.id]
  );
}

function mapPriceToTier(priceId) {
  if (priceId === config.stripe.proPriceId) return 'pro';
  if (priceId === config.stripe.unlimitedPriceId) {
    return 'unlimited';
  }
  return 'free';
}

function mapStripeStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    return 'active';
  }
  if (stripeStatus === 'past_due') return 'past_due';
  return 'cancelled';
}
