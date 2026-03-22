import {
  verifyGoogleToken,
  findOrCreateUser,
  createAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeUserTokens,
} from '../services/auth-service.js';
import authenticate from '../middleware/authenticate.js';

export default async function authRoutes(app) {
  app.post('/google', async (request, reply) => {
    const { idToken } = request.body || {};
    if (!idToken) {
      return reply.code(400).send({
        error: 'missing_token',
        message: 'idToken is required',
      });
    }

    try {
      const profile = await verifyGoogleToken(idToken);
      const userId = await findOrCreateUser(profile);

      const accessToken = createAccessToken(
        userId, profile.email
      );
      const refreshToken = await createRefreshToken(userId);

      return {
        accessToken,
        refreshToken,
        user: {
          id: userId,
          email: profile.email,
          name: profile.name,
          pictureUrl: profile.pictureUrl,
        },
      };
    } catch (err) {
      request.log.error(err, 'Google auth failed');
      return reply.code(401).send({
        error: 'google_auth_failed',
        message: 'Invalid Google token',
      });
    }
  });

  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = request.body || {};
    if (!refreshToken) {
      return reply.code(400).send({
        error: 'missing_token',
        message: 'refreshToken is required',
      });
    }

    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      return reply.code(401).send({
        error: 'invalid_refresh_token',
        message: 'Refresh token is invalid or expired',
      });
    }

    const accessToken = createAccessToken(
      result.userId, result.email
    );

    return {
      accessToken,
      refreshToken: result.refreshToken,
    };
  });

  app.post('/logout', {
    preHandler: authenticate,
  }, async (request) => {
    await revokeUserTokens(request.userId);
    return { ok: true };
  });
}
