# X / Twitter Safe Unfollow — Chrome Extension

> Automatically unfollow non-followers on X (Twitter) with human-like behavior to minimize detection risk.

---

## Features

### Core Functionality
- **Smart unfollow** — only unfollows accounts that don't follow you back; mutual followers are always skipped
- **Multi-account support** — detects all logged-in X accounts and processes them in queue automatically
- **Auto-scroll** — scrolls the Following page and processes accounts simultaneously, handles X's virtual DOM (elements outside viewport are removed by X and reloaded on scroll)
- **Duplicate prevention** — tracks processed usernames in a Set; each account is handled exactly once per session

### Human-Like Behavior
- **Realistic mouse events** — every click dispatches a full chain: `mouseover → mousemove → mouseenter → mousedown → mouseup → click → mouseleave` with real element coordinates and random jitter (never clicks dead center)
- **Click-based navigation** — navigates to `/following` by clicking the profile link and "Following" tab in the UI, not via `window.location.href`
- **Random delays** — configurable min/max delay between unfollows (default 3–10s)
- **Mini-breaks** — automatic pause of 45s–2min every 10–15 unfollows, mimicking natural fatigue
- **Variable scroll speed** — 85% normal pace (1.5–3s), 15% slow reading pace (4–8s); scroll distance is randomized each time
- **Occasional scroll-back** — 10% chance of scrolling up slightly before continuing down (natural reading behavior)
- **Post-unfollow pause** — 1–2s pause after confirming each unfollow before moving to the next account
- **Profile browsing** — 15% chance of opening a profile before unfollowing, then going back (simulates curiosity)

### Safety & Reliability
- **Tab visibility detection** — pauses automatically when the browser tab is hidden or inactive; resumes with a short random delay after the tab becomes active again
- **Captcha / rate-limit detection** — monitors the page for signs of account lock, suspension, captcha prompts, or rate limiting; stops immediately and alerts the user if detected
- **Daily limit per account** — configurable cap (default 50/day) with persistent counter that resets at midnight
- **Duplicate-run guard** — prevents the content script from running more than one session at a time
- **Confirmation dialog polling** — waits up to 7s with 4 fallback selectors for the unfollow confirmation dialog, robust to X UI changes

### Multi-Account Queue
- **Auto-detects logged-in accounts** from X's sidebar account switcher DOM
- **Account switching via UI clicks** — uses X's native account switcher (click avatar → select account), not cookie manipulation
- **Selective processing** — choose individual accounts or run all selected accounts in sequence
- **Configurable pause between accounts** — default 30s gap between switching accounts
- **Per-account stats** — tracks unfollowed/skipped count separately for each account in the session

### UI
- **3-tab popup** — Run (stats + progress), Accounts (account list + selection), Settings
- **Live counters** — Scanned / Unfollowed / Skipped update in real time
- **Activity log** — timestamped log of every action in the popup
- **Queue visualization** — shows which account is active and which are done/waiting in multi-account mode
- **One-click stop** — stops the session immediately at any point

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Daily limit / account | 50 | Max unfollows per account per day |
| Min delay | 3s | Minimum wait between unfollows |
| Max delay | 10s | Maximum wait between unfollows |
| Pause between accounts | 30s | Wait time when switching accounts |

---

## Installation

1. Download and unzip the extension folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the unzipped folder
5. The extension icon will appear in your toolbar

---

## How to Use

### Single account
1. Log in to [x.com](https://x.com)
2. Click the extension icon
3. Click **▶ START** — the extension navigates to your Following page automatically
4. Watch the live log and stats; click **■ STOP** at any time

### Multiple accounts
1. Make sure all accounts are already logged in via X's native account switcher
2. Click the extension icon → go to the **👤 Accounts** tab
3. Click **↻ Refresh** to detect all logged-in accounts
4. Check/uncheck the accounts you want to process
5. In the **▶ Run** tab, select **ALL SELECTED** mode
6. Click **▶ START** — the extension processes each account in order, switching between them automatically

---

## Safety Notes

- Keep the daily limit at **50 or below** per account — this is the recommended safe threshold based on community experience
- The extension works best when the browser tab is **visible and active** — it auto-pauses when you switch away
- If X shows a captcha or locks your account, the extension **stops automatically** and notifies you
- All actions are performed through the browser UI — no API calls, no cookie manipulation

---

## What This Extension Does NOT Do

- Does not store passwords or authentication tokens
- Does not make direct API calls to X
- Does not modify cookies or local storage
- Does not unfollow mutual followers (accounts that follow you back)
- Does not run in the background when the popup is closed and no session is active

---

## Technical Notes

**On `isTrusted: false`** — all browser-dispatched events from JavaScript have `isTrusted: false`. This is a hard browser security limit that cannot be bypassed from an extension content script. The extension compensates by dispatching a full realistic event chain with accurate coordinates, timing, and movement values.

**On X's virtual DOM** — X removes DOM elements that scroll out of the viewport to save memory. The extension handles this by processing visible cells immediately while scrolling, rather than trying to collect all cells upfront.

---

## Permissions Used

| Permission | Reason |
|---|---|
| `activeTab` | Read and interact with the current X tab |
| `scripting` | Inject the content script |
| `storage` | Save settings and daily counter locally |
| `host_permissions` (x.com, twitter.com) | Run on X pages |

---

## License

MIT
