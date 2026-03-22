const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  db: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    accessExpiresIn: '15m',
    refreshExpiresIn: '30d',
    refreshExpiresMs: 30 * 24 * 60 * 60 * 1000,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    proPriceId: process.env.STRIPE_PRO_PRICE_ID,
    unlimitedPriceId: process.env.STRIPE_UNLIMITED_PRICE_ID,
  },

  tts: {
    internalUrl: process.env.TTS_SERVER_URL
      || 'http://localhost:8880',
  },

  tiers: {
    free: { charLimit: 50_000, label: 'Free' },
    pro: { charLimit: 500_000, label: 'Pro' },
    unlimited: { charLimit: Infinity, label: 'Unlimited' },
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
};

export default config;
