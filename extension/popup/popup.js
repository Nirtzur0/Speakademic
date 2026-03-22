import { MSG } from '../utils/constants.js';

/* ---- DOM refs ---- */
const $btnLogin    = document.getElementById('btn-login');
const $loggedIn    = document.getElementById('account-logged-in');
const $avatar      = document.getElementById('avatar');
const $name        = document.getElementById('account-name');
const $usageFill   = document.getElementById('usage-fill');
const $usageLabel  = document.getElementById('usage-label');
const $btnRead     = document.getElementById('btn-read');
const $btnSettings = document.getElementById('btn-settings');
const $btnShortcuts = document.getElementById('btn-shortcuts');
const $shortcutsPanel = document.getElementById('shortcuts-panel');
const $serverStatus = document.getElementById('server-status');
const $serverLabel = document.getElementById('server-label');

/* ---- Account state ---- */
function renderAccount(auth) {
  if (!auth || !auth.user) {
    $btnLogin.style.display = '';
    $loggedIn.style.display = 'none';
    return;
  }
  $btnLogin.style.display = 'none';
  $loggedIn.style.display = '';

  const u = auth.user;
  $avatar.src = u.picture || '';
  $name.textContent = u.name || u.email || 'Signed in';

  if (auth.subscription) {
    const sub = auth.subscription;
    const used = sub.characters_used || 0;
    const limit = sub.character_limit || 0;
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    $usageFill.style.width = `${pct}%`;

    if (sub.plan === 'unlimited' || limit >= 1e9) {
      $usageLabel.textContent = '\u221E';
    } else {
      $usageLabel.textContent = `${fmtNum(used)}/${fmtNum(limit)}`;
    }
  }
}

function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/* ---- Load auth state ---- */
chrome.runtime.sendMessage({ type: MSG.AUTH_STATE }, (resp) => {
  if (chrome.runtime.lastError) return;
  renderAccount(resp);
});

/* ---- Actions ---- */

$btnRead.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.runtime.sendMessage({ type: MSG.SHOW_OVERLAY, tabId: tab.id });
  }
  window.close();
});

$btnLogin.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MSG.LOGIN });
  window.close();
});

$btnSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$btnShortcuts.addEventListener('click', () => {
  const open = $shortcutsPanel.style.display !== 'none';
  $shortcutsPanel.style.display = open ? 'none' : '';
  $btnShortcuts.querySelector('.popup__chevron')
    .classList.toggle('popup__chevron--open', !open);
});

/* ---- Live server status ---- */

function setServerStatus(online, label) {
  $serverStatus.className = 'popup__server-status'
    + (online
      ? ' popup__server-status--online'
      : ' popup__server-status--offline');
  $serverLabel.textContent = label || (online ? 'Connected' : 'Offline');
  $serverStatus.title = online
    ? 'TTS server is reachable'
    : 'TTS server is not reachable — start Kokoro on localhost:8880';
}

// Ask the service worker for server status
chrome.runtime.sendMessage(
  { type: MSG.SERVER_STATUS, payload: {} },
  (resp) => {
    if (chrome.runtime.lastError || !resp) {
      // No response — do a direct health check
      checkServerDirectly();
      return;
    }
    if (resp.online !== undefined) {
      setServerStatus(resp.online);
    } else {
      checkServerDirectly();
    }
  }
);

async function checkServerDirectly() {
  // Try local server first, then cloud
  const urls = [
    'http://localhost:8880/v1/audio/voices',
    'https://api.speakademic.com/v1/audio/voices',
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const source = url.includes('localhost')
          ? 'Local' : 'Cloud';
        setServerStatus(true, source);
        return;
      }
    } catch {
      // try next
    }
  }
  setServerStatus(false);
}
