#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR/.kokoro-native"
SERVER_URL="http://localhost:8880"
MAX_WAIT=120
POLL_INTERVAL=3

log() { echo "[Kokoro] $1"; }
err() { echo "[Kokoro] ERROR: $1" >&2; }

# Check for Homebrew and espeak dependency
if ! command -v brew &>/dev/null; then
  err "Homebrew is required. Install from https://brew.sh"
  exit 1
fi

if ! command -v espeak-ng &>/dev/null && ! command -v espeak &>/dev/null; then
  log "Installing espeak-ng via Homebrew..."
  brew install espeak-ng
fi

# Install uv if not present
if ! command -v uv &>/dev/null; then
  log "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# Clone Kokoro-FastAPI if not already present
if [ ! -d "$INSTALL_DIR" ]; then
  log "Cloning Kokoro-FastAPI..."
  git clone https://github.com/remsky/Kokoro-FastAPI.git "$INSTALL_DIR"
else
  log "Kokoro-FastAPI already cloned. Pulling latest..."
  git -C "$INSTALL_DIR" pull
fi

# Start the server
log "Starting Kokoro-FastAPI in CPU mode..."
cd "$INSTALL_DIR"

if [ -f "start-cpu.sh" ]; then
  chmod +x start-cpu.sh
  ./start-cpu.sh &
elif [ -f "docker/scripts/start-cpu.sh" ]; then
  chmod +x docker/scripts/start-cpu.sh
  ./docker/scripts/start-cpu.sh &
else
  log "Falling back to uv run..."
  uv run python -m api.src.main &
fi

SERVER_PID=$!
echo "$SERVER_PID" > "$SCRIPT_DIR/.kokoro-native.pid"

# Wait for the server to become healthy
log "Waiting for server to be ready..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  if curl -sf "$SERVER_URL/v1/audio/voices" >/dev/null 2>&1; then
    log "Server is ready at $SERVER_URL (PID: $SERVER_PID)"
    exit 0
  fi
  sleep $POLL_INTERVAL
  elapsed=$((elapsed + POLL_INTERVAL))
  log "  Still waiting... (${elapsed}s / ${MAX_WAIT}s)"
done

err "Server did not become ready within ${MAX_WAIT}s."
kill "$SERVER_PID" 2>/dev/null || true
exit 1
