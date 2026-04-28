// content.js

if (window._safeUnfollowRunning) {
  console.warn('[SafeUnfollow] Already running');
} else {

let stopRequested = false;
window._safeUnfollowRunning = false;

// ── Message router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_ACCOUNTS') {
    sendResponse({ accounts: detectLoggedInAccounts() });
    return true;
  }
  if (msg.type === 'START_UNFOLLOW') {
    if (window._safeUnfollowRunning) return;
    stopRequested = false;
    startQueue(msg.config);
  }
  if (msg.type === 'STOP_UNFOLLOW') {
    stopRequested = true;
    window._safeUnfollowRunning = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  1. TAB VISIBILITY — pause when tab is hidden, resume when active
// ══════════════════════════════════════════════════════════════════════════

async function waitForTabVisible() {
  if (document.visibilityState === 'visible') return;

  chrome.runtime.sendMessage({
    type: 'UNFOLLOW_PROGRESS', action: 'waiting',
    delay: '…', username: '', stats: { scanned: 0, unfollowed: 0, skipped: 0 }, total: 0
  });
  console.log('[SafeUnfollow] Tab hidden — pausing until active');

  await new Promise(resolve => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', handler);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', handler);
  });

  // Resume with a short random delay — don't act instantly on tab switch
  await sleep(1500 + rand(1500));
  console.log('[SafeUnfollow] Tab active — resuming');
}

// ══════════════════════════════════════════════════════════════════════════
//  2. CAPTCHA / RATE-LIMIT DETECTION
// ══════════════════════════════════════════════════════════════════════════

function detectBlockPage() {
  const url  = window.location.href;
  const body = document.body?.innerText?.toLowerCase() || '';

  // URL signals
  if (/\/account\/suspended|\/account\/locked|checkpoint|captcha|verify_phone/i.test(url)) return 'suspended_or_captcha';

  // Rate limit / "something went wrong" page
  if (body.includes('rate limit') || body.includes('something went wrong') ||
      body.includes('try again') || body.includes('too many requests')) return 'rate_limit';

  // Account locked or under review
  if (body.includes('account has been locked') || body.includes('account is suspended') ||
      body.includes('verify your identity')) return 'locked';

  // No UserCells AND no loading indicator = wrong page
  const cells    = document.querySelectorAll('[data-testid="UserCell"]').length;
  const spinner  = document.querySelector('[data-testid="LoadingSpinner_Animation"]');
  const timeline = document.querySelector('[data-testid="primaryColumn"]');
  if (timeline && !cells && !spinner) return 'empty_or_wrong_page';

  return null;
}

// ══════════════════════════════════════════════════════════════════════════
//  ACCOUNT DETECTION
// ══════════════════════════════════════════════════════════════════════════

function detectLoggedInAccounts() {
  const accounts = [];

  const switcher = document.querySelectorAll(
    '[data-testid="AccountSwitcher_List"] [data-testid="UserAvatar-Container"]'
  );
  if (switcher.length) {
    switcher.forEach(el => {
      const container  = el.closest('a, div[role="button"]');
      const username   = extractUsernameFromEl(container);
      const displayName = container?.querySelector('[dir="ltr"] span')?.textContent?.trim() || '';
      const avatar     = el.querySelector('img')?.src || '';
      const isCurrent  = !!container?.closest('[aria-selected="true"]');
      if (username) accounts.push({ username, displayName, avatar, isCurrent, selected: true });
    });
    return accounts;
  }

  const navUser = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (navUser) {
    // @username is in the span that starts with '@', displayName is the other span
    const allSpans = Array.from(navUser.querySelectorAll('span'));
    const handleSpan = allSpans.find(s => s.textContent.trim().startsWith('@'));
    const username    = handleSpan ? handleSpan.textContent.trim().replace('@','') : '';
    const displayName = allSpans.find(s => !s.textContent.trim().startsWith('@') && s.textContent.trim())?.textContent?.trim() || '';
    const avatar      = navUser.querySelector('img')?.src || '';
    if (username) accounts.push({ username, displayName, avatar, isCurrent: true, selected: true });
  }

  return accounts;
}

function extractUsernameFromEl(el) {
  if (!el) return null;
  const href = el.getAttribute('href');
  if (href) return href.replace('/', '').split('/')[0];
  return el.querySelector('[dir="ltr"]')?.textContent?.replace('@','').trim() || null;
}

// ══════════════════════════════════════════════════════════════════════════
//  NAVIGATION — click-based, not location.href
// ══════════════════════════════════════════════════════════════════════════

async function navigateToFollowing(username) {
  if (window.location.href.includes(`/${username}/following`)) return true;

  // Navigate directly to /following via pushState (SPA-safe, no full reload)
  // Never click AppTabBar_Profile_Link — it navigates to own profile page
  // and breaks the /following flow if username doesn't match active account
  window.history.pushState({}, '', `/${username}/following`);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await sleep(2000 + rand(800));

  if (stopRequested) return false;

  // Wait for cells to appear; if not — try clicking the Following tab as fallback
  const hasCells = await waitForCells(6000);
  if (!hasCells) return await clickFollowingTab(username);
  return true;
}

async function clickFollowingTab(username) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const tabs = Array.from(document.querySelectorAll('a[role="tab"], nav a'));
    const tab  = tabs.find(t => {
      const href = t.getAttribute('href') || '';
      const text = getText(t);
      return (href.includes('/following') && href.includes(username)) ||
             (text === 'following' && href.includes(username));
    });
    if (tab) {
      await realisticClick(tab);
      await waitForCells(10000);
      return window.location.href.includes('/following');
    }
    await sleep(400);
  }
  // SPA fallback
  window.history.pushState({}, '', `/${username}/following`);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitForCells(10000);
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
//  ACCOUNT SWITCHING
// ══════════════════════════════════════════════════════════════════════════

async function switchToAccount(username) {
  chrome.runtime.sendMessage({
    type: 'UNFOLLOW_PROGRESS', action: 'switching', username,
    stats: { scanned: 0, unfollowed: 0, skipped: 0 }, total: 0
  });

  const switcherBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (!switcherBtn) return false;

  await realisticClick(switcherBtn);
  await sleep(1200 + rand(400));

  const menuItems = document.querySelectorAll(
    '[data-testid="AccountSwitcher_List"] a, [data-testid="AccountSwitcher_List"] div[role="button"]'
  );
  let targetEl = null;
  for (const item of menuItems) {
    const text = (item.textContent || '').toLowerCase();
    if (text.includes(username.toLowerCase()) || text.includes('@' + username.toLowerCase())) {
      targetEl = item;
      break;
    }
  }

  if (!targetEl) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    return false;
  }

  await realisticClick(targetEl);
  await sleep(2500 + rand(1000));
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
//  REALISTIC MOUSE CLICK
// ══════════════════════════════════════════════════════════════════════════

async function realisticClick(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x    = rect.left + rect.width  * (0.3 + Math.random() * 0.4);
  const y    = rect.top  + rect.height * (0.3 + Math.random() * 0.4);
  const base = {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y,
    screenX: x + window.screenX, screenY: y + window.screenY,
    movementX: (Math.random() - 0.5) * 3,
    movementY: (Math.random() - 0.5) * 3,
  };

  el.dispatchEvent(new MouseEvent('mouseover',  { ...base, buttons: 0 }));
  await sleep(30 + rand(40));
  el.dispatchEvent(new MouseEvent('mousemove',  { ...base, buttons: 0 }));
  await sleep(20 + rand(30));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...base, buttons: 0 }));
  await sleep(10 + rand(20));
  el.dispatchEvent(new MouseEvent('mousedown',  { ...base, buttons: 1, button: 0 }));
  await sleep(60 + rand(80));
  el.dispatchEvent(new MouseEvent('mouseup',    { ...base, buttons: 0, button: 0 }));
  await sleep(15 + rand(20));
  el.dispatchEvent(new MouseEvent('click',      { ...base, buttons: 0, button: 0 }));
  await sleep(20 + rand(20));
  el.dispatchEvent(new MouseEvent('mouseleave', { ...base, buttons: 0 }));
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN QUEUE
// ══════════════════════════════════════════════════════════════════════════

async function startQueue(config) {
  window._safeUnfollowRunning = true;
  const { dailyLimit, delayMin, delayMax, accountPause, queue } = config;
  const totalStats = { scanned: 0, unfollowed: 0, skipped: 0 };

  for (let i = 0; i < queue.length; i++) {
    if (stopRequested) break;
    const account = queue[i];

    if (!account.isCurrent) {
      const switched = await switchToAccount(account.username);
      if (!switched) {
        console.log('[SafeUnfollow] Could not switch to @' + account.username);
        continue;
      }
      await sleep(2000 + rand(800));
    }

    const ok = await navigateToFollowing(account.username);
    if (!ok || stopRequested) continue;

    const stats = await runUnfollowSession({ dailyLimit, delayMin, delayMax });
    totalStats.scanned    += stats.scanned;
    totalStats.unfollowed += stats.unfollowed;
    totalStats.skipped    += stats.skipped;

    await saveSessionLog(account.username, stats);
    chrome.runtime.sendMessage({ type: 'ACCOUNT_DONE', username: account.username, stats });

    if (i < queue.length - 1 && !stopRequested) {
      chrome.runtime.sendMessage({
        type: 'UNFOLLOW_PROGRESS', action: 'waiting',
        delay: accountPause, username: account.username,
        stats: totalStats, total: dailyLimit
      });
      await sleep(accountPause * 1000);
    }
  }

  window._safeUnfollowRunning = false;
  chrome.runtime.sendMessage({ type: 'UNFOLLOW_DONE', stats: totalStats });
}

// ══════════════════════════════════════════════════════════════════════════
//  UNFOLLOW SESSION
// ══════════════════════════════════════════════════════════════════════════

async function runUnfollowSession({ dailyLimit, delayMin, delayMax }) {
  const stats     = { scanned: 0, unfollowed: 0, skipped: 0 };
  const processed = new Set();
  let stale = 0, lastProcessed = 0;
  let nextBreakAt = 10 + rand(6);
  sessionLog = []; // reset log for this session

  chrome.runtime.sendMessage({
    type: 'UNFOLLOW_PROGRESS', action: 'scrolling',
    stats: { ...stats }, total: dailyLimit
  });

  while (!stopRequested && stats.unfollowed < dailyLimit) {

    // ── Tab visibility check ─────────────────────────────────────────────
    await waitForTabVisible();
    if (stopRequested) break;

    // ── Captcha / block page check ───────────────────────────────────────
    const blockReason = detectBlockPage();
    if (blockReason && blockReason !== 'empty_or_wrong_page') {
      chrome.runtime.sendMessage({
        type: 'UNFOLLOW_ERROR',
        error: `Stopped: ${blockReason}. Check your browser tab.`
      });
      window._safeUnfollowRunning = false;
      return stats;
    }

    const cells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'));

    for (const cell of cells) {
      if (stopRequested || stats.unfollowed >= dailyLimit) break;
      if (!cell.querySelector('a[href^="/"]')) continue;

      const username = getUsername(cell);
      if (!username || username === 'unknown') continue;
      if (processed.has(username)) continue;
      processed.add(username);
      stats.scanned++;

      // ── Tab visibility check inside loop ─────────────────────────────
      await waitForTabVisible();
      if (stopRequested) break;

      // ── Mini-break every 10-15 unfollows ─────────────────────────────
      if (stats.unfollowed > 0 && stats.unfollowed === nextBreakAt) {
        const breakDur = 45000 + rand(75000); // 45s – 2min
        chrome.runtime.sendMessage({
          type: 'UNFOLLOW_PROGRESS', action: 'waiting',
          delay: Math.round(breakDur / 1000), username, stats: { ...stats }, total: dailyLimit
        });
        console.log(`[SafeUnfollow] Mini-break ${Math.round(breakDur/1000)}s`);
        await sleep(breakDur);
        nextBreakAt = stats.unfollowed + 10 + rand(6);
        if (stopRequested) break;
      }

      if (isMutual(cell)) {
        stats.skipped++;
        sessionLog.push({ time: now(), username, action: 'skipped', reason: 'mutual follower' });
        chrome.runtime.sendMessage({ type: 'UNFOLLOW_PROGRESS', action: 'skipped', username, stats: { ...stats }, total: dailyLimit });
        continue;
      }

      const followBtn = findFollowingButton(cell);
      if (!followBtn) {
        stats.skipped++;
        sessionLog.push({ time: now(), username, action: 'skipped', reason: 'no button found' });
        chrome.runtime.sendMessage({ type: 'UNFOLLOW_PROGRESS', action: 'skipped', username, stats: { ...stats }, total: dailyLimit });
        continue;
      }

      // ── Occasionally pause on cell as if reading bio (replaces profile open) ──
      // Profile navigation was removed: history.back() breaks the /following flow.
      // Instead: 10% chance of a longer "reading" pause before acting.
      if (Math.random() < 0.10) {
        await sleep(2000 + rand(3000));
      }

      // Main delay
      const delay = randomDelay(delayMin, delayMax);
      chrome.runtime.sendMessage({
        type: 'UNFOLLOW_PROGRESS', action: 'waiting',
        delay: Math.round(delay / 1000), username, stats: { ...stats }, total: dailyLimit
      });
      await sleep(delay);
      if (stopRequested) break;

      cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500 + rand(300));

      try {
        await realisticClick(followBtn);
        const confirmBtn = await waitForConfirm(7000);
        if (confirmBtn) {
          await sleep(200 + rand(200));
          await realisticClick(confirmBtn);
          await sleep(1000 + rand(1000));

          // ── Safety check: did button become "Follow Back"? ─────────────
          // If yes — we accidentally unfollowed a mutual. Re-follow immediately.
          const reFollowed = await checkAndReFollowIfMutual(cell, username);
          if (reFollowed) {
            stats.skipped++;
            sessionLog.push({ time: now(), username, action: 'reFollowed', reason: 'was mutual (Follow Back detected)' });
            chrome.runtime.sendMessage({ type: 'UNFOLLOW_PROGRESS', action: 'reFollowed', username, stats: { ...stats }, total: dailyLimit });
          } else {
            stats.unfollowed++;
            sessionLog.push({ time: now(), username, action: 'unfollowed' });
            chrome.runtime.sendMessage({ type: 'UNFOLLOW_PROGRESS', action: 'unfollowed', username, stats: { ...stats }, total: dailyLimit });
          }
        } else {
          stats.skipped++;
          sessionLog.push({ time: now(), username, action: 'skipped', reason: 'no confirm dialog' });
          chrome.runtime.sendMessage({ type: 'UNFOLLOW_PROGRESS', action: 'skipped', username, stats: { ...stats }, total: dailyLimit });
        }
      } catch (e) {
        stats.skipped++;
        sessionLog.push({ time: now(), username, action: 'error', reason: e.message });
        chrome.runtime.sendMessage({ type: 'UNFOLLOW_PROGRESS', action: 'skipped', username, stats: { ...stats }, total: dailyLimit });
      }
    }

    if (stopRequested || stats.unfollowed >= dailyLimit) break;

    // Stale check
    if (processed.size === lastProcessed) {
      stale++;
      if (stale >= 5) break;
    } else {
      stale = 0;
    }
    lastProcessed = processed.size;

    // ── Occasional scroll-back (10% chance) ──────────────────────────────
    if (Math.random() < 0.10) {
      window.scrollBy({ top: -(window.innerHeight * (0.3 + Math.random() * 0.5)), behavior: 'smooth' });
      await sleep(800 + rand(600));
    }

    // ── 3. Variable scroll speed — not fixed 2s ───────────────────────────
    // Sometimes fast, sometimes slow — like a human reading at different pace
    const scrollAmount = window.innerHeight * (0.4 + Math.random() * 0.7);
    const scrollPause  = randomScrollPause(); // see helper below
    window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    await sleep(scrollPause);
  }

  return stats;
}

// ══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(max)  { return Math.floor(Math.random() * max); }

function randomDelay(minSec, maxSec) {
  return Math.round((minSec + Math.random() * (maxSec - minSec)) * 1000);
}

// Variable scroll pause — mostly 1.5–3s, occasionally 4–8s (reading pause)
function randomScrollPause() {
  if (Math.random() < 0.15) return 4000 + rand(4000); // 15% — slow reader
  return 1500 + rand(1500);                            // 85% — normal scroll
}

function getText(el) {
  return (el?.innerText || el?.textContent || '').trim().toLowerCase();
}

function isMutual(cell) {
  // Method 1: X marks mutual followers with a specific testid
  if (cell.querySelector('[data-testid="userFollowIndicator"]')) return true;

  // Method 2: look for the "Follows you" badge element specifically
  // X renders it as a styled span, not always caught by innerText on virtual DOM
  const spans = cell.querySelectorAll('span');
  for (const span of spans) {
    const t = (span.textContent || '').trim().toLowerCase();
    if (t === 'follows you' || t === 'follows you back') return true;
  }

  // Method 3: fallback to full cell text (works when cell is in viewport)
  const cellText = getText(cell);
  return cellText.includes('follows you') || cellText.includes('follows you back');
}

function getUsername(cell) {
  const link = cell.querySelector('a[href^="/"]:not([href*="/status/"]):not([href*="/intent/"])');
  if (link) return link.getAttribute('href').split('/').filter(Boolean)[0] || 'unknown';
  return 'unknown';
}

function findFollowingButton(cell) {
  const byId = cell.querySelector('[data-testid$="-follow"],[data-testid*="unfollow"],[data-testid*="following"]');
  if (byId) return byId;
  return Array.from(cell.querySelectorAll('div[role="button"],button'))
    .find(b => { const t = getText(b); return t === 'following' || t.includes('unfollow'); }) || null;
}

async function waitForConfirm(timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const btn =
      document.querySelector('[data-testid="confirmationSheetConfirm"]') ||
      document.querySelector('div[role="button"][data-testid*="unfollow"]') ||
      document.querySelector('button[data-testid*="unfollow"]') ||
      Array.from(document.querySelectorAll('button')).find(b => getText(b) === 'unfollow');
    if (btn) return btn;
    await sleep(300);
  }
  return null;
}

async function waitForCells(timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.querySelectorAll('[data-testid="UserCell"]').length >= 3) return true;
    await sleep(500);
  }
  return false;
}

// ── Session log ────────────────────────────────────────────────────────────
let sessionLog = [];

function now() {
  return new Date().toLocaleTimeString('en', { hour12: false });
}

async function saveSessionLog(accountUsername, stats) {
  const entry = {
    date:       new Date().toISOString(),
    account:    accountUsername,
    unfollowed: stats.unfollowed,
    skipped:    stats.skipped,
    scanned:    stats.scanned,
    log:        sessionLog.slice(), // copy
  };

  // Load existing history
  const stored = await new Promise(resolve =>
    chrome.storage.local.get(['sessionHistory'], r => resolve(r.sessionHistory || []))
  );

  // Keep last 50 sessions
  stored.unshift(entry);
  if (stored.length > 50) stored.length = 50;

  await new Promise(resolve =>
    chrome.storage.local.set({ sessionHistory: stored }, resolve)
  );

  console.log('[SafeUnfollow] Session saved:', entry.date, 'unfollowed:', stats.unfollowed);
}

// After unfollow, check if cell now shows "Follow Back" — means it was a mutual
async function checkAndReFollowIfMutual(cell, username) {
  // Wait a moment for button state to update
  await sleep(600);

  // Check cell text for "Follow Back" indicator
  const cellText = getText(cell);
  const hasFollowBack =
    cellText.includes('follow back') ||
    !!cell.querySelector('[data-testid="userFollowIndicator"]');

  if (!hasFollowBack) return false;

  console.log('[SafeUnfollow] Mutual detected after unfollow — re-following @' + username);

  // Find the now-"Follow" button and click it
  const followBtn =
    cell.querySelector('[data-testid$="-follow"]') ||
    Array.from(cell.querySelectorAll('div[role="button"],button'))
      .find(b => { const t = getText(b); return t === 'follow' || t === 'follow back'; });

  if (followBtn) {
    await realisticClick(followBtn);
    await sleep(800);
    return true;
  }

  return false;
}

} // end duplicate-run guard
