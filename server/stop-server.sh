#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "[Kokoro] Stopping Kokoro-FastAPI server..."
docker compose -f "$COMPOSE_FILE" down
echo "[Kokoro] Server stopped."
