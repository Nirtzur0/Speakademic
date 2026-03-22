CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id)
                            ON DELETE CASCADE,
  stripe_subscription_id  VARCHAR(255) UNIQUE,
  tier                    VARCHAR(50) NOT NULL DEFAULT 'free',
  status                  VARCHAR(50) NOT NULL DEFAULT 'active',
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id
  ON subscriptions(user_id);

-- Every user gets a free subscription row on creation
-- (handled in auth-service.js)
