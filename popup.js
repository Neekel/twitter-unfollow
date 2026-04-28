// popup.js

const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────────────────────
let accounts      = [];   // { username, displayName, avatar, isCurrent, selected }
let mode          = 'current'; // 'current' | 'all'
let isRunning     = false;
let sessionStats  = {};   // { username: { unfollowed, skipped } }
let queueIndex    = 0;
let currentTab    = 'run';

// ── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
    currentTab = tab.dataset.tab;
  });
});

// ── Mode buttons ───────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isRunning) return;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
    updateStartButton();
  });
});

// ── Load saved settings ────────────────────────────────────────────────────
chrome.storage.local.get(['dailyLimit','delayMin','delayMax','accountPause','stats','accounts'], data => {
  if (data.dailyLimit)   $('daily-limit').value   = data.dailyLimit;
  if (data.delayMin)     $('delay-min').value      = data.delayMin;
  if (data.delayMax)     $('delay-max').value      = data.delayMax;
  if (data.accountPause) $('account-pause').value  = data.accountPause;
  if (data.stats) {
    $('stat-scanned').textContent    = data.stats.scanned    || 0;
    $('stat-unfollowed').textContent = data.stats.unfollowed || 0;
    $('stat-skipped').textContent    = data.stats.skipped    || 0;
  }
  detectAccountsFromTab();
});

// ── Detect accounts from active tab ───────────────────────────────────────
async function detectAccountsFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.match(/x\.com|twitter\.com/)) {
    setStatus('idle', 'Open x.com first');
    $('nav-hint').classList.add('visible');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'GET_ACCOUNTS' }, response => {
    if (chrome.runtime.lastError || !response) {
      setStatus('idle', 'Refresh the x.com page');
      renderAccountsList([]);
      return;
    }
    accounts = response.accounts || [];
    renderAccountsList(accounts);

    const onFollowing = /following/.test(tab.url);
    if (onFollowing && accounts.length > 0) {
      setStatus('ready', 'Ready — click START');
      $('nav-hint').classList.remove('visible');
      $('btn-start').disabled = false;
    } else if (accounts.length > 0) {
      setStatus('idle', 'Navigate to /following page');
      $('nav-hint').classList.add('visible');
      $('nav-hint').innerHTML = '👉 Go to <strong>x.com/your_handle/following</strong>';
    } else {
      setStatus('idle', 'No accounts detected');
      $('nav-hint').classList.add('visible');
    }
    updateStartButton();
  });
}

// ── Refresh button ─────────────────────────────────────────────────────────
$('btn-refresh').addEventListener('click', detectAccountsFromTab);

// ── Render accounts list ───────────────────────────────────────────────────
function renderAccountsList(accs) {
  const list = $('accounts-list');
  if (!accs.length) {
    list.innerHTML = '<div class="no-accounts">Open x.com and click ↻ Refresh to detect accounts</div>';
    return;
  }

  list.innerHTML = '';
  accs.forEach((acc, i) => {
    const item = document.createElement('div');
    item.className = 'account-item' + (acc.selected !== false ? ' selected' : '');
    item.dataset.index = i;

    const doneCount = sessionStats[acc.username]?.unfollowed;
    const badgeHTML = acc.isCurrent
      ? '<span class="badge-active">ACTIVE</span>'
      : (doneCount ? `<span class="badge-done">✓${doneCount}</span>` : '');

    item.innerHTML = `
      <div class="account-avatar">
        ${acc.avatar ? `<img src="${acc.avatar}" />` : acc.username.charAt(0).toUpperCase()}
      </div>
      <div class="account-info">
        <div class="account-name">${acc.displayName || acc.username}</div>
        <div class="account-handle">@${acc.username}</div>
      </div>
      <div class="account-badges">${badgeHTML}</div>
      <div class="account-check"></div>
    `;

    item.addEventListener('click', () => {
      if (isRunning) return;
      const idx = parseInt(item.dataset.index);
      accounts[idx].selected = !accounts[idx].selected;
      item.classList.toggle('selected', accounts[idx].selected);
      updateStartButton();
    });

    list.appendChild(item);
  });
}

// ── Update start button state ──────────────────────────────────────────────
function updateStartButton() {
  if (isRunning) return;
  const hasSelected = accounts.some(a => a.selected !== false);
  $('btn-start').disabled = !hasSelected && accounts.length > 0;
}

// ── Status helpers ─────────────────────────────────────────────────────────
function setStatus(type, text) {
  $('status-dot').className = 'status-dot ' + type;
  $('status-text').textContent = text;
}

function addLog(msg, type = '') {
  const log = $('log');
  log.classList.add('visible');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  const t = new Date().toLocaleTimeString('en', { hour12: false });
  line.textContent = `[${t}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function updateStats(stats) {
  $('stat-scanned').textContent    = stats.scanned    || 0;
  $('stat-unfollowed').textContent = stats.unfollowed || 0;
  $('stat-skipped').textContent    = stats.skipped    || 0;
}

function updateProgress(current, total) {
  $('progress-wrap').classList.add('visible');
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $('progress-fill').style.width = pct + '%';
  $('progress-label').textContent = `${current} / ${total}`;
}

// ── Queue UI ───────────────────────────────────────────────────────────────
function renderQueue(accs, activeIndex) {
  const wrap = $('queue-progress');
  if (accs.length <= 1) { wrap.classList.remove('visible'); return; }

  wrap.classList.add('visible');
  wrap.innerHTML = '';
  accs.forEach((acc, i) => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    const dotClass = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'waiting';
    const count = sessionStats[acc.username]?.unfollowed;
    div.innerHTML = `
      <div class="queue-dot ${dotClass}"></div>
      <div class="queue-label">@${acc.username}</div>
      <div class="queue-count">${count != null ? `✓${count}` : ''}</div>
    `;
    wrap.appendChild(div);
  });
}

function updateSessionStatsUI() {
  const wrap = $('session-stats');
  const entries = Object.entries(sessionStats);
  if (!entries.length) { wrap.classList.remove('visible'); return; }
  wrap.classList.add('visible');
  wrap.innerHTML = entries.map(([handle, s]) =>
    `<div class="session-row">
       <span class="session-handle">@${handle}</span>
       <span class="session-count">✓ ${s.unfollowed} unfollowed</span>
     </div>`
  ).join('');
}

// ── START ──────────────────────────────────────────────────────────────────
$('btn-start').addEventListener('click', async () => {
  const dailyLimit   = parseInt($('daily-limit').value)   || 50;
  const delayMin     = parseInt($('delay-min').value)     || 3;
  const delayMax     = parseInt($('delay-max').value)     || 10;
  const accountPause = parseInt($('account-pause').value) || 30;

  if (delayMin >= delayMax) { addLog('Min delay must be less than max delay', 'err'); return; }

  chrome.storage.local.set({ dailyLimit, delayMin, delayMax, accountPause });

  isRunning = true;
  sessionStats = {};
  queueIndex = 0;
  $('btn-start').disabled = true;
  $('btn-stop').disabled  = false;
  setStatus('running', 'Starting…');

  // Determine which accounts to process
  const queue = mode === 'current'
    ? accounts.filter(a => a.isCurrent)
    : accounts.filter(a => a.selected !== false);

  if (!queue.length) {
    addLog('No accounts selected', 'err');
    stopSession('No accounts selected');
    return;
  }

  addLog(`Mode: ${mode === 'current' ? 'Current account' : `${queue.length} accounts queued`}`, 'info');
  renderQueue(queue, 0);

  // Message handler
  const messageHandler = (msg) => {
    if (msg.type === 'UNFOLLOW_PROGRESS') {
      updateStats(msg.stats);
      updateProgress(msg.stats.unfollowed + msg.stats.skipped, msg.total);

      if (msg.action === 'unfollowed') {
        addLog(`✓ @${msg.username}`, 'ok');
      } else if (msg.action === 'reFollowed') {
        addLog(`↩ re-followed @${msg.username} (mutual!)`, 'info');
      } else if (msg.action === 'skipped') {
        addLog(`→ skip @${msg.username}`, '');
      } else if (msg.action === 'waiting') {
        setStatus('running', `Waiting ${msg.delay}s…`);
      } else if (msg.action === 'scrolling') {
        const loaded = msg.stats?.scanned || 0;
        setStatus('running', `Loading… ${loaded > 0 ? loaded + ' accounts found' : ''}`);
        if (loaded === 0) addLog('↕ Scrolling to load accounts…', 'info');
        // Update scanned counter live
        if (loaded > 0) $('stat-scanned').textContent = loaded;
      } else if (msg.action === 'switching') {
        addLog(`⇄ Switching to @${msg.username}…`, 'blue');
        setStatus('running', `Switching to @${msg.username}…`);
      }

      if (msg.action === 'unfollowed') {
        chrome.storage.local.get(['dailyCount','dailyDate'], d => {
          const t = new Date().toDateString();
          const cnt = d.dailyDate === t ? (d.dailyCount || 0) : 0;
          chrome.storage.local.set({ dailyCount: cnt + 1, dailyDate: t });
        });
      }
      chrome.storage.local.set({ stats: msg.stats });
    }

    if (msg.type === 'ACCOUNT_DONE') {
      sessionStats[msg.username] = msg.stats;
      updateSessionStatsUI();
      renderAccountsList(accounts);
      queueIndex++;
      renderQueue(queue, queueIndex);
    }

    if (msg.type === 'UNFOLLOW_DONE') {
      chrome.runtime.onMessage.removeListener(messageHandler);
      const s = msg.stats;
      addLog(`✅ Done! Unfollowed: ${s.unfollowed}, Skipped: ${s.skipped}`, 'ok');
      stopSession(`Done — ${s.unfollowed} unfollowed`);
      updateSessionStatsUI();
    }

    if (msg.type === 'UNFOLLOW_ERROR') {
      chrome.runtime.onMessage.removeListener(messageHandler);
      addLog('Error: ' + msg.error, 'err');
      stopSession('Error');
    }
  };

  chrome.runtime.onMessage.addListener(messageHandler);

  // Send to content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'START_UNFOLLOW',
    config: { dailyLimit, delayMin, delayMax, accountPause, queue }
  });
});

// ── HISTORY TAB ──────────────────────────────────────────────────────────────

function renderHistory(sessions) {
  const list = $('history-list');
  if (!sessions || !sessions.length) {
    list.innerHTML = '<div class="history-empty">No sessions yet</div>';
    return;
  }
  list.innerHTML = '';
  sessions.forEach((s, idx) => {
    const date = new Date(s.date);
    const dateStr = date.toLocaleDateString('en', { month: 'short', day: 'numeric' }) +
                    ' ' + date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });

    const reFollowed = (s.log || []).filter(l => l.action === 'reFollowed').length;

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-header">
        <span class="history-account">@${s.account}</span>
        <span class="history-date">${dateStr}</span>
      </div>
      <div class="history-stats">
        <span class="history-stat ok">✓ ${s.unfollowed} unfollowed</span>
        <span class="history-stat dim">→ ${s.skipped} skipped</span>
        <span class="history-stat dim">👁 ${s.scanned} scanned</span>
        ${reFollowed ? `<span class="history-stat warn">↩ ${reFollowed} re-followed</span>` : ''}
      </div>
      ${s.log && s.log.length ? `<button class="history-toggle" data-idx="${idx}">▶ Show log (${s.log.length})</button>
      <div class="history-log" id="hlog-${idx}">
        ${s.log.map(l => {
          const cls = l.action === 'unfollowed' ? 'ok' : l.action === 'reFollowed' ? 'warn' : '';
          const icon = l.action === 'unfollowed' ? '✓' : l.action === 'reFollowed' ? '↩' : l.action === 'error' ? '✗' : '→';
          return `<div class="history-log-line ${cls}">[${l.time}] ${icon} @${l.username}${l.reason ? ' — ' + l.reason : ''}</div>`;
        }).join('')}
      </div>` : ''}
    `;
    list.appendChild(item);
  });

  // Toggle log visibility
  list.querySelectorAll('.history-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const log = $(`hlog-${btn.dataset.idx}`);
      const open = log.classList.toggle('open');
      btn.textContent = (open ? '▼' : '▶') + btn.textContent.slice(1);
    });
  });
}

function loadHistory() {
  chrome.storage.local.get(['sessionHistory'], data => {
    renderHistory(data.sessionHistory || []);
  });
}

// Load history when History tab is clicked
document.querySelectorAll('.tab').forEach(tab => {
  if (tab.dataset.tab === 'history') {
    tab.addEventListener('click', loadHistory);
  }
});

// Clear history
$('btn-clear-history').addEventListener('click', () => {
  chrome.storage.local.set({ sessionHistory: [] }, () => {
    renderHistory([]);
  });
});

// ── STOP ───────────────────────────────────────────────────────────────────
$('btn-stop').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'STOP_UNFOLLOW' });
  addLog('Stopped by user', 'info');
  stopSession('Stopped');
});

function stopSession(statusText) {
  isRunning = false;
  $('btn-start').disabled = false;
  $('btn-stop').disabled  = true;
  setStatus('done', statusText);
}
