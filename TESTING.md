# Automating test scripts

How to run and automate tests for the Help Desk backend (and optionally the extension), without writing the tests themselves here—just the approach and tooling.

---

## What to test

- **Backend (Python):**  
  - **viewing.py** — `add_or_refresh`, `heartbeat`, `get_active` (including stale cleanup). Use a fresh in-memory store per test (or reset between tests) so tests don’t depend on order.  
  - **main.py** — HTTP routes with FastAPI’s `TestClient`: POST/GET `/api/viewing`, POST `/api/heartbeat`, status codes, response bodies. Mock or use the real in-memory viewing store; no real server needed.
- **Extension (optional):**  
  - Unit tests for URL parsing or small helpers (e.g. in Node with Jest, or in the browser). Automating “full” extension tests (real Chrome, real tabs) is heavier; often you run those manually or in a separate flow.

This doc focuses on **backend test automation**.

---

## Tooling (backend)

- **pytest** — Discover and run tests in `test.py` (or `tests/`), assert behavior, use fixtures (e.g. fresh app/store).
- **httpx** — Used by FastAPI’s `TestClient` to hit your app in-process (no live server). Already in `requirements.txt`.

Run all backend tests from the project root or from `backend/`:

```bash
cd backend
pytest
```

Or from repo root:

```bash
pytest backend/
```

Use `-v` for verbose, `-x` to stop on first failure, `--tb=short` for shorter tracebacks.

---

## Automating runs (when tests execute)

**1. By hand**  
- Run `pytest` (or `pytest backend/`) whenever you change backend code. No setup; good for local dev.

**2. Before commit / pre-commit (local)**  
- **Pre-commit hook:** Run `pytest backend/` in a git pre-commit hook so failing tests block the commit.  
- **Manual habit:** e.g. “always run pytest before git push.”

**3. In a pipeline (CI)**  
- **GitHub Actions / GitLab CI / etc.:** One job that (a) sets up Python, (b) installs deps (`pip install -r backend/requirements.txt`), (c) runs `pytest backend/` (or `pytest backend/ -v`).  
- No server, no browser needed—just Python + pytest.  
- Optionally: run on every push to `main` and on pull requests; fail the pipeline if pytest exits non-zero.

**4. In the editor/IDE**  
- Many editors run pytest when you save or via a “Run tests” action. Uses the same `pytest` command above; automation is “on save” or “on demand” in the UI.

---

## Test layout and discovery

- **Single file:** Keep tests in `backend/test.py`. Pytest finds it with `pytest backend/`.  
- **Package later:** If you add more test files, use `backend/tests/` with `test_*.py` (e.g. `test_viewing.py`, `test_main.py`). Then run `pytest backend/tests/` or `pytest backend/`.  
- **Fixtures:** Use `@pytest.fixture` for a fresh FastAPI app and/or a fresh viewing store so each test gets a clean state. Share fixtures in `test.py` or in `conftest.py` inside `backend/` (or `backend/tests/`).

---

## What “automation” means here

- **Automate** = “run tests without manually remembering every step.”  
  - **Local:** Run `pytest backend/` (or hook it into pre-commit / editor).  
  - **CI:** Pipeline runs the same command on push/PR; you get a red/green result without running tests yourself.  
- You are **not** (in this doc) writing the actual test cases—only how to run and automate the test script (pytest) and where it fits (local, pre-commit, CI, editor).

---

## Summary

| Where        | How to automate                                      |
|-------------|------------------------------------------------------|
| **Local**   | Run `pytest backend/` (or `pytest backend/ -v`). Optionally pre-commit hook. |
| **CI**      | One job: install deps, run `pytest backend/`; fail pipeline on non-zero exit. |
| **Editor**  | Use IDE’s pytest integration; same command.          |

Keep tests fast (in-memory store, TestClient, no real HTTP server), so automation stays quick and can run often.
