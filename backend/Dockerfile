FROM python:3.10-slim

WORKDIR /app

# Node 20+ for staff review-sheet 3D renderer (backend/render/cli.mjs + Playwright).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Build context must be ProvinceSystem root so shared/ pack constants are available.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Cache the renderer's packages, Chromium and system libraries before copying code.
# --ignore-scripts skips the postinstall build until its sources are available.
WORKDIR /app/render
COPY backend/render/package.json backend/render/package-lock.json ./
RUN npm ci --ignore-scripts \
    && npx playwright install chromium \
    && npx playwright install-deps chromium

WORKDIR /app
COPY backend/ .
# constants.py resolves ProvinceSystem/shared via parents[4] → /shared/...
COPY shared /shared
# Shared Three.js helpers (also synced locally via scripts/sync-skins.mjs before build).
COPY frontend/lib/skins /app/render/src/skins

# The renderer's own bundle, which the skipped postinstall would have built.
WORKDIR /app/render
RUN npm run build

WORKDIR /app

EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
