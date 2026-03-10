#!/usr/bin/env bash
# Stop the detached dev server started by run_dev_detached.sh
set -euo pipefail
PIDFILE=".dev_server.pid"
if [ ! -f "$PIDFILE" ]; then
  echo "No PID file found. No detached dev server appears to be running."
  exit 0
fi
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  echo "Killing PID $PID"
  kill "$PID"
  sleep 1
  rm -f "$PIDFILE"
  echo "Stopped dev server"
else
  echo "Process $PID not running; removing stale PID file"
  rm -f "$PIDFILE"
fi
