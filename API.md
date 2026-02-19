# API routes — parameters and behavior

Detail on the three backend routes: purpose, request parameters/bodies, responses, and behavior.

---

## 1. **POST `/api/viewing`** — Register or refresh “I’m viewing this ticket”

**Purpose:** Tell the server “this machine (uuid) is currently viewing this ticket.” Called when the user opens or focuses a Kbox ticket tab. Creates a record if none exists, or refreshes heartbeat and status if it does.

**Request**

- **Method:** `POST`
- **Path:** `/api/viewing`
- **Body (JSON):**

| Field        | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `ticket_id` | string | Yes      | Ticket ID from the Kbox URL (e.g. `"12345"` or `"TK-789"`). |
| `uuid`      | string | Yes      | Unique ID for this browser/install (from extension’s `chrome.storage`). |

- **Example:**  
  `{ "ticket_id": "12345", "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }`

**Response**

- **Success (200 or 201):** Body can be minimal, e.g.  
  `{ "ok": true }`  
  or include the record:  
  `{ "ok": true, "ticket_id": "12345", "uuid": "...", "heartbeat": 1708234567.89, "status": "active" }`
- **Validation error (422):** Missing or invalid `ticket_id` / `uuid` (e.g. empty string) → FastAPI/Pydantic validation.

**Behavior**

- If there is no record for this `(uuid, ticket_id)`: append one with `heartbeat = now`, `status = "active"`.
- If a record already exists: set `heartbeat = now` and `status = "active"` (idempotent refresh).

---

## 2. **POST `/api/heartbeat`** — “I’m still on this ticket”

**Purpose:** Update the last-seen time for an existing viewing. The extension calls this every 15–20 seconds while the user has the ticket tab open. Keeps the record from being pruned as stale.

**Request**

- **Method:** `POST`
- **Path:** `/api/heartbeat`
- **Body (JSON):**

| Field        | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `ticket_id` | string | Yes      | Same ticket ID as in `/api/viewing`. |
| `uuid`      | string | Yes      | Same uuid as in `/api/viewing`. |

- **Example:**  
  `{ "ticket_id": "12345", "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }`

**Response**

- **Success (200):** e.g.  
  `{ "ok": true }`  
  or  
  `{ "ok": true, "heartbeat": 1708234567.89 }`
- **Not found (404):** No record for this `(uuid, ticket_id)` (e.g. already pruned or never registered). Extension can treat this as “re-register with POST /api/viewing.”
- **Validation error (422):** Missing/invalid `ticket_id` or `uuid`.

**Behavior**

- Find the single record matching `uuid` + `ticket_id`.
- Set `heartbeat = now` (and optionally ensure `status = "active"`).
- If no such record: return 404; do not create one (creation is only via POST /api/viewing).

---

## 3. **GET `/api/viewing`** — “Who is viewing this ticket?”

**Purpose:** Used by the extension to see who else (if anyone) is currently viewing the same ticket. If there are other uuids with a recent heartbeat, the extension shows “Someone else is working on this ticket.”

**Request**

- **Method:** `GET`
- **Path:** `/api/viewing`
- **Query parameters:**

| Parameter   | Type   | Required | Description |
|------------|--------|----------|-------------|
| `ticket_id`| string | Yes      | Ticket ID to look up. |

- **Example:**  
  `GET /api/viewing?ticket_id=12345`

**Response**

- **Success (200):** JSON array of viewing records for that ticket that are still considered “active” (recent heartbeat, e.g. within last 45–60 seconds). Each item has the same shape as your storage dict.

  **Response body shape (conceptually):**  
  List of objects with: `uuid`, `ticket_id`, `heartbeat`, `status`.

  **Example:**  
  ```json
  [
    { "uuid": "aaa-111", "ticket_id": "12345", "heartbeat": 1708234567.89, "status": "active" },
    { "uuid": "bbb-222", "ticket_id": "12345", "heartbeat": 1708234565.12, "status": "active" }
  ]
  ```

- **Empty list:** No one (or no one else) viewing → `[]`.
- **Validation error (422):** Missing or invalid `ticket_id` (e.g. empty).

**Behavior**

- Filter storage for records where `ticket_id` matches the query and `heartbeat` is within the last N seconds (e.g. 60) and `status == "active"`.
- **Cleanup:** When computing this list (or in a small helper used here), remove or mark as inactive any record for *any* ticket whose `heartbeat` is older than the threshold. So “who’s viewing?” also prunes stale entries.
- Optionally **exclude the caller’s uuid** from the list so the extension can ask “who *else* is viewing?” and only show a warning when the list is non-empty. If you don’t exclude, the extension can filter out its own uuid on the client.

---

## Summary table

| Route              | Method | Parameters (body vs query)        | Returns |
|--------------------|--------|-----------------------------------|---------|
| `/api/viewing`     | POST   | Body: `ticket_id`, `uuid`         | 200/201 + `{ "ok": true }` (or + record). 422 if invalid. |
| `/api/heartbeat`   | POST   | Body: `ticket_id`, `uuid`         | 200 + `{ "ok": true }`. 404 if no record. 422 if invalid. |
| `/api/viewing`     | GET    | Query: `ticket_id`                | 200 + list of `{ uuid, ticket_id, heartbeat, status }`. 422 if missing/invalid `ticket_id`. |

---

## Optional: same shape for all records

If you want one Pydantic model for both storage and API:

- **Record:** `uuid`, `ticket_id`, `heartbeat` (float or int, e.g. Unix time), `status` (string, e.g. `"active"`).
- **POST /api/viewing request:** `ticket_id`, `uuid` (no heartbeat/status; server sets them).
- **POST /api/heartbeat request:** `ticket_id`, `uuid`.
- **GET /api/viewing response:** list of that record shape.

That keeps the API and the in-memory list in `viewing.py` aligned and gives you a clear contract for the extension to call these three routes with the parameters above.
