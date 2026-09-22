import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

# Load backend/.env (gitignored) before any env-based auth/signing.
load_dotenv(Path(__file__).resolve().parent / ".env")

from src.api.prod_guard import assert_production_safe

assert_production_safe()

# --------------------
# Logging (warnings+)
# --------------------
logging.basicConfig(
    level=logging.WARNING,
    format="%(message)s"
)
logger = logging.getLogger("startup")

# --------------------
# Startup confirmation
# --------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    from src.skins.db import migrate

    migrate()
    logger.warning("ProvinceSystem API started on http://0.0.0.0:8000")
    yield


app = FastAPI(lifespan=lifespan)

# --------------------------------
# CORS MUST BE ADDED BEFORE ROUTERS
# --------------------------------
origins = [
    "https://www.tfminecraft.net",
    "https://tfminecraft.net",  # optional
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3100",  # .claude/launch.json frontend port
    "http://127.0.0.1:3100",
    "http://localhost:13001",
    "http://127.0.0.1:13001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],  # required for images
)

# ------------------------------------------------
# GZip (JSON only - never re-compress binary bodies)
# ------------------------------------------------
# The geometry/metadata JSON this API serves is large and highly compressible;
# the PNG/WebP/gzip bodies are already compressed, so re-deflating them burns
# CPU for nothing (and would undo the WebP savings).
#
# Least invasive option: no wrapper class and no router split - Starlette's own
# GZipMiddleware already skips any response whose content-type is in
# exclude_content_types. Passing the tuple explicitly rather than leaning on the
# library default also means an unpinned Starlette that predates the option
# fails loudly at startup (TypeError on the unknown kwarg) instead of silently
# re-compressing images.
EXCLUDED_FROM_GZIP = (
    "application/gzip",
    "application/x-gzip",
    "application/zip",
    "audio/*",
    "font/woff",
    "font/woff2",
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/event-stream",
    "video/*",
)

app.add_middleware(
    GZipMiddleware,
    minimum_size=1000,
    exclude_content_types=EXCLUDED_FROM_GZIP,
)

@app.get("/ping")
def ping():
    return {"ok": True}

# --------------------
# Routers (AFTER CORS)
# --------------------
from src.api.editor_routes import editor_router
from src.api.map_routes import map_router
from src.api.data_routes import data_router
from src.api.banner_routes import banner_router
from src.api.chronicle_routes import chronicle_router
from src.api.chronicle_staff_routes import chronicle_staff_router
from src.api.ledger_routes import ledger_router
from src.api.claim_routes import claim_router
from src.api.regen_routes import regen_router
from src.api.file_routes import file_router
from src.api.maps_routes import maps_router
from src.api.profile_routes import profile_router
from src.api.skins_routes import skins_router
from src.api.characters_routes import characters_router
from src.api.drinks_routes import drinks_router
from src.api.precedent_routes import precedent_router
from src.api.wars_routes import wars_router

app.include_router(map_router)
app.include_router(editor_router)
app.include_router(data_router)
app.include_router(maps_router)
app.include_router(banner_router)
app.include_router(claim_router)
app.include_router(chronicle_router)
# Staff-only chronicle wipe/restore. Separate router from the read routes: it
# is the only chronicle surface behind ensure_map_staff_write.
app.include_router(chronicle_staff_router)
# Economy series read API. `chronicle` here is the map timelapse; `ledger` is
# the SimpleFactions economy snapshot series - two different things.
app.include_router(ledger_router)
app.include_router(regen_router)
app.include_router(file_router)
app.include_router(skins_router)
app.include_router(profile_router)
app.include_router(characters_router)
app.include_router(drinks_router)
app.include_router(precedent_router)
app.include_router(wars_router)
