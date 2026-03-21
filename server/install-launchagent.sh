#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.kokoro-pdf.tts.plist"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
DOCKER_PATH="$(command -v docker 2>/dev/null || echo '/usr/local/bin/docker')"

log() { echo "[Kokoro] $1"; }

# Ensure LaunchAgents directory exists
mkdir -p "$HOME/Library/LaunchAgents"

# Unload existing agent if present
if launchctl list 2>/dev/null | grep -q "com.kokoro-pdf.tts"; then
  log "Unloading existing LaunchAgent..."
  launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# Copy and configure the plist
log "Installing LaunchAgent..."
sed \
  -e "s|__COMPOSE_FILE__|$COMPOSE_FILE|g" \
  -e "s|/usr/local/bin/docker|$DOCKER_PATH|g" \
  "$PLIST_SRC" > "$PLIST_DST"

# Load the agent
launchctl load "$PLIST_DST"

log "LaunchAgent installed and loaded."
log "Kokoro TTS will now start automatically on login."
log "Verify with: launchctl list | grep kokoro"
