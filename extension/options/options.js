import { MSG } from '../utils/constants.js';

const serverUrlInput = document.getElementById('server-url');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const speedSelect = document.getElementById('default-speed');
const voiceSelect = document.getElementById('default-voice');
const autoResumeCheck = document.getElementById('auto-resume');
const skipRefsCheck = document.getElementById('skip-references');
const skipEqCheck = document.getElementById('skip-equations');
const saveBtn = document.getElementById('btn-save');
const saveStatus = document.getElementById('save-status');

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
      if (v === selectedVoice) opt.selected = true;
      optgroup.append(opt);
    }
    voiceSelect.append(optgroup);
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
    skipEquations: skipEqCheck.checked,
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

(async () => {
  const settings = await loadSettings();
  if (settings) {
    serverUrlInput.value = settings.serverUrl || '';
    speedSelect.value = settings.defaultSpeed || 1.0;
    autoResumeCheck.checked = settings.autoResume !== false;
    skipRefsCheck.checked = settings.skipReferences !== false;
    skipEqCheck.checked = settings.skipEquations === true;
  }

  const voices = await loadVoices();
  if (voices.length > 0) {
    populateVoices(
      voices,
      settings?.defaultVoice || 'af_bella'
    );
  }

  await updateServerStatus();
})();
