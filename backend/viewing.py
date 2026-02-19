"""
In-memory store: list of { uuid, ticket_id, heartbeat, status }.
Exposes add_or_refresh, heartbeat, get_active. get_active prunes stale entries.
"""
import time

# Consider a record stale if no heartbeat for this many seconds.
HEARTBEAT_TIMEOUT_SEC = 60

_viewings: list[dict] = []


def add_or_refresh(uuid: str, ticket_id: str) -> None:
    """Add a new viewing or refresh heartbeat/status for existing (uuid, ticket_id)."""
    now = time.time()
    for r in _viewings:
        if r["uuid"] == uuid and r["ticket_id"] == ticket_id:
            r["heartbeat"] = now
            r["status"] = "active"
            return
    _viewings.append({
        "uuid": uuid,
        "ticket_id": ticket_id,
        "heartbeat": now,
        "status": "active",
    })


def heartbeat(uuid: str, ticket_id: str) -> bool:
    """Update heartbeat for (uuid, ticket_id). Return True if found, False otherwise."""
    now = time.time()
    for r in _viewings:
        if r["uuid"] == uuid and r["ticket_id"] == ticket_id:
            r["heartbeat"] = now
            r["status"] = "active"
            return True
    return False


def _prune_stale() -> None:
    """Remove records whose heartbeat is older than HEARTBEAT_TIMEOUT_SEC."""
    cutoff = time.time() - HEARTBEAT_TIMEOUT_SEC
    _viewings[:] = [r for r in _viewings if r["heartbeat"] >= cutoff]


def get_active(ticket_id: str) -> list[dict]:
    """Prune stale entries, then return active records for this ticket_id."""
    _prune_stale()
    return [
        {**r}
        for r in _viewings
        if r["ticket_id"] == ticket_id and r["status"] == "active"
    ]


def clear() -> None:
    """Clear all viewings (for testing only)."""
    _viewings.clear()
