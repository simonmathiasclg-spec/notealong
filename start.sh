#!/usr/bin/env bash
# Starts the processing service (port 8000) and the web app (port 3000).
# Press Ctrl-C to stop both. Runs ./setup.sh first if the environment is missing.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x service/.venv/bin/uvicorn ] || [ ! -d web/node_modules ]; then
  echo "Environment not set up yet; running ./setup.sh first."
  ./setup.sh
fi

mkdir -p logs
echo "Starting the processing service on http://localhost:8000 (log: logs/service.log)"
(cd service && exec .venv/bin/uvicorn notealong.main:app --host 127.0.0.1 --port 8000) >logs/service.log 2>&1 &
SERVICE_PID=$!

echo "Starting the web app on http://localhost:3000 (log: logs/web.log)"
(cd web && exec npm run dev -- --port 3000) >logs/web.log 2>&1 &
WEB_PID=$!

cleanup() { echo; echo "Stopping…"; kill "$SERVICE_PID" "$WEB_PID" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup INT TERM EXIT

for _ in $(seq 1 60); do
  curl -sf http://localhost:8000/api/health >/dev/null 2>&1 && curl -sf http://localhost:3000 >/dev/null 2>&1 && break
  sleep 1
done

echo
echo "NoteAlong is running. Open:  http://localhost:3000"
echo "Press Ctrl-C to stop both servers."
wait
