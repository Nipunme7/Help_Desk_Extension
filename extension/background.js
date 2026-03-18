/**
 * Service worker: tab monitoring, help.luther.edu ticket parsing, API calls (viewing + heartbeat).
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
 */
async function getOrCreateUuid() {
  const { [KEY_UUID]: stored } = await chrome.storage.local.get(KEY_UUID);
  if (stored) return stored;
  const uuid = crypto.randomUUID();
  await chrome.storage.local.set({ [KEY_UUID]: uuid });
  return uuid;
}

async function getApiBase() {
  const { [KEY_API_BASE]: base } = await chrome.storage.local.get(KEY_API_BASE);
  return (base && base.trim()) || DEFAULT_API_BASE;
}

/**
 * Parse ticket ID from help.luther.edu/adminui/ticket.php?ID=...
 */
function parseTicketIdFromUrl(url) {
  if (!url || !url.includes('help.luther.edu/adminui/ticket.php')) return null;
  try {
    const id = new URL(url).searchParams.get('ID');
    return id && id.trim() ? String(id).trim() : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/viewing — register with uuid, ticket_id, url, username.
 */
async function apiRegisterViewing(ticketId, uuid, url, username) {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/viewing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: ticketId, uuid, url, username }),
  });
  if (!res.ok) throw new Error(`viewing ${res.status}`);
  return res.json();
}

/**
 * POST /api/heartbeat — refresh last-seen.
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
 * GET /api/viewing?ticket_id= — list who is viewing (includes username).
 */
async function apiGetViewing(ticketId) {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/viewing?ticket_id=${encodeURIComponent(ticketId)}`);
  if (!res.ok) throw new Error(`get viewing ${res.status}`);
  return res.json();
}

function startHeartbeat(ticketId, uuid) {
  stopHeartbeat();
  currentTicketId = ticketId;
  currentUuid = uuid;
  const intervalMs = 10 * 1000;
  heartbeatIntervalId = setInterval(async () => {
    if (!currentTicketId || !currentUuid) return;
    try {
      const result = await apiHeartbeat(currentTicketId, currentUuid);
      if (!result) {
        try {
          const tab = await chrome.tabs.query({ active: true, currentWindow: true });
          const u = tab[0]?.url || '';
          await apiRegisterViewing(currentTicketId, currentUuid, u, '');
        } catch {
          /* ignore */
        }
      }
    } catch {
      try {
        const tab = await chrome.tabs.query({ active: true, currentWindow: true });
        const u = tab[0]?.url || '';
        await apiRegisterViewing(currentTicketId, currentUuid, u, '');
      } catch {
        /* ignore */
      }
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

async function onTabUpdated(tabId, changeInfo, tab) {
  const url = changeInfo.url ?? tab?.url;
  if (!url) return;
  const ticketId = parseTicketIdFromUrl(url);
  if (!ticketId) {
    stopHeartbeat();
    await chrome.action.setBadgeText({ text: '', tabId }).catch(() => { });
  }
}

async function onTabActivated(activeInfo) {
  // Always stop the previous heartbeat; only the newly active tab can restart it.
  stopHeartbeat();
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (tab?.url && parseTicketIdFromUrl(tab.url)) {
    // Tell the ticket tab to (re)register itself with username and update conflicts.
    try {
      chrome.tabs.sendMessage(activeInfo.tabId, { type: 'tabActivatedForTicket' });
    } catch {
      // Ignore if no content script is attached.
    }
  }
}

function onTabRemoved() {
  stopHeartbeat();
}

chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onRemoved.addListener(onTabRemoved);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
    if (msg.type === 'tabHidden' && msg.ticket_id) {
      if (currentTicketId === msg.ticket_id) stopHeartbeat();
      return { ok: true };
    }
    if (msg.type === 'registerViewing' && msg.ticket_id && msg.username) {
      const uuid = await getOrCreateUuid();
      const tabId = sender.tab?.id;
      try {
        await apiRegisterViewing(msg.ticket_id, uuid, msg.url || '', msg.username);
        startHeartbeat(msg.ticket_id, uuid);
        const viewers = await apiGetViewing(msg.ticket_id);
        const others = (viewers || []).filter((v) => v.uuid !== uuid);
        if (others.length > 0 && tabId) {
          await chrome.action.setBadgeText({ text: '!', tabId });
          await chrome.action.setBadgeBackgroundColor({ color: '#c00', tabId });
        } else if (tabId) {
          await chrome.action.setBadgeText({ text: '', tabId });
        }
        return { ok: true };
      } catch (e) {
        console.error('[HelpDesk] registerViewing error:', e);
        return { ok: false, error: String(e) };
      }
    }
    return null;
  })().then(sendResponse);
  return true;
});
