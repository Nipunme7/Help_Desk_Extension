/**
 * Content script on help.luther.edu/adminui/ticket.php: scrapes username,
 * parses ticket ID from ?ID=, registers with backend, shows conflict banner with names.
 */
(function () {
  const SELECTOR = '.k-contact-user-info-name';

  function getTicketIdFromUrl() {
    const id = new URL(window.location.href).searchParams.get('ID');
    return id && id.trim() ? String(id).trim() : null;
  }

  function extractUsername() {
    const el = document.querySelector(SELECTOR);
    if (!el) return null;
    let text = (el.textContent || '').trim();
    // Strip trailing role suffix like " - SW"
    text = text.replace(/\s*-\s*SW$/i, '').trim();
    return text || null;
  }

  function showBanner(names) {
    const existing = document.getElementById('helpdesk-ticket-warning');
    if (existing) existing.remove();
    if (!names || names.length === 0) return;
    const div = document.createElement('div');
    div.id = 'helpdesk-ticket-warning';
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:10px;text-align:center;z-index:999999;font-family:system-ui,sans-serif;font-size:14px;';
    const verb = names.length === 1 ? 'is' : 'are';
    div.textContent = names.join(', ') + ' ' + verb + ' working on this ticket.';
    document.body.prepend(div);
  }

  function hideBanner() {
    const el = document.getElementById('helpdesk-ticket-warning');
    if (el) el.remove();
  }

  function tryScrapeAndRegister() {
    const ticketId = getTicketIdFromUrl();
    const username = extractUsername();
    if (!ticketId || !username) return false;
    console.log('[HelpDesk] Scraped username:', username, 'ticket_id:', ticketId);
    chrome.runtime.sendMessage(
      {
        type: 'registerViewing',
        ticket_id: ticketId,
        url: window.location.href,
        username,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[HelpDesk] registerViewing error:', chrome.runtime.lastError);
        } else {
          console.log('[HelpDesk] Registered with backend');
        }
      }
    );
    return true;
  }

  function checkConflict() {
    const ticketId = getTicketIdFromUrl();
    if (!ticketId) {
      hideBanner();
      return;
    }
    chrome.runtime.sendMessage({ type: 'getViewing', ticketId }, (res) => {
      if (!res || !res.others || res.others.length === 0) {
        hideBanner();
        return;
      }
      const names = res.others.map((o) => o.username || 'Unknown').filter(Boolean);
      if (names.length > 0) {
        showBanner(names);
      } else {
        hideBanner();
      }
    });
  }

  function start() {
    // Only register when this tab is visible so we store data for the active tab only.
    if (document.visibilityState !== 'visible') {
      checkConflict();
      return;
    }
    if (tryScrapeAndRegister()) {
      checkConflict();
    } else {
      const observer = new MutationObserver(() => {
        if (document.visibilityState !== 'visible') return;
        if (tryScrapeAndRegister()) {
          observer.disconnect();
          checkConflict();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        if (document.visibilityState === 'visible' && extractUsername()) tryScrapeAndRegister();
        checkConflict();
      }, 10000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  setInterval(checkConflict, 5000);

  // Only the visible (active) tab should register. When user switches TO this tab,
  // we re-register; when this tab becomes hidden, tell background to stop so we
  // don't rely on the service worker being awake for onTabActivated (MV3).
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      const ticketId = getTicketIdFromUrl();
      if (!ticketId) return;
      if (tryScrapeAndRegister()) checkConflict();
      else checkConflict();
    } else {
      const ticketId = getTicketIdFromUrl();
      if (ticketId) {
        chrome.runtime.sendMessage({ type: 'tabHidden', ticket_id: ticketId });
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'tabActivatedForTicket') {
      if (tryScrapeAndRegister()) checkConflict();
      else checkConflict();
    }
  });
})();
