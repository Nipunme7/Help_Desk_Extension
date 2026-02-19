# Backend (FastAPI)

Run the server:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Run tests:

```bash
pytest test.py -v
```

### If pytest fails with `ModuleNotFoundError: No module named 'greenlet'`

Your global Python has **pytest-playwright** installed, which requires **greenlet**. Use one of these:

**Option A — Install the missing dependency (quick fix):**

```bash
pip install greenlet
```

Then run `pytest test.py -v` again.

**Option B — Use the project venv (no playwright):**

From the `backend/` folder:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pytest test.py -v
```

Use `.venv/bin/pytest` and `.venv/bin/uvicorn` for this project so global plugins don’t interfere.
