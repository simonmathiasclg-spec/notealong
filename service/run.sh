#!/usr/bin/env bash
# Starts the processing service on http://localhost:8000
cd "$(dirname "$0")"
source .venv/bin/activate
exec uvicorn notealong.main:app --host 127.0.0.1 --port 8000 "$@"
