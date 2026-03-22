CREATE TABLE usage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id)
                   ON DELETE CASCADE,
  period         VARCHAR(7) NOT NULL,
  char_count     BIGINT NOT NULL DEFAULT 0,
  request_count  INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period)
);

CREATE INDEX idx_usage_user_period ON usage(user_id, period);
