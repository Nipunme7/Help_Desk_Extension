"""
FastAPI app: CORS, routes for POST/GET /api/viewing and POST /api/heartbeat.
Delegates storage to viewing module.
"""
import logging
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import viewing

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Help Desk viewing API")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"[{client_ip}] {request.method} {request.url.path}")
    response = await call_next(request)
    return response

# Allow any origin so extensions on other PCs can call this backend (local help-desk only).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # must be False when allow_origins is "*"
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ViewingBody(BaseModel):
    ticket_id: str = Field(..., min_length=1)
    uuid: str = Field(..., min_length=1)


@app.post("/api/viewing")
def post_viewing(body: ViewingBody):
    """Register or refresh: this machine is viewing this ticket."""
    logger.info(f"Registering: uuid={body.uuid[:8]}... ticket_id={body.ticket_id}")
    viewing.add_or_refresh(uuid=body.uuid, ticket_id=body.ticket_id)
    return {"ok": True}


@app.post("/api/heartbeat")
def post_heartbeat(body: ViewingBody):
    """Update last-seen time for an existing viewing."""
    if not viewing.heartbeat(uuid=body.uuid, ticket_id=body.ticket_id):
        raise HTTPException(status_code=404, detail="no such viewing")
    return {"ok": True}


@app.get("/api/viewing")
def get_viewing(ticket_id: str = Query(..., min_length=1)):
    """Return list of active viewings for this ticket (recent heartbeat)."""
    result = viewing.get_active(ticket_id=ticket_id)
    logger.info(f"GET viewing ticket_id={ticket_id}: {len(result)} device(s)")
    return result
