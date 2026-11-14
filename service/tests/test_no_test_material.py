"""Internal test recordings, covers, lyrics and answer keys never ship (docs/MELODY_LAB.md)."""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_no_test_material.py"


def test_no_test_material_would_ship():
    r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
