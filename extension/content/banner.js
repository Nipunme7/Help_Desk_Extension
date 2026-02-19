/**
 * Content script on katie.luther.edu: optional inline banner when someone else is viewing this ticket.
 * Gets data from background via chrome.runtime.sendMessage; does not call the API directly.
 */

(function () {
  function showBanner(message) {
    const existing = document.getElementById('helpdesk-ticket-warning');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.id = 'helpdesk-ticket-warning';
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:10px;text-align:center;z-index:999999;font-family:system-ui,sans-serif;font-size:14px;';
    div.textContent = message;
    document.body.prepend(div);
  }

  function hideBanner() {
    const el = document.getElementById('helpdesk-ticket-warning');
    if (el) el.remove();
  }

  function getTicketIdFromUrl() {
    const u = new URL(window.location.href);
    const id = u.searchParams.get('id') || u.searchParams.get('ticket_id') || u.searchParams.get('ticket');
    if (id) return String(id).trim();
    const m = window.location.pathname.match(/\/ticket\/([^/]+)/i) || window.location.pathname.match(/\/[^/]+\/([^/]+)/);
    return m ? m[1].trim() : null;
  }

  function checkAndShowBanner() {
    const ticketId = getTicketIdFromUrl();
    if (!ticketId) {
      hideBanner();
      return;
    }
    if (!chrome?.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'getViewing', ticketId }, (res) => {
      if (res && res.others && res.others.length > 0) {
        showBanner('Someone else is working on this ticket. Avoid duplicate messages.');
      } else {
        hideBanner();
      }
    });
  }

  checkAndShowBanner();
  setInterval(checkAndShowBanner, 15000);
})();
