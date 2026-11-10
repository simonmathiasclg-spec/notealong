#!/bin/sh
# Run ONE heavy job (Demucs, Whisper, pitch tracking, rendering, imports) with thread caps, after
# checking that the machine has room for it. Last time several jobs at once filled the swap and lost
# a night. Usage: scripts/heavy.sh <command...>
need_mb=${NOTEALONG_HEAVY_MIN_MB:-5000}
free_mb=$(vm_stat | awk '/Pages free/ {f=$3} /Pages inactive/ {i=$3} /Pages speculative/ {s=$3} END {gsub(/\./,"",f); gsub(/\./,"",i); gsub(/\./,"",s); print int((f+i+s)*16/1024)}')
if [ "$free_mb" -lt "$need_mb" ]; then
  echo "heavy.sh: only ${free_mb} MB of memory is free or inactive (need ${need_mb}); close other apps or wait" >&2
  exit 3
fi
# a running NoteAlong job is a python process (anchored, so this script's own command line does not match)
# (a build with --check only parses the song files and is not heavy)
if pgrep -fl "^[^ ]*python[^ ]* .*(notealong.catalog.(build|evaluate|recheck|import_cc)|import_ia_jamendo|bench_separation|check_pitch_shift|render_one|accuracy/(prepare_covers|process_test_song|render_hear|evaluate|answer_key))" | grep -v -e "--check" -e "--index" >/dev/null; then
  echo "heavy.sh: another heavy NoteAlong job is already running; wait for it" >&2
  exit 4
fi
# the online version's local test worker (notealong.cloud.dispatch) holds this lock while it runs a heavy job
lock="$(cd "$(dirname "$0")/../.." && pwd)/logs/heavy-job.lock"
if [ -f "$lock" ] && kill -0 "$(cat "$lock" 2>/dev/null)" 2>/dev/null; then
  echo "heavy.sh: the local test worker is running a heavy job; wait for it" >&2
  exit 4
fi
export OMP_NUM_THREADS=${OMP_NUM_THREADS:-6} MKL_NUM_THREADS=${MKL_NUM_THREADS:-6} OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-6} TOKENIZERS_PARALLELISM=false
exec "$@"
