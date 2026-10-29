#!/usr/bin/env bash
# One-time setup on a Mac: Homebrew packages, Python venv, npm packages, AI models.
# Safe to re-run; it only installs what is missing.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed. Install it from https://brew.sh and run this script again."
  exit 1
fi

say "Homebrew packages (ffmpeg with Rubber Band, Python 3.11, Node)"
for pkg in ffmpeg rubberband python@3.11 node; do
  brew list --versions "$pkg" >/dev/null 2>&1 || brew install "$pkg"
done

say "Python environment (service/.venv)"
PY="$(brew --prefix python@3.11)/bin/python3.11"
[ -x "$PY" ] || PY="$(command -v python3.11)"
if [ ! -x service/.venv/bin/python ]; then
  "$PY" -m venv service/.venv
fi
service/.venv/bin/pip install --upgrade pip >/dev/null
service/.venv/bin/pip install -r service/requirements.txt

say "npm packages (web/node_modules)"
(cd web && npm install)

say "AI models (Demucs htdemucs ~80 MB, Whisper small ~460 MB; cached after the first time)"
service/.venv/bin/python - <<'PY'
from demucs.pretrained import get_model
get_model("htdemucs")
print("Demucs ready")
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")
print("Whisper ready")
PY

say "All set. Start the app with ./start.sh"
