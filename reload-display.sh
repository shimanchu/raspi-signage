#!/bin/sh
set -eu
URL="${SIGNAGE_URL:-http://127.0.0.1:8080}"
PROFILE="$HOME/.config/raspi-signage-chromium"
export DISPLAY="${DISPLAY:-:0}"
pkill chromium 2>/dev/null || true
sleep 1
chromium --kiosk --password-store=basic --user-data-dir="$PROFILE" --noerrdialogs --disable-infobars --disable-session-crashed-bubble --app="$URL" >/tmp/raspi-signage-chromium.log 2>&1 &
echo "Display reloaded: $URL"
