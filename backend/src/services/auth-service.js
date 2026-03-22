import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import pool from '../db/pool.js';
import config from '../config.js';

const googleClient = new OAuth2Client(config.google.clientId);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

export async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.google.clientId,
  });
  const payload = ticket.getPayload();
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    pictureUrl: payload.picture,
  };
}

export async function findOrCreateUser(googleProfile) {
  const { googleId, email, name, pictureUrl } = googleProfile;

  const { rows: existing } = await pool.query(
    'SELECT id FROM users WHERE google_id = $1',
    [googleId]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE users
       SET email = $2, name = $3, picture_url = $4,
           updated_at = NOW()
       WHERE google_id = $1`,
      [googleId, email, name, pictureUrl]
    );
    return existing[0].id;
  }

  const { rows: created } = await pool.query(
    `INSERT INTO users (google_id, email, name, picture_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [googleId, email, name, pictureUrl]
  );
  const userId = created[0].id;

  await pool.query(
    `INSERT INTO subscriptions (user_id, tier, status)
     VALUES ($1, 'free', 'active')`,
    [userId]
  );

  return userId;
}

export function createAccessToken(userId, email) {
  return jwt.sign(
    { sub: userId, email },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn }
  );
}

export async function createRefreshToken(userId) {
  const raw = generateRefreshToken();
  const hashed = hashToken(raw);
  const expiresAt = new Date(
    Date.now() + config.jwt.refreshExpiresMs
  );

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashed, expiresAt]
  );

  return raw;
}

export async function rotateRefreshToken(oldToken) {
  const hashed = hashToken(oldToken);

  const { rows } = await pool.query(
    `DELETE FROM refresh_tokens
     WHERE token_hash = $1 AND expires_at > NOW()
     RETURNING user_id`,
    [hashed]
  );

  if (rows.length === 0) return null;

  const userId = rows[0].user_id;
  const newRaw = generateRefreshToken();
  const newHashed = hashToken(newRaw);
  const expiresAt = new Date(
    Date.now() + config.jwt.refreshExpiresMs
  );

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, newHashed, expiresAt]
  );

  const { rows: userRows } = await pool.query(
    'SELECT email FROM users WHERE id = $1', [userId]
  );

  return {
    userId,
    email: userRows[0]?.email,
    refreshToken: newRaw,
  };
}

export async function revokeUserTokens(userId) {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id = $1',
    [userId]
  );
}
