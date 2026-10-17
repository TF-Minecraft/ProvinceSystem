"""Re-embed every precedent case from its summary alone.

Run after changing what `_case_text()` embeds. Old rows carry vectors built
from the whole record (summary + rule + ruling + punishment); leaving them
mixed with summary-only vectors would make distances incomparable between
rows, so the whole corpus has to be rebuilt in one pass.

Only the `embedding` column is written. Case text is never modified.

    cd backend && python -m src.scripts.backfill_precedent_embeddings --dry-run
    cd backend && python -m src.scripts.backfill_precedent_embeddings
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_SRC = _BACKEND_ROOT / "src"
for _p in (str(_BACKEND_ROOT), str(_BACKEND_SRC)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from dotenv import load_dotenv

load_dotenv(_BACKEND_ROOT / ".env")

from src import database
from src.precedent.db import vector_literal
from src.precedent.embeddings import EmbeddingError, embed_batch

# Voyage accepts large batches; 100 keeps requests well inside its limits.
BATCH = 100
# Voyage's free tier rate-limits bursts, so back off and retry rather than
# aborting a half-finished backfill.
RETRIES = 5
RETRY_SLEEP_SEC = 30.0
BATCH_SLEEP_SEC = 3.0


def _embed_with_retry(texts: list[str]) -> list[list[float]]:
    for attempt in range(RETRIES):
        try:
            return embed_batch(texts)
        except EmbeddingError as e:
            if attempt == RETRIES - 1:
                raise
            print(f"    embedding failed ({e}); retrying in {RETRY_SLEEP_SEC:.0f}s")
            time.sleep(RETRY_SLEEP_SEC)
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Embed and report, but do not write to the database.",
    )
    args = parser.parse_args()

    try:
        with database.connect() as conn:
            rows = conn.execute("SELECT id, summary FROM precedent_cases ORDER BY created_at").fetchall()
    except database.NotConfiguredError:
        raise SystemExit("DATABASE_URL is not set")

    total = len(rows)
    print(f"{total} cases to re-embed" + (" (dry run)" if args.dry_run else ""))
    if not total:
        return

    done = 0
    for start in range(0, total, BATCH):
        chunk = rows[start : start + BATCH]
        vectors = _embed_with_retry([r["summary"] for r in chunk])
        if len(vectors) != len(chunk):
            raise SystemExit(
                f"Voyage returned {len(vectors)} vectors for {len(chunk)} inputs; aborting"
            )

        if not args.dry_run:
            with database.connect() as conn:
                conn.cursor().executemany(
                    "UPDATE precedent_cases SET embedding = %s WHERE id = %s",
                    [(vector_literal(v), r["id"]) for v, r in zip(vectors, chunk)],
                )

        done += len(chunk)
        print(f"  {done}/{total}")
        if start + BATCH < total:
            time.sleep(BATCH_SLEEP_SEC)

    print("done" + (" (nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
