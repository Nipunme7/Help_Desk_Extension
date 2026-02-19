"""
Tests: viewing store (add_or_refresh, heartbeat, get_active, stale cleanup)
and FastAPI routes (POST/GET /api/viewing, POST /api/heartbeat) via TestClient.
"""
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import viewing
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_viewings():
    """Reset viewing store before each test so tests don't affect each other."""
    viewing.clear()
    yield
    viewing.clear()


# ---- viewing module ----

def test_add_or_refresh_creates_record():
    viewing.add_or_refresh("uuid-1", "ticket-1")
    active = viewing.get_active("ticket-1")
    assert len(active) == 1
    assert active[0]["uuid"] == "uuid-1"
    assert active[0]["ticket_id"] == "ticket-1"
    assert active[0]["status"] == "active"
    assert "heartbeat" in active[0]


def test_add_or_refresh_updates_existing():
    viewing.add_or_refresh("uuid-1", "ticket-1")
    time.sleep(0.01)
    viewing.add_or_refresh("uuid-1", "ticket-1")
    active = viewing.get_active("ticket-1")
    assert len(active) == 1
    assert active[0]["uuid"] == "uuid-1"


def test_heartbeat_returns_true_when_found():
    viewing.add_or_refresh("uuid-1", "ticket-1")
    assert viewing.heartbeat("uuid-1", "ticket-1") is True


def test_heartbeat_returns_false_when_not_found():
    assert viewing.heartbeat("uuid-1", "ticket-1") is False


def test_get_active_returns_only_matching_ticket():
    viewing.add_or_refresh("uuid-1", "ticket-1")
    viewing.add_or_refresh("uuid-2", "ticket-2")
    viewing.add_or_refresh("uuid-3", "ticket-1")
    active = viewing.get_active("ticket-1")
    assert len(active) == 2
    uuids = {r["uuid"] for r in active}
    assert uuids == {"uuid-1", "uuid-3"}


def test_get_active_prunes_stale():
    with patch.object(viewing, "HEARTBEAT_TIMEOUT_SEC", 0.1):
        viewing.add_or_refresh("uuid-1", "ticket-1")
        time.sleep(0.2)
        active = viewing.get_active("ticket-1")
    assert len(active) == 0


# ---- API routes ----

def test_post_viewing_200():
    r = client.post("/api/viewing", json={"ticket_id": "123", "uuid": "my-uuid"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_post_viewing_then_get_viewing():
    client.post("/api/viewing", json={"ticket_id": "123", "uuid": "my-uuid"})
    r = client.get("/api/viewing", params={"ticket_id": "123"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["ticket_id"] == "123"
    assert data[0]["uuid"] == "my-uuid"
    assert data[0]["status"] == "active"


def test_post_heartbeat_200_when_exists():
    client.post("/api/viewing", json={"ticket_id": "123", "uuid": "my-uuid"})
    r = client.post("/api/heartbeat", json={"ticket_id": "123", "uuid": "my-uuid"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_post_heartbeat_404_when_not_found():
    r = client.post("/api/heartbeat", json={"ticket_id": "123", "uuid": "no-such"})
    assert r.status_code == 404


def test_get_viewing_empty():
    r = client.get("/api/viewing", params={"ticket_id": "nonexistent"})
    assert r.status_code == 200
    assert r.json() == []


def test_post_viewing_missing_ticket_id_422():
    r = client.post("/api/viewing", json={"uuid": "my-uuid"})
    assert r.status_code == 422


def test_post_viewing_missing_uuid_422():
    r = client.post("/api/viewing", json={"ticket_id": "123"})
    assert r.status_code == 422


def test_post_viewing_empty_strings_422():
    r = client.post("/api/viewing", json={"ticket_id": "", "uuid": "x"})
    assert r.status_code == 422
    r = client.post("/api/viewing", json={"ticket_id": "x", "uuid": ""})
    assert r.status_code == 422


def test_get_viewing_missing_ticket_id_422():
    r = client.get("/api/viewing")
    assert r.status_code == 422


def test_get_viewing_empty_ticket_id_422():
    r = client.get("/api/viewing", params={"ticket_id": ""})
    assert r.status_code == 422
