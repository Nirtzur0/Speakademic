import pool from '../db/pool.js';
import config from '../config.js';

function currentPeriod() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function periodEndDate() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1)).toISOString();
}

export default async function usageGate(request, reply) {
  const userId = request.userId;
  const period = currentPeriod();

  const { rows: subRows } = await pool.query(
    `SELECT tier FROM subscriptions
     WHERE user_id = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const tier = subRows[0]?.tier || 'free';
  const tierConfig = config.tiers[tier] || config.tiers.free;

  if (tierConfig.charLimit === Infinity) {
    request.tier = tier;
    request.tierConfig = tierConfig;
    return;
  }

  const { rows: usageRows } = await pool.query(
    `SELECT char_count FROM usage
     WHERE user_id = $1 AND period = $2`,
    [userId, period]
  );
  const used = parseInt(usageRows[0]?.char_count || '0', 10);

  const inputLength = (request.body?.input || '').length;
  if (used + inputLength > tierConfig.charLimit) {
    return reply.code(403).send({
      error: 'quota_exceeded',
      usage: {
        used,
        limit: tierConfig.charLimit,
        tier,
        resetsAt: periodEndDate(),
      },
    });
  }

  request.tier = tier;
  request.tierConfig = tierConfig;
  request.currentUsage = used;
  request.currentPeriod = period;
}
