# Run log: the no-overwrite / redo-as-new-run model for a test folder.
#
# Data is NEVER overwritten. Redoing a run creates the next run number and marks
# the old run as superseded; analysis then uses only the "active" runs (the
# latest run in each supersession chain). Every redo records a required reason,
# which surfaces as a column in the report output.
#
# Stored in <test_folder>/run_log.json:
#   {
#     "runs": [1, 2, 3, 4],            # every physical run captured
#     "redos": [                       # one entry per redo
#       {"superseded": 2, "new": 4, "reason": "...", "timestamp": "..."}
#     ]
#   }
#
# Example: runs 1,2,3 exist; redo run 2 -> new run 4 (runs become 1,2,3,4,
# superseded={2}, active=1,3,4). Later redo run 4 -> new run 5 (active=1,3,5).
import json
from datetime import datetime
from pathlib import Path

LOG_NAME = "run_log.json"


def _log_path(test_folder):
    return Path(test_folder) / LOG_NAME


def load(test_folder):
    path = _log_path(test_folder)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            data.setdefault("runs", [])
            data.setdefault("redos", [])
            return data
        except (OSError, ValueError):
            pass
    return {"runs": [], "redos": []}


def save(test_folder, log):
    try:
        _log_path(test_folder).write_text(json.dumps(log, indent=2), encoding="utf-8")
    except OSError:
        pass


def superseded_runs(log):
    """Run numbers that have been redone (replaced by a newer run)."""
    return {entry["superseded"] for entry in log.get("redos", []) if "superseded" in entry}


def active_runs(log):
    """Active runs = every captured run minus the ones that were redone."""
    superseded = superseded_runs(log)
    return sorted(r for r in log.get("runs", []) if r not in superseded)


def next_run_number(log):
    runs = log.get("runs", [])
    return (max(runs) + 1) if runs else 1


def record_run(test_folder, run_number, redo_of=None, reason=None):
    """Record a freshly captured run; if it redoes an older run, log the reason."""
    log = load(test_folder)
    if run_number not in log["runs"]:
        log["runs"].append(run_number)
        log["runs"].sort()
    if redo_of:
        log["redos"].append({
            "superseded": int(redo_of),
            "new": int(run_number),
            "reason": (reason or "").strip(),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
    save(test_folder, log)
    return log


def reason_rows(log):
    """Flat list of redo reasons for the report output (one row per redo)."""
    rows = []
    for entry in log.get("redos", []):
        rows.append({
            "superseded_run": entry.get("superseded"),
            "new_run": entry.get("new"),
            "reason": entry.get("reason", ""),
            "timestamp": entry.get("timestamp", ""),
        })
    return rows


def reason_summary(log):
    """One-line summary of all redo reasons, for a report cell."""
    parts = [
        f"run {e.get('superseded')}→{e.get('new')}: {e.get('reason') or '(no reason)'}"
        for e in log.get("redos", [])
    ]
    return " | ".join(parts)
