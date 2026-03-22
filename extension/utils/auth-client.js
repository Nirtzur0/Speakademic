import { CLOUD_SERVER_URL } from './constants.js';

const AUTH_KEYS = {
  tokens: 'speakademic_auth_tokens',
  profile: 'speakademic_user_profile',
};

const GOOGLE_CLIENT_ID =
  '__GOOGLE_CLIENT_ID__'
  + '.apps.googleusercontent.com';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_INFO = 'https://oauth2.googleapis.com/tokeninfo';

let _listeners = [];

function notifyListeners(authState) {
  for (const fn of _listeners) fn(authState);
}

async function login() {
  if (!chrome.identity) {
    throw new Error(
      'Sign-in not available. Cloud backend not configured.'
    );
  }
  const redirectUrl = chrome.identity.getRedirectURL();
  const nonce = crypto.randomUUID();

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('nonce', nonce);

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const hash = new URL(responseUrl).hash.slice(1);
  const params = new URLSearchParams(hash);
  const idToken = params.get('id_token');

  if (!idToken) {
    throw new Error('Google sign-in failed: no token');
  }

  const res = await fetch(
    `${CLOUD_SERVER_URL}/auth/google`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Auth server error (${res.status}): ${body}`
    );
  }

  const data = await res.json();

  await chrome.storage.local.set({
    [AUTH_KEYS.tokens]: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    },
    [AUTH_KEYS.profile]: data.user,
  });

  notifyListeners({ loggedIn: true, user: data.user });
  return data.user;
}

async function logout() {
  const tokens = await getTokens();
  if (tokens?.accessToken) {
    fetch(`${CLOUD_SERVER_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
      },
    }).catch(() => {});
  }

  await chrome.storage.local.remove([
    AUTH_KEYS.tokens,
    AUTH_KEYS.profile,
  ]);

  notifyListeners({ loggedIn: false, user: null });
}

async function getTokens() {
  const data = await chrome.storage.local.get(AUTH_KEYS.tokens);
  return data[AUTH_KEYS.tokens] || null;
}

function parseJwtExp(token) {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1])
    );
    return payload.exp * 1000;
  } catch {
    return 0;
  }
}

async function getAccessToken() {
  const tokens = await getTokens();
  if (!tokens) return null;

  const exp = parseJwtExp(tokens.accessToken);
  if (Date.now() < exp - 60_000) {
    return tokens.accessToken;
  }

  return refreshAccessToken(tokens.refreshToken);
}

async function refreshAccessToken(refreshToken) {
  try {
    const res = await fetch(
      `${CLOUD_SERVER_URL}/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }
    );

    if (!res.ok) {
      await logout();
      return null;
    }

    const data = await res.json();
    await chrome.storage.local.set({
      [AUTH_KEYS.tokens]: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      },
    });

    return data.accessToken;
  } catch {
    await logout();
    return null;
  }
}

async function isLoggedIn() {
  const tokens = await getTokens();
  return !!tokens?.refreshToken;
}

async function getUserProfile() {
  const data = await chrome.storage.local.get(
    AUTH_KEYS.profile
  );
  return data[AUTH_KEYS.profile] || null;
}

async function getAuthHeaders() {
  const token = await getAccessToken();
  if (!token) return {};
  return { 'Authorization': `Bearer ${token}` };
}

function onAuthStateChanged(callback) {
  _listeners.push(callback);
  return () => {
    _listeners = _listeners.filter((fn) => fn !== callback);
  };
}

export {
  login,
  logout,
  isLoggedIn,
  getUserProfile,
  getAccessToken,
  getAuthHeaders,
  onAuthStateChanged,
};
