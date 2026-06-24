# http request handler: serves the page and handles the json api routes,
# including folder/versioning logic, preview test runs, and analysis dispatch.
import csv
import json
import math
import re
import shutil
import subprocess
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

import config
from config import ROOT
from hardware import STATE, list_ports, load_cell_force
from analysis import SavedTestAnalyzer


class Handler(SimpleHTTPRequestHandler):
    # serve the page and handle the button api calls.
    # the frontend sends json here using fetch(), and every response is json too.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        return

    def end_headers(self):
        # never let the browser cache the page/assets, so run_web_gui always
        # serves the latest edited web_preview files (no stale index/css/js).
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        # /plot-file?path=<abs path> serves a generated analysis image (png/svg)
        # from anywhere on disk so the browser can show the real matplotlib plots.
        # Every other GET falls through to normal static file serving from ROOT.
        parsed = urlparse(self.path)
        if parsed.path == "/plot-file":
            return self.serve_plot_file(parse_qs(parsed.query))
        return super().do_GET()

    def serve_plot_file(self, query):
        raw = (query.get("path") or [""])[0]
        file_path = Path(unquote(raw)).expanduser()
        content_types = {".png": "image/png", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8"}
        if file_path.suffix.lower() not in content_types or not file_path.is_file():
            self.send_error(404, "Plot not found")
            return
        data = file_path.read_bytes()
        content_type = content_types[file_path.suffix.lower()]
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        # allow the file:// preview page to call this local backend.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        # every browser action posts json here.
        # this method parses the payload, routes it, catches errors, and sends a clean response.
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {}

        try:
            result = self.route_api(path, payload)
            if isinstance(result, dict):
                response_payload = result
            else:
                ok, message = result
                response_payload = {"ok": ok, "message": message}
        except Exception as exc:
            response_payload = {"ok": False, "message": f"{type(exc).__name__}: {exc}"}

        data = json.dumps(response_payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def route_api(self, path, payload):
        # match each browser route to a python action.
        # this is basically the api table for the whole local app.
        comport = payload.get("comport") or "COM3"

        if path == "/api/verify":
            save_folder = Path(payload.get("save_folder") or "").expanduser()
            return True, f"Settings verified. Save folder ready: {save_folder}"

        if path == "/api/check-existing":
            return self.check_existing(payload)

        if path == "/api/browse-folder":
            return self.browse_folder()

        if path == "/api/list-ports":
            ports = list_ports()
            return {
                "ok": True,
                "ports": ports,
                "message": (
                    f"Detected {len(ports)} serial port(s)." if ports else "No serial ports detected."
                ),
            }

        if path == "/api/connect":
            return STATE.connect_zaber(comport)

        if path == "/api/connection-check":
            # Start Test gate: report whether a real Zaber is live, and whether
            # this is a simulation-only machine (no real load-cell driver), so the
            # UI can hard-block on a real rig but stay soft in simulation.
            import os
            import futek_cli
            from run_engine import FUTEK_INIT_FAIL_MSG
            connected = (STATE.cli is not None) and (not STATE.simulated)
            futek_ok = (not bool(os.environ.get("FORCE_SIM"))) and getattr(futek_cli, "_REAL_FUTEK_AVAILABLE", False)
            simulation = not futek_ok
            # Surface the exact operator-facing reasons the start-gate can block on, so
            # the UI can show the missing-hardware guidance. Messages only; the boolean
            # flags above still drive the gate.
            port = STATE.comport or "COM3"
            messages = {}
            if not futek_ok:
                messages["futek"] = FUTEK_INIT_FAIL_MSG
            if not connected:
                messages["zaber"] = (f"Could not connect to Zaber actuator on {port}. "
                                     "Check the connection and try again")
            return {"ok": True, "connected": connected, "simulation": simulation,
                    "connection_lost": bool(STATE.connection_lost), "comport": STATE.comport,
                    "messages": messages}

        if path == "/api/zaber-reconnect":
            # live reconnect watcher: try to reopen the last known port after a
            # disconnect. On success the actuator is re-homed (its position was
            # unknown after the comms loss) so the next run starts from baseline.
            result = STATE.try_reconnect()
            if result.get("connected"):
                home = STATE.home(STATE.comport)
                result["rehomed"] = bool(home.get("ok"))
                result["position"] = home.get("position")
            return result

        if path == "/api/move":
            # smooth, force-monitored jog: one continuous velocity move that halts if
            # the load cell crosses the ceiling, so a manual press can't crush the
            # sensor. Optional speed (mm/s); defaults to a gentle jog speed.
            from run_engine import ENGINE
            return ENGINE.manual_move(float(payload.get("distance", 0)), payload.get("speed"))

        if path == "/api/read-force":
            # current load-cell reading for the manual window's continuous live graph
            # (no motion). Used while the actuator is idle so time keeps advancing.
            from run_engine import ENGINE
            return ENGINE.read_force_now()

        if path == "/api/move-to-force":
            # force-feedback jog: drive the actuator at the actuator speed until the load
            # cell reads the target force (compression), or release back toward 0 N / home.
            from run_engine import ENGINE
            return ENGINE.manual_force_move(
                float(payload.get("target_force", 0)),
                payload.get("direction", "down"),
                payload.get("speed"))

        if path == "/api/home":
            return STATE.home(comport)

        if path == "/api/set-baseline":
            # define the actuator's current physical position as a known value (the
            # 17 mm baseline) to establish the reference without homing into the cell.
            return STATE.set_baseline_position(payload.get("mm"))

        if path == "/api/pause":
            return STATE.pause(comport)

        if path in {"/api/stop", "/api/emergency-stop"}:
            return STATE.stop()

        if path == "/api/start-test":
            return self.start_test(payload)

        if path == "/api/perform-analysis":
            return self.perform_analysis(payload)

        if path == "/api/analysis-progress":
            # live phase progress for the loading bar (polled while analysis runs).
            from analysis import get_analysis_progress
            return {"ok": True, **get_analysis_progress()}


        if path == "/api/start-run":
            # run one real EM press (real FUTEK + Zaber, or the coupled simulator
            # on a machine without the rig). Data is never overwritten: a redo
            # always creates the next run number and records its reason. Writes
            # FUT/Run N.xlsx; the UI polls /api/run-status for live force/position.
            import run_log
            from run_engine import ENGINE
            test_folder = self.test_folder_for_payload(payload)
            ok_folder, folder_err = self._ensure_folder(test_folder)
            if not ok_folder:
                return {"ok": False, "message": folder_err}
            self._write_test_meta(test_folder, payload)
            surface_area = self._float_from_text(payload.get("surface_area"), default=325.0)
            log = run_log.load(test_folder)
            redo_of = payload.get("redo_of")
            reason = (payload.get("reason") or "").strip()
            if redo_of:
                if not reason:
                    return {"ok": False, "message": "A reason is required to redo a run."}
                run_number = run_log.next_run_number(log)
            else:
                run_number = int(payload.get("run_number") or run_log.next_run_number(log))
            ok, message = ENGINE.start(run_number, test_folder, surface_area, redo_of=redo_of, reason=reason)
            return {"ok": ok, "message": message, "run_number": run_number, "test_folder": str(test_folder)}

        if path == "/api/start-cyclical":
            # run the fatigue (cyclical) test on the real Zaber+FUTEK (or the
            # coupled simulator on a machine without the rig). The UI polls
            # /api/run-status for live force/cycle/position.
            from run_engine import ENGINE
            test_folder = self.test_folder_for_payload(payload)
            ok_folder, folder_err = self._ensure_folder(test_folder)
            if not ok_folder:
                return {"ok": False, "message": folder_err}
            self._write_test_meta(test_folder, payload)
            surface_area = self._float_from_text(payload.get("surface_area"), default=325.0)
            params = {
                "lower_force": self._float_from_text(payload.get("cyclical_lower_force"), default=1.0),
                "upper_force": self._float_from_text(payload.get("cyclical_upper_force"), default=20.0),
                "cycle_count": int(self._float_from_text(payload.get("cyclical_cycle_count"), default=1.0) or 1),
                "frequency": self._float_from_text(payload.get("waveform_frequency"), default=1.0),
                "waveform": payload.get("waveform_type") or "Sine",
            }
            ok, message = ENGINE.start_cyclical(params, test_folder, surface_area)
            return {"ok": ok, "message": message, "test_folder": str(test_folder)}

        if path == "/api/run-status":
            from run_engine import ENGINE
            return {"ok": True, **ENGINE.status()}

        if path == "/api/run-log":
            # report which runs exist and which are active (latest in each chain).
            import run_log
            test_folder = self.test_folder_for_payload(payload)
            log = run_log.load(test_folder)
            return {
                "ok": True,
                "runs": log.get("runs", []),
                "active_runs": run_log.active_runs(log),
                "redos": run_log.reason_rows(log),
            }

        if path == "/api/save-plot-png":
            # save an interactive-plot PNG sent from the embedded Plotly view. We
            # save server-side (instead of a browser download) so the embedded view
            # never navigates away from the interactive plot.
            import base64
            data_url = payload.get("data") or ""
            html_path = (payload.get("html_path") or "").strip()
            name = re.sub(r"[^A-Za-z0-9_.-]+", "_", (payload.get("name") or "plot")) or "plot"
            b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
            try:
                raw = base64.b64decode(b64)
            except Exception:
                return {"ok": False, "message": "Could not decode the image."}
            # save next to the Analysis_Plots.html (the test folder); fall back to ~/Downloads.
            folder = Path(html_path).expanduser().parent if html_path else (Path.home() / "Downloads")
            try:
                folder.mkdir(parents=True, exist_ok=True)
                out = folder / f"{name}_plot.png"
                counter = 1
                while out.exists():
                    out = folder / f"{name}_plot_{counter}.png"
                    counter += 1
                out.write_bytes(raw)
                return {"ok": True, "filename": out.name, "path": str(out)}
            except OSError as exc:
                return {"ok": False, "message": f"Could not save the PNG: {exc}"}

        if path == "/api/fuji-film":
            # calibration press: drive the actuator to the 20 N target while
            # streaming live force. The UI polls /api/run-status.
            from run_engine import ENGINE
            surface_area = self._float_from_text(payload.get("surface_area"), default=325.0)
            extrusion = self._float_from_text(payload.get("extrusion_distance"), default=None)
            ok, message = ENGINE.start_fuji_film(surface_area, extrusion)
            return {"ok": ok, "message": message}

        if path == "/api/shear-start":
            # live shear-force capture: read the load cell continuously (no actuator
            # motion - the operator applies shear by hand). The UI polls /api/run-status.
            from run_engine import ENGINE
            ok, message = ENGINE.start_shear()
            return {"ok": ok, "message": message}

        return False, f"Unknown API route: {path}"

    def _ensure_folder(self, folder):
        # create the save/test folder, failing gracefully (e.g. the default/root
        # save folder does not exist or is not writable) instead of crashing.
        try:
            folder.mkdir(parents=True, exist_ok=True)
            return True, None
        except OSError as exc:
            reason = getattr(exc, "strerror", None) or str(exc)
            return False, (f"Could not create the save folder: {folder}. "
                           f"Check that the location exists and is writable ({reason}).")

    def _write_test_meta(self, test_folder, payload):
        # record the test configuration (esp. sensor type) so Analyze Saved Data
        # re-analyzes with the same channel order, not the current UI selection.
        try:
            meta = {
                "sensor_id": payload.get("sensor_id") or "",
                "sensor_type": payload.get("sensor_type") or "Standard",
                "test_type": payload.get("test_type") or "EM",
                "surface_area": payload.get("surface_area") or "",
            }
            (Path(test_folder) / "test_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        except OSError:
            pass

    def test_folder_for_payload(self, payload):
        # a normal save folder is the base drive folder; tests live under sensor/date folders.
        # example: google drive / sensor id / 05 26 26_325mm2_em.
        selected = (payload.get("selected_test_folder") or "").strip()
        if selected:
            return Path(selected).expanduser()

        save_folder = self.clean_base_save_folder(Path(payload.get("save_folder") or "").expanduser())
        base_save_folder = self.clean_base_save_folder(Path(payload.get("base_save_folder") or save_folder).expanduser())
        sensor_id = (payload.get("sensor_id") or "").strip()
        if not sensor_id:
            return save_folder
        return base_save_folder / sensor_id / self.test_folder_name(payload)

    def clean_base_save_folder(self, folder):
        # old preview states sometimes stored a resolved sensor/test folder as the visible base.
        folder = Path(folder).expanduser()
        parts = folder.parts
        for index, part in enumerate(parts):
            if re.fullmatch(r"\d{2} \d{2} \d{2}_.+_(EM|EB|Shear|Manual|Fatigue)(?:_\d+)?", part, flags=re.IGNORECASE):
                return Path(*parts[:max(1, index - 1)])
            if re.fullmatch(r"\d{6}B\d{2}S\d{2}(A|B|AB|BA)(?:_\d+)?", part, flags=re.IGNORECASE):
                return Path(*parts[:index])
        return folder

    def test_folder_name(self, payload):
        date_text = datetime.now().strftime("%m %d %y")
        surface_area = self.safe_folder_part(payload.get("surface_area") or "325mm2")
        test_type = self.test_type_code(payload.get("test_type") or "EM")
        return f"{date_text}_{surface_area}_{test_type}"

    def test_type_code(self, test_type):
        lookup = {
            "EM": "EM",
            "Shear": "Shear",
            "Manual": "Manual",
            "Fatigue": "Fatigue",
        }
        return lookup.get(str(test_type), self.safe_folder_part(test_type))

    def safe_folder_part(self, value):
        text = str(value).strip().replace("^", "")
        text = re.sub(r"\s+", "", text)
        text = re.sub(r"[^A-Za-z0-9_.-]", "", text)
        return text or "Test"

    def version_family(self, folder):
        # Treat test, test_2, test_3, etc. as versions of the same test setup.
        base_name = re.sub(r"_\d+$", "", folder.name)
        base_folder = folder.with_name(base_name)
        return base_folder, base_name

    def existing_versioned_folders(self, folder):
        base_folder, base_name = self.version_family(folder)
        versions = []
        if not base_folder.parent.exists():
            return versions

        for sibling in base_folder.parent.iterdir():
            if sibling.name == base_name:
                versions.append((1, sibling))
                continue
            match = re.fullmatch(rf"{re.escape(base_name)}_(\d+)", sibling.name)
            if match:
                versions.append((int(match.group(1)), sibling))
        return sorted(versions, key=lambda item: item[0])

    def latest_existing_folder(self, folder):
        versions = self.existing_versioned_folders(folder)
        return versions[-1][1] if versions else None

    def matching_test_configuration_folders(self, requested_folder):
        # find older tests with the same sensor, surface area, and test type.
        # the date can be different because users may retest the same sensor later.
        # If today's folder does not exist yet, still catch previous folders for the
        # same sensor, surface area, and test type. The date prefix can differ.
        match = re.fullmatch(
            r"\d{2} \d{2} \d{2}_(?P<surface>.+)_(?P<test>EM|EB|Shear|Manual|Fatigue)(?:_(?P<version>\d+))?",
            requested_folder.name,
            flags=re.IGNORECASE,
        )
        if not match or not requested_folder.parent.exists():
            return []

        surface = re.escape(match.group("surface"))
        test_type = re.escape(match.group("test"))
        pattern = re.compile(
            rf"(?P<month>\d{{2}}) (?P<day>\d{{2}}) (?P<year>\d{{2}})_{surface}_{test_type}(?:_(?P<version>\d+))?$",
            flags=re.IGNORECASE,
        )
        matches = []
        for sibling in requested_folder.parent.iterdir():
            sibling_match = pattern.fullmatch(sibling.name)
            if not sibling_match:
                continue
            version = int(sibling_match.group("version") or 1)
            date_key = (
                int(sibling_match.group("year")),
                int(sibling_match.group("month")),
                int(sibling_match.group("day")),
            )
            matches.append((date_key, version, sibling))
        return sorted(matches, key=lambda item: (item[0], item[1]))

    def latest_matching_test_configuration_folder(self, requested_folder):
        matches = self.matching_test_configuration_folders(requested_folder)
        return matches[-1][2] if matches else None

    def next_version_for_conflict(self, conflict_folder):
        return self.next_versioned_folder(conflict_folder)

    def next_versioned_folder(self, folder):
        # Create the next sibling version without nesting suffixes like test_1_1.
        base_folder, base_name = self.version_family(folder)
        versions = self.existing_versioned_folders(base_folder)
        highest_version = versions[-1][0] if versions else 0
        return base_folder.with_name(f"{base_name}_{highest_version + 1}")

    def check_existing(self, payload):
        # called before starting a test.
        # it tells the browser whether to show the existing-test popup and what the newest version is.
        requested_folder = self.test_folder_for_payload(payload)
        latest_folder = self.latest_existing_folder(requested_folder)
        if latest_folder is None:
            latest_folder = self.latest_matching_test_configuration_folder(requested_folder)
        conflict_folder = latest_folder or requested_folder
        versioned_folder = self.next_versioned_folder(conflict_folder if latest_folder else requested_folder)
        exists = latest_folder is not None
        available_runs = self.available_run_numbers(conflict_folder)
        is_em_test = self.test_type_code(payload.get("test_type") or "EM") == "EM"
        return {
            "ok": True,
            "exists": exists,
            "folder": str(conflict_folder),
            "requested_folder": str(requested_folder),
            "versioned_folder": str(versioned_folder),
            "available_runs": available_runs,
            "is_em_test": is_em_test,
            "message": (
                f"A test folder exists for this Sensor ID and test configuration: {conflict_folder}. Choose how you want to continue."
                if exists
                else f"No existing test folder found. New folder will be created when Begin Test is pressed: {requested_folder}"
            ),
        }

    def available_run_numbers(self, folder):
        # runs the user may redo: ACTIVE (non-superseded) runs only. Uses fut+cap
        # filenames, then intersects with the run log's active runs so a run that
        # was already superseded by a redo cannot be redone again.
        run_numbers = set()
        for path in list((folder / "FUT").glob("*.xlsx")) + list((folder / "FUT").glob("*.csv")) + list((folder / "CAP").glob("*.csv")):
            match = re.search(r"run\D*(\d+)", path.name, flags=re.IGNORECASE)
            if match:
                run_numbers.add(int(match.group(1)))
        import run_log
        log = run_log.load(folder)
        if log.get("runs"):
            run_numbers &= set(run_log.active_runs(log))
        return sorted(run_numbers)

    def start_test(self, payload):
        # this only confirms the selected folder path for the ui.
        # preview run files are written later when perform analysis is clicked.
        test_folder = self.test_folder_for_payload(payload)
        return {
            "ok": True,
            "test_folder": str(test_folder),
            "message": f"Test folder ready: {test_folder}",
        }

    def prepare_test_folder(self, payload, test_folder):
        # perform analysis is the point where folders and preview data files are actually written.
        # Data is never overwritten: a redo always adds a new run number instead.
        test_folder = Path(test_folder).expanduser()
        fut_folder = test_folder / "FUT"
        cap_folder = test_folder / "CAP"
        fut_folder.mkdir(parents=True, exist_ok=True)
        cap_folder.mkdir(parents=True, exist_ok=True)
        self._write_test_meta(test_folder, payload)

        test_type = self.test_type_code(payload.get("test_type") or "EM")
        if test_type == "Shear" and payload.get("shear_readings"):
            readings = self._clean_force_readings(payload.get("shear_readings"))
            self.write_reading_fut(fut_folder / "Run 1.csv", readings)
            self.write_reading_cap(cap_folder / "Run 1.csv", readings)
            return
        if test_type == "Manual" and payload.get("manual_readings"):
            manual_points = self._clean_manual_readings(payload.get("manual_readings"))
            readings = [{"time": point["time"], "force": point["force"]} for point in manual_points]
            self.write_reading_fut(fut_folder / "Run 1.csv", readings)
            self.write_reading_cap(cap_folder / "Run 1.csv", readings)
            return

        # Only fabricate synthetic preview run files when the folder has NO real
        # run data yet (the empty-folder, no-hardware demo). If real FUT files
        # already exist - e.g. the run engine captured them, even in simulation
        # where there's FUT but no CAP - never fabricate. Fabricating a lone
        # synthetic CAP/Run 1 here made the real engine run on only run 1 and hid
        # every other (active) run, including a redo's new run.
        existing_fut = list(fut_folder.glob("*.csv")) + list(fut_folder.glob("*.xlsx"))
        if existing_fut:
            return

        redo_run = bool(payload.get("redo_run"))
        run_numbers = [int(payload.get("run_to_redo") or 1)] if redo_run else list(range(1, int(payload.get("runs") or 1) + 1))
        for run_number in run_numbers:
            self.write_preview_fut(fut_folder / f"Run {run_number}.csv", run_number)
            self.write_preview_cap(cap_folder / f"Run {run_number}.csv", run_number)

    # Preview run files are shaped like a real EM capture so the same matplotlib
    # analysis pipeline (em_analysis) can run on them and produce the real plots,
    # instead of falling back to the lightweight SVG preview. A single press is
    # modelled as a triangular pressure ramp up past test pressure and back down,
    # sampled at 200 Hz; CAP follows a per-channel sigmoid (logistic) response.
    PREVIEW_SAMPLES = 6000      # 30 s at 200 Hz
    PREVIEW_DT = 0.005          # 200 Hz
    PREVIEW_PEAK_KPA = 75.0     # peak pressure (kPa), well past the 45 kPa window
    PREVIEW_AREA_M2 = 325e-6    # 325 mm^2, matches the analysis surface area

    def _preview_pressure(self, index, run_number):
        # triangular rise-and-fall pressure (kPa) with a small per-run variation.
        peak = self.PREVIEW_SAMPLES // 2
        fraction = index / peak if index <= peak else (self.PREVIEW_SAMPLES - index) / peak
        amplitude = self.PREVIEW_PEAK_KPA * (1.0 + 0.012 * (run_number - 1))
        return max(0.0, amplitude * fraction)

    def write_preview_fut(self, path, run_number):
        # force file: load cell (N) derived from the modelled pressure profile.
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Index", "Load Cell", "Time"])
            for index in range(self.PREVIEW_SAMPLES):
                time_value = index * self.PREVIEW_DT
                pressure_kpa = self._preview_pressure(index, run_number)
                force_n = pressure_kpa * self.PREVIEW_AREA_M2 * 1000.0
                force_n += 0.01 * math.sin(time_value * 6.0)  # tiny load-cell jitter
                writer.writerow([index + 1, round(force_n, 5), round(time_value, 5)])

    def write_preview_cap(self, path, run_number):
        # capacitance file: eight channels, each a sigmoid response vs pressure.
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Time", "Unused1", "Unused2", "Unused3", "Unused4", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8"])
            for index in range(self.PREVIEW_SAMPLES):
                time_value = index * self.PREVIEW_DT
                pressure_kpa = self._preview_pressure(index, run_number)
                channels = []
                for channel in range(8):
                    baseline = 18.0 + channel * 0.4
                    span = 2.6 + 0.18 * channel
                    response = span / (1.0 + math.exp(-(pressure_kpa - 25.0) / 6.0))
                    jitter = 0.012 * math.sin(time_value * 7.0 + channel)
                    channels.append(round(baseline + response + jitter, 5))
                writer.writerow([round(time_value, 5), "", "", "", "", *channels])

    def _safe_float(self, value):
        try:
            if value is None or value == "":
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _float_from_text(self, value, default):
        match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
        return float(match.group(0)) if match else default

    def _format_value(self, value, unit):
        if unit == "%":
            return f"{value:.2f}%"
        return f"{value:.3f}{unit}"

    def _clean_force_readings(self, readings):
        # clean shear data coming from the browser before writing it to csv.
        points = []
        for index, item in enumerate(readings or []):
            if not isinstance(item, dict):
                continue
            time_value = self._safe_float(item.get("time"))
            force = load_cell_force(self._safe_float(item.get("force")))
            if force is None:
                continue
            points.append({"time": time_value if time_value is not None else index * 0.01, "force": force})
        return points or [{"time": index * 0.01, "force": 0.2 + index * 0.003} for index in range(501)]

    def _clean_manual_readings(self, readings):
        # clean manual test points so analysis always has time, force, and capacitance.
        points = []
        for index, item in enumerate(readings or []):
            if not isinstance(item, dict):
                continue
            time_value = self._safe_float(item.get("time"))
            force = load_cell_force(self._safe_float(item.get("force")))
            capacitance = self._safe_float(item.get("capacitance"))
            points.append({
                "time": time_value if time_value is not None else index * 0.1,
                "force": force if force is not None else 0.0,
                "capacitance": capacitance if capacitance is not None else 12.0,
            })
        return points or [{"time": index * 0.1, "force": index * 0.2, "capacitance": 12 + index * 0.08} for index in range(25)]

    def write_reading_fut(self, path, readings):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Index", "Load Cell", "Time"])
            for index, point in enumerate(readings, start=1):
                writer.writerow([index, round(point["force"], 5), round(point["time"], 5)])

    def write_reading_cap(self, path, readings):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Time", "Unused1", "Unused2", "Unused3", "Unused4", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8"])
            for point in readings:
                force = point["force"]
                channels = [round(18 + force * (0.65 + channel * 0.045) + math.sin(point["time"] + channel) * 0.02, 5) for channel in range(1, 9)]
                writer.writerow([round(point["time"], 5), "", "", "", "", *channels])

    def perform_analysis(self, payload):
        # shared analysis endpoint for em, shear, and manual tests.
        test_folder = self.test_folder_for_payload(payload)

        if payload.get("analyze_existing"):
            # "Analyze Saved Data": use the chosen folder as-is. Validate that it
            # actually holds run data and never fabricate synthetic files - if the
            # folder is wrong, return a clear error so the UI can stop.
            if str(payload.get("test_type") or "EM") == "Fatigue":
                # fatigue has no FUT/CAP runs - it stores a single Force-vs-Time
                # stream (Fatigue_Data.xlsx or .csv) plus a small stats summary.
                fatigue_files = list((test_folder).glob("Fatigue_Data.xlsx")) + list((test_folder).glob("Fatigue_Data.csv"))
                if not fatigue_files:
                    return {
                        "ok": False,
                        "message": (
                            f"Couldn't read fatigue data from {test_folder}. Pick the "
                            "test folder itself - the one that contains Fatigue_Data.xlsx "
                            "(or Fatigue_Data.csv)."
                        ),
                    }
            else:
                fut_files = list((test_folder / "FUT").glob("*.xlsx")) + list((test_folder / "FUT").glob("*.csv"))
                cap_files = list((test_folder / "CAP").glob("*.csv"))
                if not fut_files or not cap_files:
                    return {
                        "ok": False,
                        "message": (
                            f"Couldn't read test data from {test_folder}. Pick the test "
                            "folder itself - the one that contains FUT/ (force run files) "
                            "and CAP/ (capacitance run files) subfolders."
                        ),
                    }
        else:
            self.prepare_test_folder(payload, test_folder)

        from analysis import reset_analysis_progress, set_analysis_progress
        reset_analysis_progress()
        analyzer = SavedTestAnalyzer(payload, test_folder)
        try:
            return analyzer.run()
        finally:
            set_analysis_progress(100, "Analysis complete.")

    def browse_folder(self):
        # open a native folder picker. In the packaged desktop app this uses the
        # pywebview dialog (works on Windows and Mac); the browser-only launcher
        # falls back to macOS osascript.
        if config.DESKTOP_WINDOW is not None:
            return self.browse_folder_pywebview()
        return self.browse_folder_osascript()

    def browse_folder_pywebview(self):
        import webview

        try:
            # newer pywebview uses FileDialog.FOLDER; older uses the FOLDER_DIALOG
            # constant (now deprecated). Prefer the new enum, fall back to the old.
            folder_dialog = getattr(getattr(webview, "FileDialog", None), "FOLDER", None)
            if folder_dialog is None:
                folder_dialog = webview.FOLDER_DIALOG
            result = config.DESKTOP_WINDOW.create_file_dialog(folder_dialog)
        except Exception as exc:
            return False, f"Could not open folder picker: {exc}"

        if not result:
            return False, "Folder selection cancelled."
        selected = result[0] if isinstance(result, (list, tuple)) else result
        return True, str(selected)

    def browse_folder_osascript(self):
        # macOS-only fallback used when running through the plain browser launcher.
        if sys.platform != "darwin":
            return False, "Folder picker is only available in the desktop app on this platform."
        script = 'POSIX path of (choose folder with prompt "Select a save folder")'
        try:
            completed = subprocess.run(
                ["osascript", "-e", script],
                check=False,
                capture_output=True,
                text=True,
            )
        except Exception as exc:
            return False, f"Could not open folder picker: {exc}"

        if completed.returncode != 0:
            return False, "Folder selection cancelled."
        return True, completed.stdout.strip()
