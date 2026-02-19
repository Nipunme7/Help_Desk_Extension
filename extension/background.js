/**
 * Service worker: tab monitoring, Kbox URL parsing, API calls (viewing + heartbeat), heartbeat timer.
 * Only this file talks to the backend. Popup/content get data via chrome.runtime.sendMessage.
 */

const DEFAULT_API_BASE = 'http://localhost:8000';

// --- Storage keys ---
const KEY_UUID = 'helpdesk_uuid';
const KEY_API_BASE = 'helpdesk_api_base';

// --- State ---
let heartbeatIntervalId = null;
let currentTicketId = null;
let currentUuid = null;

/**
 * Get or create a stable UUID for this browser install.
 * @returns {Promise<string>}
 */
async function getOrCreateUuid() {
  const { [KEY_UUID]: stored } = await chrome.storage.local.get(KEY_UUID);
  if (stored) return stored;
  const uuid = crypto.randomUUID();
  await chrome.storage.local.set({ [KEY_UUID]: uuid });
  return uuid;
}

/**
 * Get API base URL (no trailing slash).
 * @returns {Promise<string>}
 */
async function getApiBase() {
  const { [KEY_API_BASE]: base } = await chrome.storage.local.get(KEY_API_BASE);
  return (base && base.trim()) || DEFAULT_API_BASE;
}

/**
 * Parse ticket ID from a Katie URL (katie.luther.edu). Adjust regex to match your real URL pattern.
 * @param {string} url
 * @returns {string|null} ticket id or null
 */
function parseTicketIdFromUrl(url) {
  if (!url || !url.includes('katie.luther.edu')) return null;
  try {
    const u = new URL(url);
    // Check query params first: id, ticket_id, ticket
    const id = u.searchParams.get('id') || u.searchParams.get('ticket_id') || u.searchParams.get('ticket');
    if (id && id.trim()) return String(id).trim();
    // Fallback: check path patterns (e.g., /ticket/123 or /course/123)
    const pathMatch = u.pathname.match(/\/ticket\/([^/]+)/i) || u.pathname.match(/\/course\/([^/]+)/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1].trim();
    return null;
  } catch (e) {
    console.error('[HelpDesk] URL parse error:', e, url);
    return null;
  }
}

/**
 * POST /api/viewing — register this machine as viewing this ticket.
 */
async function apiRegisterViewing(ticketId, uuid) {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/viewing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, uuid }),
  });
  if (!res.ok) throw new Error(`viewing ${res.status}`);
  return res.json();
}

/**
 * POST /api/heartbeat — refresh last-seen for this ticket.
 */
async function apiHeartbeat(ticketId, uuid) {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, uuid }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`heartbeat ${res.status}`);
  return res.json();
}

/**
 * GET /api/viewing?ticket_id= — list who is viewing this ticket.
 */
async function apiGetViewing(ticketId) {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/viewing?ticket_id=${encodeURIComponent(ticketId)}`);
  if (!res.ok) throw new Error(`get viewing ${res.status}`);
  return res.json();
}

/**
 * Start heartbeat timer for (ticketId, uuid). Clears any existing timer.
 */
function startHeartbeat(ticketId, uuid) {
  stopHeartbeat();
  currentTicketId = ticketId;
  currentUuid = uuid;
  const intervalMs = 18 * 1000;
  heartbeatIntervalId = setInterval(async () => {
    if (!currentTicketId || !currentUuid) return;
    try {
      await apiHeartbeat(currentTicketId, currentUuid);
    } catch {
      // Network or server down; optional: re-register via apiRegisterViewing
    }
  }, intervalMs);
}

function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  currentTicketId = null;
  currentUuid = null;
}

/**
 * Handle a tab update: check if URL is a Kbox ticket, then register + heartbeat and check for others.
 */
async function onTabUpdated(tabId, changeInfo, tab) {
  const url = changeInfo.url ?? tab?.url;
  if (!url) return;
  console.log('[HelpDesk] Tab URL:', url);
  const ticketId = parseTicketIdFromUrl(url);
  console.log('[HelpDesk] Parsed ticket ID:', ticketId);
  if (!ticketId) {
    stopHeartbeat();
    return;
  }
  const uuid = await getOrCreateUuid();
  try {
    await apiRegisterViewing(ticketId, uuid);
    startHeartbeat(ticketId, uuid);
    const viewers = await apiGetViewing(ticketId);
    const others = (viewers || []).filter((v) => v.uuid !== uuid);
    if (others.length > 0) {
      await chrome.action.setBadgeText({ text: '!', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#c00', tabId });
    } else {
      await chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch {
    await chrome.action.setBadgeText({ text: '', tabId });
  }
}

/**
 * Tab activated: if the active tab is a Kbox ticket, treat same as update.
 */
async function onTabActivated(activeInfo) {
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (tab?.url) await onTabUpdated(activeInfo.tabId, { url: tab.url }, tab);
}

/**
 * Tab removed: stop heartbeat if it was for this tab (we don't track tabId in heartbeat, so we clear if current tab is closed — simplified).
 */
function onTabRemoved() {
  stopHeartbeat();
}

chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onRemoved.addListener(onTabRemoved);

/**
 * Popup/content can ask for: getStatus, getApiBase, setApiBase, getViewing(ticketId).
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'getStatus') {
      const uuid = await getOrCreateUuid();
      return { uuid, ticketId: currentTicketId, apiBase: await getApiBase() };
    }
    if (msg.type === 'getApiBase') return { apiBase: await getApiBase() };
    if (msg.type === 'setApiBase') {
      await chrome.storage.local.set({ [KEY_API_BASE]: msg.apiBase || '' });
      return { ok: true };
    }
    if (msg.type === 'getViewing' && msg.ticketId) {
      const list = await apiGetViewing(msg.ticketId);
      const myUuid = await getOrCreateUuid();
      const others = (list || []).filter((v) => v.uuid !== myUuid);
      return { viewers: list, others };
    }
    return null;
  })().then(sendResponse);
  return true;
});
