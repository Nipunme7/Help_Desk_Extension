# Help Desk Ticket Conflict Warning

A small Chrome extension + local FastAPI backend for a help desk (up to ~10 computers) that share one Google Chrome profile. When two people are viewing the same Kbox ticket (same ticket ID) on different machines, the extension shows a warning so you can avoid duplicate work and duplicate messaging on the same ticket.

**Constraints:** Python (FastAPI) backend only; everything runs locally on your network—no cloud hosting.

---

## How It Works

1. **Chrome extension** (on each help desk computer) watches open tabs for URLs like `kbox.luther.edu` with a ticket ID (e.g. from `?id=12345` or your actual Kbox URL pattern).
2. When you’re on a ticket, the extension tells the **local FastAPI server** “this machine is viewing ticket X” and sends a **heartbeat** every 15–20 seconds.
3. If someone on **another** computer is already viewing the same ticket (and their heartbeat is recent), the extension shows a **warning**: “Someone else is working on this ticket.”
4. If a computer closes the tab, closes the browser, or goes offline, heartbeats stop. The server treats **missing heartbeats** (e.g. after 45–60 seconds) as “left the ticket” and stops showing that machine in the “who’s viewing” list.

So: same Chrome profile, same Kbox, different machines—you get a simple “someone else has this ticket open” alert and a heartbeat so the server knows who’s still there.

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Computer 1      │     │  Computer 2      │     │  Computer N      │
│  Chrome +       │     │  Chrome +        │     │  Chrome +        │
│  Extension      │     │  Extension      │     │  Extension       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  POST /viewing        │  POST /viewing        │
         │  POST /heartbeat      │  GET /viewing?ticket  │
         │  GET /viewing         │  (warning shown)     │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  One machine on LAN     │
                    │  FastAPI (Python)       │
                    │  - Who is on which ticket
                    │  - Heartbeat timeout    │
                    │  - Optional WebSocket   │
                    └─────────────────────────┘
```

- **Extension**: Detects Kbox ticket URLs → registers + heartbeats → asks “who’s on this ticket?” → shows warning if another machine is there.
- **Backend**: Stores `ticket_id → [machine_id, last_heartbeat]`; removes entries when heartbeat is too old (tab closed / computer off).

---

## Components

### 1. Chrome Extension

- **Manifest V3** with:
  - Host permission **`<all_urls>`** so the extension can read any tab URL and call any host (including your backend). In code you still only act on `kbox.luther.edu` URLs and your API.
  - `tabs` permission to read tab URLs.
- **Background service worker**:
  - Listens to tab updates/activation/removal.
  - Parses URLs for `kbox.luther.edu` and extracts the **ticket ID** (from query or path, depending on Kbox).
  - When user is on a ticket:
    - `POST /api/viewing` to register “this machine is viewing this ticket.”
    - Send `POST /api/heartbeat` every 15–20 seconds.
  - When user leaves the ticket tab (or closes it): stop heartbeat; optionally `DELETE /api/viewing`.
  - Periodically (or on WebSocket message): ask “who’s viewing this ticket?”; if another machine with recent heartbeat is in the list → show warning.
- **Machine ID**: One **UUID** per install, stored in `chrome.storage.local`, so the same computer is always the same “machine” to the server.
- **UI**: Browser action popup and/or badge: “Someone else is working on this ticket.” Optional: content script on Kbox pages for an inline banner.

### 2. FastAPI Backend (Python, Local Only)

- **Storage**: One in-memory list. Each item is a dict with four keys:
  - **`uuid`** — which machine (browser install)
  - **`ticket_id`** — which ticket they’re on
  - **`heartbeat`** — last heartbeat timestamp (e.g. Unix seconds or ISO string)
  - **`status`** — e.g. `"active"` (stale entries get removed or set inactive)
  - Example: `{ "uuid": "abc-123", "ticket_id": "456", "heartbeat": 1708234567.89, "status": "active" }`
- **Endpoints**:
  - `POST /api/viewing`  
    Body: `{ "ticket_id": "12345", "uuid": "..." }`  
    → Append a new record or find existing (same uuid + ticket_id) and update `heartbeat` and `status` to active.
  - `POST /api/heartbeat`  
    Body: `{ "ticket_id": "12345", "uuid": "..." }`  
    → Find record with that uuid + ticket_id; set `heartbeat` to now.
  - `GET /api/viewing?ticket_id=12345`  
    → Return list of records for this ticket where `status == "active"` and `heartbeat` is within the last 45–60 seconds (drop or mark stale others).
- **Heartbeat timeout**: On each read or periodically: if `heartbeat` is older than 45–60 seconds, remove that record or set `status` to inactive. That’s the only cleanup.
- **CORS**: Allow origins so the extension (on any of the 10 machines) can call the API. For now **localhost** is enough for local dev. Later you also need: **(1)** the **machine running the backend** (so that PC’s extension can call its own API, e.g. `http://192.168.1.50:8000`), and **(2)** **other computers on the same network** (they’ll use the server’s LAN URL). In practice, allow at least: `http://localhost:8000`, `http://127.0.0.1:8000`, and `http://<server_lan_ip>:8000` (e.g. `http://192.168.1.50:8000`). Optionally allow any origin on your LAN if you prefer (e.g. `http://192.168.0.0/16`-style or a list of known IPs).
- **Optional**: WebSocket endpoint so the server can push “someone else just opened this ticket” for instant warnings without polling.

### 3. Network Setup

- One machine on your LAN runs the FastAPI server (could be one of the 10 help desk PCs or a small local server). Run it with **`--host 0.0.0.0`** so it listens on all interfaces and other computers on the same network can connect (not only localhost).
- All 10 computers’ extensions are configured with that server’s URL (e.g. `http://192.168.1.50:8000`), via a config in the extension or in the popup.
- No public hosting; everything stays on your local network.

---

## Heartbeat and “Tab Closed / Computer Off”

- The extension sends a heartbeat only **while** the user has a Kbox ticket tab open (and that tab is considered “viewing” that ticket).
- If the user closes the tab, switches away, or the computer goes off: heartbeats stop.
- The backend **does not** rely on an explicit “I’m leaving” call. It only uses **last_heartbeat**:
  - After **45–60 seconds** with no heartbeat, that machine is removed from “viewing” that ticket.
- So: **tab closed**, **browser closed**, or **computer off** are all handled by “no more heartbeats → timeout → removed from ticket.”

Optionally, the extension can send a “leaving” request when the tab is closed or the user navigates away, so the list updates a bit faster; the timeout still covers crashes and power-off.

---

## Summary Table

| Component      | Responsibility |
|----------------|----------------|
| **Extension**  | Detect `kbox.luther.edu` URLs with ticket ID → register + heartbeat to FastAPI; ask “who’s on this ticket?” → show warning if another machine has recent heartbeat; optional WebSocket for instant updates. |
| **FastAPI**    | One list of dicts: `uuid`, `ticket_id`, `heartbeat`, `status`. Timeout stale heartbeats (~60 s); CORS for extension. |
| **Hosting**    | One machine runs FastAPI; all 10 computers point the extension at that server’s LAN URL. |

---

## Project Layout (Suggested)

```
Help_Desk/
├── README.md                 # This file
├── backend/                  # FastAPI app (Python)
│   ├── main.py               # App, routes, CORS
│   ├── viewing.py            # In-memory store + cleanup
│   ├── test.py               # Tests (e.g. pytest)
│   └── requirements.txt
└── extension/                # Chrome extension
    ├── manifest.json
    ├── background.js         # Tab monitoring, URL parsing, API calls, heartbeat
    ├── popup/
    │   ├── popup.html
    │   └── popup.js
    └── content/              # Optional: inline banner on Kbox pages
        └── banner.js
```

---

## Backend (deeper)

Yes — **main.py**, **viewing.py**, **test.py**, and **requirements.txt** are all you need. No DB, no extra services.

### What each file does

| File | Responsibility |
|------|----------------|
| **main.py** | Create FastAPI app, add CORS (so the extension can call the API), define the 3 routes (POST viewing, POST heartbeat, GET viewing), and call into `viewing` for storage. Optional: small Pydantic models for request bodies. |
| **viewing.py** | Hold the single in-memory list (the dicts with uuid, ticket_id, heartbeat, status) and expose 3 functions: **add_or_refresh(uuid, ticket_id)**, **heartbeat(uuid, ticket_id)**, **get_active(ticket_id)**. `get_active` also prunes stale entries (heartbeat older than e.g. 60 seconds). No SQLite, no other deps. |
| **test.py** | Tests for the backend (e.g. pytest): test viewing store (add, heartbeat, get_active, stale cleanup) and/or FastAPI routes with `TestClient`. |
| **requirements.txt** | `fastapi` and `uvicorn`. Add `pytest` and `httpx` if you use pytest and TestClient. That’s enough to run and test the app. |

### What you don’t need

- **No SQLite** — one list in memory is enough; data is “who’s viewing now,” not permanent.
- **No separate config file** — e.g. heartbeat timeout can be a constant in `viewing.py`; port in `main.py` or CLI.
- **No separate router module** — routes can live in `main.py`.
- **No separate schemas file** — request/response can be plain dicts or a couple of Pydantic models in `main.py`.
- **No auth** — local LAN, trusted help-desk machines only.

### Run

From `backend/`:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

- **`--host 0.0.0.0`** — Bind to all interfaces so the server is reachable from **other computers on the same network** (not only from the machine running the server). Without this, only localhost could connect.
- Other PCs and the server machine itself then use the server’s LAN URL (e.g. `http://192.168.1.50:8000`) in the extension. CORS must allow that origin (and localhost for dev); see the CORS note above.

---

## Next Steps

1. Confirm the **exact Kbox URL pattern** (e.g. `?id=`, `?ticket=`, or path like `/ticket/12345`) so the extension parses the ticket ID correctly.
2. Implement the **FastAPI backend**: routes above + in-memory store + heartbeat timeout cleanup (see Backend (deeper)).
3. Implement the **Chrome extension**: manifest, background script (URL parsing, register, heartbeat, “who’s viewing?”), and popup/badge for the warning.
4. Configure the extension with the server’s **LAN URL** and install on all 10 machines.

Once those are in place, you’ll have a local-only, no-online-hosting setup that warns when someone else is working on the same ticket and uses heartbeats to detect when they’ve left (tab closed or computer off).
