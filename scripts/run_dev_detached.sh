#!/usr/bin/env bash
# Run Next.js dev server in background using nohup and save PID to .dev_server.pid
set -euo pipefail
PIDFILE=".dev_server.pid"
LOGFILE=".dev.log"

if [ -f "$PIDFILE" ]; then
  if kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    echo "Dev server already running with PID $(cat $PIDFILE)"
    exit 0
  else
    echo "Stale PID file found. Removing..."
    rm -f "$PIDFILE"
  fi
fi

# Start in background
nohup npm run dev > "$LOGFILE" 2>&1 &
PID=$!
# Give it a moment to start
sleep 1
# Check if process is still alive
if kill -0 "$PID" 2>/dev/null; then
  echo "$PID" > "$PIDFILE"
  echo "Started dev server with PID $PID. Logs: $LOGFILE"
  exit 0
else
  echo "Failed to start dev server. See $LOGFILE for details."
  exit 2
fi
