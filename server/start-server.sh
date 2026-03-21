#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
SERVER_URL="http://localhost:8880"
MAX_WAIT=120
POLL_INTERVAL=3

log() { echo "[Kokoro] $1"; }
err() { echo "[Kokoro] ERROR: $1" >&2; }

# Check Docker is installed and running
if ! command -v docker &>/dev/null; then
  err "Docker is not installed. Install Docker Desktop from https://docker.com"
  exit 1
fi

if ! docker info &>/dev/null; then
  err "Docker daemon is not running. Start Docker Desktop first."
  exit 1
fi

# Start the container
log "Starting Kokoro-FastAPI server..."
docker compose -f "$COMPOSE_FILE" up -d

# Wait for the server to become healthy
log "Waiting for server to be ready (this may take 30-60s on first run)..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  if curl -sf "$SERVER_URL/v1/audio/voices" >/dev/null 2>&1; then
    log "Server is ready at $SERVER_URL"
    log "Test with: curl $SERVER_URL/v1/audio/voices"
    exit 0
  fi
  sleep $POLL_INTERVAL
  elapsed=$((elapsed + POLL_INTERVAL))
  log "  Still waiting... (${elapsed}s / ${MAX_WAIT}s)"
done

err "Server did not become ready within ${MAX_WAIT}s."
err "Check logs with: docker compose -f $COMPOSE_FILE logs"
exit 1
