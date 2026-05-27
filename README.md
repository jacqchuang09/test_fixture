# Zaber Browser GUI

This folder is the current working version of the Zaber/FUTEK testing interface. The main app is a browser page, but it is still connected to Python through a small local backend.

## What to open

Open this folder in VS Code:

```bash
/Users/jacqueline/Downloads/ZaberTkinterGUI
```

The active files are:

- `web_preview/index.html` - the visual interface
- `web_preview/run_web_gui.py` - the local Python backend for the browser buttons
- `zaber_cli.py` - the Zaber hardware wrapper
- `futek_cli.py` - the FUTEK load-cell wrapper
- `requirements.txt` - Python packages to install

Old Tkinter versions are kept in `archive/legacy_tkinter/` for reference. The copied original project is kept in `archive/reference_original_project/`.

## How to run

Use `python3` on this Mac, not `python`.

From VS Code terminal:

```bash
cd "/Users/jacqueline/Downloads/ZaberTkinterGUI"
python3 -u web_preview/run_web_gui.py
```

The app will print a local link like:

```text
http://127.0.0.1:8765/index.html
```

Open that link in Chrome. Do not use the `file://...` version for real hardware, because `file://` cannot talk to the Python backend.

## VS Code buttons

The VS Code launch/task files now point to `web_preview/run_web_gui.py`.

You can run it from:

- Run and Debug: `Run Zaber Browser GUI`
- Terminal tasks: `Run Zaber Browser GUI`

## Installing Python packages

From the project folder:

```bash
python3 -m pip install -r requirements.txt
```

The Zaber package is installed from pip as `zaber-motion`.

## Hardware notes

### Zaber

The browser backend calls `zaber_cli.py` when you start a test or use calibration movement.

The current baseline/original position is `17 mm`.

### FUTEK

`futek_cli.py` uses the FUTEK `.dll` files through `pythonnet`. Those DLL files are included in this folder.

On macOS, Python also needs a compatible .NET runtime such as Mono. If you see this error:

```text
Failed to create a default .NET runtime
```

then the browser reached Python, but the FUTEK runtime is not ready yet. Install/configure Mono or the .NET runtime required by FUTEK before running a real load-cell test.

## Current workflow

1. Fill in Basic Settings.
2. Click Verify.
3. Test Configuration appears.
4. Click Begin Test.
5. The Zaber Control Stage popup opens.
6. Click Start to check the backend and begin the hardware path.
7. Use Pause or Stop if needed.

## User Stories Added

### Sensor ID Builder

User Story: As a test fixture user, I want the GUI to automatically generate the Sensor ID from fabrication fields so that I do not have to manually type or remember the full Sensor ID format.

Acceptance Criteria:

- The Sensor ID field is generated from one connected segmented row: `YY` `MM` `DD` `B ##` `S ##` `X`.
- Year, Month, and Day are auto-filled using the current date.
- Batch Number visually includes the fixed `B` prefix, and the user types only the two numeric digits.
- Sensor Number visually includes the fixed `S` prefix, and the user types only the two numeric digits.
- Fabrication Location is a one-character text input and must be `A` or `B`.
- The generated Sensor ID follows the format `YYMMDDB##S##X`, where `X` is fabrication location.
- The generated Sensor ID preview updates automatically when any field changes.
- Verify is blocked with a clear message if any segment is invalid.
- The user can still manually override the Sensor ID if needed.
- A `Use Custom Sensor ID` checkbox is unchecked by default.
- When `Use Custom Sensor ID` is checked, the standard builder fields are disabled and a free-text custom Sensor ID field is enabled.
- Custom Sensor ID values are used during testing, saving, and analysis workflows.

## Project cleanup

The working app is intentionally small now. Files that are not part of the current browser workflow were moved into `archive/` instead of deleted, so they are still available if we need to copy logic back later.
