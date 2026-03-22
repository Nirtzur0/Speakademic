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
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  ).toISOString();
}

export async function getUsageStatus(userId) {
  const period = currentPeriod();

  const { rows: subRows } = await pool.query(
    `SELECT tier, status FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'past_due')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const tier = subRows[0]?.tier || 'free';
  const subStatus = subRows[0]?.status || 'active';
  const tierConfig = config.tiers[tier] || config.tiers.free;

  const { rows: usageRows } = await pool.query(
    `SELECT char_count, request_count FROM usage
     WHERE user_id = $1 AND period = $2`,
    [userId, period]
  );
  const charCount = parseInt(
    usageRows[0]?.char_count || '0', 10
  );
  const requestCount = usageRows[0]?.request_count || 0;

  return {
    tier,
    tierLabel: tierConfig.label,
    subscriptionStatus: subStatus,
    usage: {
      charCount,
      requestCount,
      charLimit: tierConfig.charLimit === Infinity
        ? null : tierConfig.charLimit,
      period,
      resetsAt: periodEndDate(),
    },
  };
}
