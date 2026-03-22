import pg from 'pg';
import config from '../config.js';

const pool = new pg.Pool({
  connectionString: config.db.connectionString,
  ssl: config.db.ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export default pool;
