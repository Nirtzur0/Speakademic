import pool from '../db/pool.js';
import authenticate from '../middleware/authenticate.js';
import { getUsageStatus } from '../services/usage-service.js';

export default async function usersRoutes(app) {
  app.get('/me', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT id, email, name, picture_url, created_at
       FROM users WHERE id = $1`,
      [request.userId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({
        error: 'user_not_found',
        message: 'User not found',
      });
    }

    const user = rows[0];
    const subscription = await getUsageStatus(request.userId);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      pictureUrl: user.picture_url,
      createdAt: user.created_at,
      subscription,
    };
  });
}
