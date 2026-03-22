import { CLOUD_SERVER_URL } from './constants.js';
import { getAuthHeaders } from './auth-client.js';

let _cachedStatus = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getSubscriptionStatus(forceRefresh = false) {
  if (!forceRefresh
    && _cachedStatus
    && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cachedStatus;
  }

  const headers = await getAuthHeaders();
  if (!headers.Authorization) return null;

  const res = await fetch(
    `${CLOUD_SERVER_URL}/subscriptions/status`,
    { headers }
  );

  if (!res.ok) {
    if (res.status === 401) return null;
    throw new Error(
      `Subscription status failed: ${res.status}`
    );
  }

  _cachedStatus = await res.json();
  _cacheTime = Date.now();
  return _cachedStatus;
}

async function createCheckout(priceId) {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) {
    throw new Error('Not logged in');
  }

  const successUrl = chrome.runtime.getURL(
    'options/success.html'
  );
  const cancelUrl = chrome.runtime.getURL(
    'options/cancel.html'
  );

  const res = await fetch(
    `${CLOUD_SERVER_URL}/subscriptions/checkout`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priceId,
        successUrl,
        cancelUrl,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Checkout failed: ${res.status}`
    );
  }

  const data = await res.json();
  return data.url;
}

async function getPortalUrl() {
  const headers = await getAuthHeaders();
  if (!headers.Authorization) {
    throw new Error('Not logged in');
  }

  const res = await fetch(
    `${CLOUD_SERVER_URL}/subscriptions/portal`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(
      `Portal session failed: ${res.status}`
    );
  }

  const data = await res.json();
  return data.url;
}

function isQuotaAvailable(charCount) {
  if (!_cachedStatus) return true;
  const { usage } = _cachedStatus;
  if (!usage || usage.charLimit === null) return true;
  return usage.charCount + charCount <= usage.charLimit;
}

function clearCache() {
  _cachedStatus = null;
  _cacheTime = 0;
}

export {
  getSubscriptionStatus,
  createCheckout,
  getPortalUrl,
  isQuotaAvailable,
  clearCache,
};
