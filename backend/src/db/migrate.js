import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query(
      'SELECT name FROM _migrations ORDER BY name'
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[migrate] skip ${file} (already applied)`);
        continue;
      }
      const sql = await readFile(
        join(migrationsDir, file), 'utf8'
      );
      console.log(`[migrate] applying ${file}...`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (name) VALUES ($1)', [file]
      );
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    }

    console.log('[migrate] all migrations applied');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
