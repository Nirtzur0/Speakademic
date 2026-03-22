import { MSG } from '../utils/constants.js';
import { normalizeVoice } from '../utils/voice-catalog.js';

const serverUrlInput = document.getElementById('server-url');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const speedSelect = document.getElementById('default-speed');
const voiceSelect = document.getElementById('default-voice');
const autoResumeCheck = document.getElementById('auto-resume');
const skipRefsCheck = document.getElementById('skip-references');
const equationModeSelect = document.getElementById('equation-mode');
const saveBtn = document.getElementById('btn-save');
const saveStatus = document.getElementById('save-status');

const accountLoggedOut = document.getElementById(
  'account-logged-out'
);
const accountLoggedIn = document.getElementById(
  'account-logged-in'
);
const accountAvatar = document.getElementById('account-avatar');
const accountName = document.getElementById('account-name');
const accountEmail = document.getElementById('account-email');
const planBadge = document.getElementById('plan-badge');
const usageText = document.getElementById('usage-text');
const usageBarFill = document.getElementById('usage-bar-fill');
const btnGoogleLogin = document.getElementById(
  'btn-google-login'
);
const btnUpgrade = document.getElementById('btn-upgrade');
const btnManageSub = document.getElementById('btn-manage-sub');
const btnLogout = document.getElementById('btn-logout');
const modeCloud = document.getElementById('mode-cloud');
const modeLocal = document.getElementById('mode-local');
const serverSection = document.getElementById('server-section');

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MSG.GET_SETTINGS, payload: {} },
      (settings) => {
        if (chrome.runtime.lastError || !settings) {
          resolve(null);
          return;
        }
        resolve(settings);
      }
    );
  });
}

async function loadVoices() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MSG.GET_VOICES, payload: {} },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve([]);
          return;
        }
        resolve(response.voices || []);
      }
    );
  });
}

function populateVoices(voices, selectedVoice) {
  voiceSelect.innerHTML = '';
  const activeVoice = normalizeVoice(selectedVoice, voices);
  const prefixes = {
    af: 'American Female',
    am: 'American Male',
    bf: 'British Female',
    bm: 'British Male',
  };
  const groups = {};

  for (const v of voices) {
    const prefix = v.substring(0, 2);
    const group = prefixes[prefix] || 'Other';
    if (!groups[group]) groups[group] = [];
    groups[group].push(v);
  }

  for (const [group, list] of Object.entries(groups)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group;
    for (const v of list) {
      const opt = document.createElement('option');
      opt.value = v;
      const name = v.substring(3).replace(/_/g, ' ');
      opt.textContent = name.charAt(0).toUpperCase()
        + name.slice(1);
      if (v === activeVoice) opt.selected = true;
      optgroup.append(opt);
    }
    voiceSelect.append(optgroup);
  }

  if (voices.length > 0) {
    voiceSelect.value = activeVoice;
  }
}

async function checkServer(url) {
  try {
    const res = await fetch(
      url + '/v1/audio/voices',
      { signal: AbortSignal.timeout(3000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function updateServerStatus() {
  const url = serverUrlInput.value.trim()
    || 'http://localhost:8880';
  const online = await checkServer(url);
  statusDot.className = online
    ? 'options__status-dot options__status-dot--online'
    : 'options__status-dot options__status-dot--offline';
  statusText.textContent = online
    ? 'Connected' : 'Not reachable';
}

saveBtn.addEventListener('click', async () => {
  const settings = {
    serverUrl: serverUrlInput.value.trim()
      || 'http://localhost:8880',
    defaultSpeed: parseFloat(speedSelect.value),
    defaultVoice: voiceSelect.value,
    autoResume: autoResumeCheck.checked,
    skipReferences: skipRefsCheck.checked,
    equationMode: equationModeSelect.value,
  };

  chrome.runtime.sendMessage(
    { type: MSG.SAVE_SETTINGS, payload: settings },
    () => {
      saveStatus.textContent = 'Saved!';
      saveBtn.classList.add('options__btn--saved');
      setTimeout(() => {
        saveStatus.textContent = '';
        saveBtn.classList.remove('options__btn--saved');
      }, 2000);
    }
  );
});

serverUrlInput.addEventListener('blur', updateServerStatus);

function sendMsg(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type, payload },
      (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      }
    );
  });
}

function renderAuthState(authState) {
  if (!authState || !authState.loggedIn) {
    accountLoggedOut.style.display = '';
    accountLoggedIn.style.display = 'none';
    return;
  }

  accountLoggedOut.style.display = 'none';
  accountLoggedIn.style.display = '';

  const u = authState.user;
  if (u) {
    accountName.textContent = u.name || '';
    accountEmail.textContent = u.email || '';
    if (u.pictureUrl) {
      accountAvatar.src = u.pictureUrl;
      accountAvatar.style.display = '';
    } else {
      accountAvatar.style.display = 'none';
    }
  }

  const sub = authState.subscription;
  if (sub) {
    planBadge.textContent = sub.tierLabel || 'Free';
    planBadge.className = 'options__plan-badge'
      + (sub.tier !== 'free'
        ? ' options__plan-badge--paid' : '');
    if (sub.usage && sub.usage.charLimit !== null) {
      const pct = Math.min(
        100,
        (sub.usage.charCount / sub.usage.charLimit) * 100
      );
      usageText.textContent =
        `${formatNum(sub.usage.charCount)}`
        + ` / ${formatNum(sub.usage.charLimit)} chars`;
      usageBarFill.style.width = `${pct}%`;
    } else {
      usageText.textContent = 'Unlimited';
      usageBarFill.style.width = '0%';
    }

    btnUpgrade.style.display =
      sub.tier === 'unlimited' ? 'none' : '';
    btnManageSub.style.display =
      sub.tier === 'free' ? 'none' : '';
  }
}

function renderTtsMode(mode) {
  if (mode === 'cloud') {
    modeCloud.checked = true;
    serverSection.style.display = 'none';
  } else {
    modeLocal.checked = true;
    serverSection.style.display = '';
  }
}

function formatNum(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

btnGoogleLogin.addEventListener('click', async () => {
  btnGoogleLogin.disabled = true;
  btnGoogleLogin.textContent = 'Signing in...';
  const res = await sendMsg(MSG.LOGIN);
  btnGoogleLogin.disabled = false;
  btnGoogleLogin.textContent = 'Sign in with Google';
  if (res?.ok) {
    const authState = await sendMsg(MSG.AUTH_STATE);
    renderAuthState(authState);
    renderTtsMode(authState?.ttsMode || 'local');
  }
});

btnLogout.addEventListener('click', async () => {
  await sendMsg(MSG.LOGOUT);
  renderAuthState({ loggedIn: false });
  renderTtsMode('cloud');
});

btnUpgrade.addEventListener('click', () => {
  sendMsg(MSG.UPGRADE);
});

btnManageSub.addEventListener('click', async () => {
  btnManageSub.disabled = true;
  btnManageSub.textContent = 'Opening...';
  await sendMsg(MSG.MANAGE_SUBSCRIPTION);
  btnManageSub.disabled = false;
  btnManageSub.textContent = 'Manage';
});

modeCloud.addEventListener('change', async () => {
  const res = await sendMsg(MSG.SET_TTS_MODE, {
    mode: 'cloud',
  });
  if (res?.ok) {
    serverSection.style.display = 'none';
  } else {
    modeLocal.checked = true;
  }
});

modeLocal.addEventListener('change', async () => {
  const res = await sendMsg(MSG.SET_TTS_MODE, {
    mode: 'local',
  });
  if (res?.ok) {
    serverSection.style.display = '';
    await updateServerStatus();
  }
});

(async () => {
  const settings = await loadSettings();
  if (settings) {
    serverUrlInput.value = settings.serverUrl || '';
    speedSelect.value = settings.defaultSpeed || 1.0;
    autoResumeCheck.checked = settings.autoResume !== false;
    skipRefsCheck.checked = settings.skipReferences !== false;
    equationModeSelect.value = settings.equationMode || 'skip';
  }

  const voices = await loadVoices();
  if (voices.length > 0) {
    populateVoices(
      voices,
      settings?.defaultVoice || 'af_bella'
    );
  }

  const authState = await sendMsg(MSG.AUTH_STATE);
  renderAuthState(authState);
  renderTtsMode('cloud');
})();
