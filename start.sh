#!/usr/bin/env bash
# Starts NoteAlong on this Mac: the processing service (port 8000) and the web app (port 3001).
# Port 3000 is left alone (another project uses it). Press Ctrl-C to stop both.
# Runs ./setup.sh first if the environment is missing. Always the local version: the online (cloud)
# settings are ignored here even if they are set in this shell.
set -euo pipefail
cd "$(dirname "$0")"

WEB_PORT=3001
API_PORT=8000

if [ ! -x service/.venv/bin/uvicorn ] || [ ! -d web/node_modules ]; then
  echo "Environment not set up yet; running ./setup.sh first."
  ./setup.sh
fi

busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }
for port in "$API_PORT" "$WEB_PORT"; do
  pid=$(busy "$port")
  if [ -n "$pid" ]; then
    echo "Port $port is already in use by process $pid ($(ps -o comm= -p "$pid" | xargs basename)). Stop it, then run ./start.sh again."
    exit 1
  fi
done

# the local version: no Supabase settings, the normal build folder
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY PROCESSING_URL WORKER_SECRET NEXT_DIST_DIR
export NEXT_PUBLIC_API_URL="http://localhost:$API_PORT"

mkdir -p logs
echo "Starting the processing service on http://localhost:$API_PORT (log: logs/service.log)"
(cd service && exec .venv/bin/uvicorn notealong.main:app --host 127.0.0.1 --port "$API_PORT") >logs/service.log 2>&1 &
SERVICE_PID=$!

echo "Starting the web app on http://localhost:$WEB_PORT (log: logs/web.log)"
(cd web && exec npx next dev --port "$WEB_PORT") >logs/web.log 2>&1 &
WEB_PID=$!

cleanup() { echo; echo "Stopping…"; kill "$SERVICE_PID" "$WEB_PID" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

ready=""
for _ in $(seq 1 90); do
  if curl -sf "http://localhost:$API_PORT/api/health" >/dev/null 2>&1 && curl -sf -o /dev/null "http://localhost:$WEB_PORT"; then ready=1; break; fi
  kill -0 "$SERVICE_PID" 2>/dev/null || { echo "The processing service stopped; see logs/service.log"; exit 1; }
  kill -0 "$WEB_PID" 2>/dev/null || { echo "The web app stopped; see logs/web.log"; exit 1; }
  sleep 1
done

echo
if [ -n "$ready" ]; then
  echo "NoteAlong is running. Open:  http://localhost:$WEB_PORT"
else
  echo "Still starting (see logs/). It will be at:  http://localhost:$WEB_PORT"
fi
echo "Press Ctrl-C to stop both servers."
wait
