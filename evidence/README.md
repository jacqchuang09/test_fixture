# Verification evidence

Artifacts from the user-story verification pass (capturing UI screenshots as
evidence that each requirement is met, and linking them into the user-stories
tracker). None of this is used by the GUI app at runtime - it is documentation
of the verification work.

## Folders

- **`capture_scripts/`** - one-off Selenium scripts (`capture_1_*.py`), one per
  feature, that screenshot the GUI's UI states. They drive the local preview
  (`http://127.0.0.1:8765/index.html`) and never operate hardware. Re-run a
  script to regenerate that feature's screenshots.
- **`screenshots/`** - the captured PNGs, grouped per feature
  (`qa_evidence_1_2/`, ... ), named by Conditions-of-Satisfaction code
  (e.g. `1.2.1 #1 test configuration window.png`).
- **`apps_script/`** - Google Apps Script (`fillEvidence*.gs`, `revise*.gs`) that
  runs inside Google Sheets to fill the "Evidence" column of the verification
  table with links to the screenshots in Drive. These do not run locally.

## Notes

- The screenshots also live in Drive (that is what the Apps Script links to);
  the copies here are a local backup.
- The capture scripts write their output next to where they are run, so if you
  re-run one, point its output at `evidence/screenshots/` or move the result in.
