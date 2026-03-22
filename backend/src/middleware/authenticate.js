import jwt from 'jsonwebtoken';
import config from '../config.js';

export default async function authenticate(request, reply) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'auth_required',
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    request.userId = payload.sub;
    request.userEmail = payload.email;
  } catch (err) {
    const code = err.name === 'TokenExpiredError'
      ? 'token_expired'
      : 'token_invalid';
    return reply.code(401).send({
      error: code,
      message: 'Invalid or expired access token',
    });
  }
}
