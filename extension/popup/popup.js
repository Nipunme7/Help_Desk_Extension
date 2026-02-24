/**
 * Popup UI: show status (uuid, current ticket), "someone else on this ticket" warning, and backend URL config.
 * Talks to background via chrome.runtime.sendMessage; does not call the API directly.
 */

const statusEl = document.getElementById('status');
const warningRow = document.getElementById('warningRow');
const warningText = document.getElementById('warningText');
const apiBaseInput = document.getElementById('apiBase');
const saveApiBtn = document.getElementById('saveApi');

async function loadStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getStatus' });
    if (!res) {
      statusEl.textContent = 'Not available';
      return;
    }
    const parts = [`UUID: ${(res.uuid || '').slice(0, 8)}…`];
    if (res.ticketId) parts.push(`Ticket: ${res.ticketId}`);
    else parts.push('No ticket tab active');
    statusEl.textContent = parts.join(' · ');

    if (res.ticketId) {
      const viewing = await chrome.runtime.sendMessage({ type: 'getViewing', ticketId: res.ticketId });
      if (viewing && viewing.others && viewing.others.length > 0) {
        const names = viewing.others.map((o) => o.username || 'Unknown').filter(Boolean);
        warningRow.style.display = 'block';
        const verb = names.length === 1 ? 'is' : 'are';
        warningText.textContent = names.join(', ') + ' ' + verb + ' working on this ticket.';
      } else {
        warningRow.style.display = 'none';
      }
    } else {
      warningRow.style.display = 'none';
    }
  } catch (e) {
    statusEl.textContent = 'Error: ' + (e.message || 'unknown');
    warningRow.style.display = 'none';
  }
}

async function loadApiBase() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getApiBase' });
    apiBaseInput.value = res?.apiBase || 'http://localhost:8000';
  } catch {
    apiBaseInput.value = 'http://localhost:8000';
  }
}

saveApiBtn.addEventListener('click', async () => {
  const base = (apiBaseInput.value || '').trim();
  await chrome.runtime.sendMessage({ type: 'setApiBase', apiBase: base });
  saveApiBtn.textContent = 'Saved';
  setTimeout(() => { saveApiBtn.textContent = 'Save'; }, 1500);
});

loadStatus();
loadApiBase();
