#!/usr/bin/env bash
set -euo pipefail

PLIST_NAME="com.kokoro-pdf.tts.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"

log() { echo "[Kokoro] $1"; }

if [ -f "$PLIST_DST" ]; then
  log "Unloading LaunchAgent..."
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  rm "$PLIST_DST"
  log "LaunchAgent removed. Kokoro TTS will no longer auto-start."
else
  log "LaunchAgent not installed. Nothing to do."
fi
