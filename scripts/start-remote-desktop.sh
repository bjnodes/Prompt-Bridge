#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUMBER="${DISPLAY_NUMBER:-:99}"
XVFB_RESOLUTION="${XVFB_RESOLUTION:-1440x960x24}"
VNC_PORT="${VNC_PORT:-5901}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
RUNTIME_DIR="${RUNTIME_DIR:-$HOME/.prompt-bridge-runtime}"

mkdir -p "$RUNTIME_DIR"

pkill -f "Xvfb $DISPLAY_NUMBER" >/dev/null 2>&1 || true
pkill -f "x11vnc .*rfbport $VNC_PORT" >/dev/null 2>&1 || true
pkill -f "novnc_proxy .* --listen $NOVNC_PORT" >/dev/null 2>&1 || true
pkill -f "fluxbox" >/dev/null 2>&1 || true

Xvfb "$DISPLAY_NUMBER" -screen 0 "$XVFB_RESOLUTION" -ac +extension RANDR >"$RUNTIME_DIR/xvfb.log" 2>&1 &
sleep 1

export DISPLAY="$DISPLAY_NUMBER"
fluxbox >"$RUNTIME_DIR/fluxbox.log" 2>&1 &
sleep 1

x11vnc -display "$DISPLAY_NUMBER" -forever -shared -nopw -rfbport "$VNC_PORT" >"$RUNTIME_DIR/x11vnc.log" 2>&1 &
sleep 1

if command -v novnc_proxy >/dev/null 2>&1; then
  novnc_proxy --listen "$NOVNC_PORT" --vnc "127.0.0.1:$VNC_PORT" >"$RUNTIME_DIR/novnc.log" 2>&1 &
elif [ -x /usr/share/novnc/utils/novnc_proxy ]; then
  /usr/share/novnc/utils/novnc_proxy --listen "$NOVNC_PORT" --vnc "127.0.0.1:$VNC_PORT" >"$RUNTIME_DIR/novnc.log" 2>&1 &
else
  echo "novnc_proxy command not found. Install noVNC before running this script." >&2
  exit 1
fi

echo "Remote desktop started."
echo "DISPLAY=$DISPLAY_NUMBER"
echo "VNC port=$VNC_PORT"
echo "noVNC port=$NOVNC_PORT"
