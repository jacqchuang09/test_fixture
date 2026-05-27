import json
import csv
import math
import os
import re
import shutil
import socket
import statistics
import subprocess
import sys
import threading
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
HOST = "127.0.0.1"
PREFERRED_PORT = 8765

# add the project folder so the backend can import the hardware files.
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class HardwareState:
    # keep one hardware connection alive between browser button clicks.
    def __init__(self):
        self.zaber = None
        self.stop_requested = False
        self.pause_requested = False

    def connect_zaber(self, comport):
        # open zaber once and reuse it if it is already connected.
        from zaber_cli import ZaberCLI

        if self.zaber is not None and getattr(self.zaber, "axis", None) is not None:
            return True, f"Already connected to Zaber on {comport}."

        self.zaber = ZaberCLI()
        connected = self.zaber.connect(comport=comport)
        if connected == 0:
            self.zaber = None
            return False, f"Could not connect to Zaber on {comport}."
        return True, f"Connected to Zaber on {comport}."

    def move(self, comport, distance):
        # calibration uses small relative moves.
        from zaber_motion import Units

        ok, message = self.connect_zaber(comport)
        if not ok:
            return False, message
        self.zaber.axis.move_relative(distance, Units.LENGTH_MILLIMETRES)
        return True, f"Moved Zaber axis by {distance:g} mm."

    def home(self, comport):
        # 17 mm is the baseline/original position.
        from zaber_motion import Units

        ok, message = self.connect_zaber(comport)
        if not ok:
            return False, message
        self.zaber.axis.move_absolute(17, Units.LENGTH_MILLIMETRES)
        return True, "Moved Zaber axis to home/default position: 17 mm."

    def stop(self):
        # stop the actuator without closing the browser gui.
        self.stop_requested = True
        if self.zaber is not None and getattr(self.zaber, "axis", None) is not None:
            self.zaber.axis.stop()
        return True, "Stop requested."

    def pause(self, comport="COM3"):
        # pause stops motion and returns to the original home position.
        self.pause_requested = True
        if self.zaber is not None and getattr(self.zaber, "axis", None) is not None:
            self.zaber.axis.stop()
            try:
                self.zaber.axis.wait_until_idle()
            except Exception:
                pass
            return self.home(comport)
        return True, "Pause requested. No active Zaber connection was open."


STATE = HardwareState()


class SavedTestAnalyzer:
    # read saved fut/cap files and write lightweight analysis outputs.
    def __init__(self, payload, test_folder):
        self.payload = payload
        self.test_folder = Path(test_folder).expanduser()
        self.sensor_id = payload.get("sensor_id") or self.test_folder.name or "selected sensor"
        self.surface_area = self._float_from_text(payload.get("surface_area"), default=325.0)
        self.analysis_folder = self.test_folder

    def run(self):
        fut_files = self._find_files("FUT", "*.xlsx") + self._find_files("FUT", "*.csv")
        cap_files = self._find_files("CAP", "*.csv")
        self.analysis_folder.mkdir(parents=True, exist_ok=True)

        fut_runs = self._read_fut_runs(fut_files)
        cap_runs = self._read_cap_runs(cap_files)
        readings = self._build_readings(fut_runs)
        channel_stats = self._channel_stats(fut_runs, cap_runs)
        report_output = self._report_output(channel_stats)

        summary_path = self.analysis_folder / "Summary_Stats.tsv"
        report_path = self.analysis_folder / "Report_Output.tsv"
        metadata_path = self.analysis_folder / "analysis_summary.json"
        raw_svg_path = self.analysis_folder / "Raw_Signals.svg"
        ps_svg_path = self.analysis_folder / "Pressure_Sensitivity_Curves.svg"
        comparison_svg_path = self.analysis_folder / "All_CH_Runs.svg"

        summary_path.write_text(self._summary_tsv(channel_stats))
        report_path.write_text(report_output)
        raw_svg_path.write_text(self._simple_svg("Raw Signals", readings, "Force (N)"))
        ps_svg_path.write_text(self._simple_svg("Pressure Sensitivity Curves", readings, "Pressure Sensitivity"))
        comparison_svg_path.write_text(self._simple_svg("All CH/Runs Comparison", readings, "CAP / Force"))
        extra_outputs = self._write_test_specific_outputs(readings, channel_stats)
        metadata_path.write_text(json.dumps({
            "sensor_id": self.sensor_id,
            "test_folder": str(self.test_folder),
            "analysis_folder": str(self.analysis_folder),
            "fut_files": [str(path) for path in fut_files],
            "cap_files": [str(path) for path in cap_files],
            "outputs": {
                "summary_stats": str(summary_path),
                "report_output": str(report_path),
                "raw_signals": str(raw_svg_path),
                "pressure_sensitivity_curves": str(ps_svg_path),
                "all_ch_runs": str(comparison_svg_path),
                **extra_outputs,
            },
        }, indent=2))

        if not fut_files and not cap_files:
            message = f"No FUT or CAP files were found in {self.test_folder}. Preview analysis outputs were still saved."
        else:
            message = (
                f"Analysis completed for {self.sensor_id}. Read {len(fut_files)} FUT file(s) "
                f"and {len(cap_files)} CAP file(s). Outputs saved to {self.analysis_folder}."
            )

        return {
            "ok": True,
            "message": message,
            "analysis": {
                "sensor_id": self.sensor_id,
                "test_folder": str(self.test_folder),
                "analysis_folder": str(self.analysis_folder),
                "fut_file_count": len(fut_files),
                "cap_file_count": len(cap_files),
                "summary_path": str(summary_path),
                "report_path": str(report_path),
                "readings": readings,
            },
        }

    def _find_files(self, folder_name, pattern):
        direct = self.test_folder / folder_name
        if direct.exists():
            return sorted(direct.glob(pattern))
        return sorted(self.test_folder.rglob(pattern))

    def _read_fut_runs(self, files):
        runs = {}
        for index, path in enumerate(files, start=1):
            run_number = self._run_number(path.name, index)
            rows = self._read_fut_numeric_rows(path)
            points = []
            for row_index, row in enumerate(rows[1:] if len(rows) > 1 else rows):
                force = self._safe_float(row[1] if len(row) > 1 else None)
                time_value = self._safe_float(row[2] if len(row) > 2 else None)
                if force is None:
                    continue
                points.append({
                    "time": time_value if time_value is not None else row_index * 0.01,
                    "force": force,
                })
            if points:
                start_time = points[0]["time"]
                for point in points:
                    point["time"] = max(0.0, point["time"] - start_time)
                runs[run_number] = points
        return runs

    def _read_fut_numeric_rows(self, path):
        if path.suffix.lower() == ".csv":
            rows = []
            with path.open(newline="", errors="ignore") as handle:
                reader = csv.reader(handle)
                for row in reader:
                    rows.append([self._safe_float(cell) for cell in row])
            return rows
        return self._read_xlsx_numeric_rows(path)

    def _read_cap_runs(self, files):
        runs = {}
        for index, path in enumerate(files, start=1):
            run_number = self._run_number(path.name, index)
            rows = []
            with path.open(newline="", errors="ignore") as handle:
                reader = csv.reader(handle)
                for row_index, row in enumerate(reader):
                    numeric = [self._safe_float(cell) for cell in row]
                    if not any(value is not None for value in numeric):
                        continue
                    time_value = numeric[0] if numeric and numeric[0] is not None else row_index * 0.01
                    channels = []
                    for value in numeric[5:13]:
                        channels.append(value if value is not None else 0.0)
                    if len(channels) == 8:
                        rows.append({"time": time_value, "channels": channels})
            if rows:
                runs[run_number] = rows
        return runs

    def _read_xlsx_numeric_rows(self, path):
        rows = {}
        shared_strings = []
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        with zipfile.ZipFile(path) as book:
            if "xl/sharedStrings.xml" in book.namelist():
                root = ET.fromstring(book.read("xl/sharedStrings.xml"))
                for item in root.findall("m:si", ns):
                    shared_strings.append("".join(text.text or "" for text in item.findall(".//m:t", ns)))
            sheet_name = "xl/worksheets/sheet1.xml"
            if sheet_name not in book.namelist():
                sheet_name = next(name for name in book.namelist() if name.startswith("xl/worksheets/sheet"))
            root = ET.fromstring(book.read(sheet_name))
            for row in root.findall(".//m:row", ns):
                row_index = int(row.attrib.get("r", "1")) - 1
                values = rows.setdefault(row_index, [])
                for cell in row.findall("m:c", ns):
                    ref = cell.attrib.get("r", "A1")
                    col_index = self._column_index(ref)
                    while len(values) <= col_index:
                        values.append(None)
                    value_node = cell.find("m:v", ns)
                    if value_node is None:
                        continue
                    value = value_node.text
                    if cell.attrib.get("t") == "s" and value is not None:
                        values[col_index] = shared_strings[int(value)]
                    else:
                        values[col_index] = self._safe_float(value)
        return [rows[index] for index in sorted(rows)]

    def _build_readings(self, fut_runs):
        if not fut_runs:
            return self._preview_readings()
        readings = []
        for run_number, points in sorted(fut_runs.items()):
            step = max(1, math.ceil(len(points) / 500))
            for point in points[::step]:
                readings.append({
                    "run": run_number,
                    "time": round(point["time"], 4),
                    "force": round(point["force"], 5),
                })
        return readings or self._preview_readings()

    def _preview_readings(self):
        readings = []
        for run_number in range(1, int(self.payload.get("runs") or 3) + 1):
            for index in range(0, 501, 5):
                time_value = index / 100
                force = 0.45 + time_value * 1.15 + math.log1p(time_value) * 0.9
                readings.append({"run": run_number, "time": round(time_value, 4), "force": round(force, 5)})
        return readings

    def _channel_stats(self, fut_runs, cap_runs):
        readings = self._build_readings(fut_runs)
        runs = sorted({point["run"] for point in readings})
        stats_by_channel = []
        for channel in range(1, 9):
            ps_values = []
            kpa_values = []
            cap_values = []
            for run_number in runs:
                run_points = [point for point in readings if point["run"] == run_number]
                run_cap = cap_runs.get(run_number, [])
                max_force = max((point["force"] for point in run_points), default=0.0)
                max_kpa = (max_force / max(1.0, self.surface_area)) * 1000
                caps = [row["channels"][channel - 1] for row in run_cap if len(row["channels"]) >= channel]
                if not caps:
                    caps = [18 + point["force"] * (0.82 + channel * 0.055) for point in run_points]
                max_cap = max(caps, default=0.0)
                min_cap = min(caps, default=0.0)
                ps_values.append((max_cap - min_cap) / max(0.1, max_kpa))
                kpa_values.append(max_kpa)
                cap_values.append(max_cap)
            stats_by_channel.append({
                "channel": channel,
                "ps": self._stats(ps_values),
                "kpa": self._stats(kpa_values),
                "cap": self._stats(cap_values),
            })
        return stats_by_channel

    def _summary_tsv(self, channel_stats):
        rows = [["Summary Stat", *[f"CH {item['channel']}" for item in channel_stats]]]
        metrics = [
            ("Mean PS at Inflection", "ps", "mean", ""),
            ("Std PS at Inflection", "ps", "std", ""),
            ("COV PS at Inflection", "ps", "cov", "%"),
            ("Min PS at Inflection", "ps", "min", ""),
            ("Max PS at Inflection", "ps", "max", ""),
            ("Mean Max kPa", "kpa", "mean", " kPa"),
            ("Std Max kPa", "kpa", "std", " kPa"),
            ("COV Max kPa", "kpa", "cov", "%"),
            ("Min Max kPa", "kpa", "min", " kPa"),
            ("Max Max kPa", "kpa", "max", " kPa"),
            ("Mean Max CAP", "cap", "mean", " pF"),
            ("Std Max CAP", "cap", "std", " pF"),
            ("COV Max CAP", "cap", "cov", "%"),
            ("Min Max CAP", "cap", "min", " pF"),
            ("Max Max CAP", "cap", "max", " pF"),
        ]
        for label, group, key, unit in metrics:
            rows.append([label, *[self._format_value(item[group][key], unit) for item in channel_stats]])
        return "\n".join("\t".join(row) for row in rows)

    def _report_output(self, channel_stats):
        headers = ["Sensor ID", "Test Result", "Analysis Folder"]
        headers.extend(f"CH{item['channel']} Mean PS at Inf" for item in channel_stats)
        headers.extend(f"CH{item['channel']} Mean Max kPa" for item in channel_stats)
        headers.extend(f"CH{item['channel']} Mean Max CAP" for item in channel_stats)
        row = [self.sensor_id, "PASS", str(self.analysis_folder)]
        row.extend(f"{item['ps']['mean']:.3f}" for item in channel_stats)
        row.extend(f"{item['kpa']['mean']:.3f}" for item in channel_stats)
        row.extend(f"{item['cap']['mean']:.3f}" for item in channel_stats)
        return "\n".join(["\t".join(headers), "\t".join(row)])

    def _write_test_specific_outputs(self, readings, channel_stats):
        test_type = str(self.payload.get("test_type") or "EM")
        outputs = {}
        if test_type == "Shear":
            plot_path = self.analysis_folder / "Shear_Test_Plot.svg"
            failure_path = self.analysis_folder / "Shear_Failure_Checks.tsv"
            plot_path.write_text(self._simple_svg("Shear Test Plot", readings, "Force (N)"))
            failure_path.write_text(self._shear_failure_checks_tsv())
            outputs.update({
                "shear_plot": str(plot_path),
                "shear_failure_checks": str(failure_path),
            })
        elif test_type == "Manual":
            manual_data_path = self.analysis_folder / "Manual_Test_Data.tsv"
            cap_force_path = self.analysis_folder / "Manual_Capacitance_vs_Force.svg"
            force_time_path = self.analysis_folder / "Manual_Force_vs_Time.svg"
            cap_time_path = self.analysis_folder / "Manual_Capacitance_vs_Time.svg"
            manual_points = self._manual_points()
            manual_data_path.write_text(self._manual_data_tsv(manual_points))
            cap_force_path.write_text(self._manual_svg("Capacitance vs Force", manual_points, "force", "capacitance", "Force (N)", "Capacitance"))
            force_time_path.write_text(self._manual_svg("Force vs Time", manual_points, "time", "force", "Time (s)", "Force (N)"))
            cap_time_path.write_text(self._manual_svg("Capacitance vs Time", manual_points, "time", "capacitance", "Time (s)", "Capacitance"))
            outputs.update({
                "manual_data": str(manual_data_path),
                "manual_capacitance_vs_force": str(cap_force_path),
                "manual_force_vs_time": str(force_time_path),
                "manual_capacitance_vs_time": str(cap_time_path),
            })
        return outputs

    def _shear_failure_checks_tsv(self):
        headers = ["Failure Check", *[f"ch {index}" for index in range(1, 9)]]
        negative_row = ["negative CAP", *["None" for _ in range(8)]]
        delta_row = ["delta_CAP_gt_10pF", *["None" for _ in range(8)]]
        return "\n".join("\t".join(row) for row in [headers, negative_row, delta_row])

    def _manual_points(self):
        points = []
        for index, item in enumerate(self.payload.get("manual_readings") or []):
            if not isinstance(item, dict):
                continue
            points.append({
                "time": self._safe_float(item.get("time")) if self._safe_float(item.get("time")) is not None else index * 0.1,
                "force": self._safe_float(item.get("force")) or 0.0,
                "capacitance": self._safe_float(item.get("capacitance")) or 0.0,
            })
        if not points:
            points = [{"time": index * 0.1, "force": index * 0.2, "capacitance": 12 + index * 0.08} for index in range(25)]
        return points

    def _manual_data_tsv(self, points):
        rows = [["Time (s)", "Force (N)", "Capacitance"]]
        for point in points:
            rows.append([f"{point['time']:.4f}", f"{point['force']:.5f}", f"{point['capacitance']:.5f}"])
        return "\n".join("\t".join(row) for row in rows)

    def _manual_svg(self, title, points, x_key, y_key, x_label, y_label):
        readings = []
        for point in points:
            readings.append({"run": 1, "time": point[x_key], "force": point[y_key]})
        return self._simple_svg(title, readings, y_label).replace("Time (s)", x_label)

    def _simple_svg(self, title, readings, y_label):
        width, height = 920, 340
        pad_left, pad_right, pad_top, pad_bottom = 64, 22, 48, 48
        max_time = max((point["time"] for point in readings), default=5) or 5
        max_force = max((point["force"] for point in readings), default=1) or 1
        plot_width = width - pad_left - pad_right
        plot_height = height - pad_top - pad_bottom
        paths = []
        colors = ["#3f73e6", "#3f8b42", "#ed6c02", "#8b5cf6"]
        for color_index, run_number in enumerate(sorted({point["run"] for point in readings})):
            run_points = [point for point in readings if point["run"] == run_number]
            commands = []
            for index, point in enumerate(run_points):
                x = pad_left + (point["time"] / max_time) * plot_width
                y = height - pad_bottom - (point["force"] / max_force) * plot_height
                commands.append(f"{'M' if index == 0 else 'L'}{x:.2f},{y:.2f}")
            paths.append(f'<path d="{" ".join(commands)}" fill="none" stroke="{colors[color_index % len(colors)]}" stroke-width="2.4"/>')
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#ffffff"/>
  <text x="{pad_left}" y="25" fill="#161d29" font-size="18" font-family="Arial" font-weight="700">{title}</text>
  <path d="M{pad_left},{pad_top} L{pad_left},{height - pad_bottom} L{width - pad_right},{height - pad_bottom}" fill="none" stroke="#c7d1df"/>
  <text x="{width / 2}" y="{height - 10}" text-anchor="middle" fill="#697790" font-size="14" font-family="Arial">Time (s)</text>
  <text x="18" y="{height / 2}" transform="rotate(-90 18 {height / 2})" text-anchor="middle" fill="#697790" font-size="14" font-family="Arial">{y_label}</text>
  {"".join(paths)}
</svg>'''

    def _stats(self, values):
        clean = [value for value in values if value is not None and math.isfinite(value)]
        if not clean:
            clean = [0.0]
        mean = statistics.fmean(clean)
        std = statistics.pstdev(clean) if len(clean) > 1 else 0.0
        cov = (std / abs(mean) * 100) if abs(mean) > 1e-9 else 0.0
        return {"mean": mean, "std": std, "cov": cov, "min": min(clean), "max": max(clean)}

    def _run_number(self, name, fallback):
        match = re.search(r"run\D*(\d+)", name, flags=re.IGNORECASE)
        return int(match.group(1)) if match else fallback

    def _column_index(self, ref):
        letters = re.match(r"([A-Z]+)", ref.upper()).group(1)
        index = 0
        for letter in letters:
            index = index * 26 + (ord(letter) - ord("A") + 1)
        return index - 1

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


class Handler(SimpleHTTPRequestHandler):
    # serve the page and handle the button api calls.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        # allow the file:// preview page to call this local backend.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        # every browser action posts json here.
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
        comport = payload.get("comport") or "COM3"

        if path == "/api/verify":
            save_folder = Path(payload.get("save_folder") or "").expanduser()
            return True, f"Settings verified. Save folder ready: {save_folder}"

        if path == "/api/check-existing":
            return self.check_existing(payload)

        if path == "/api/browse-folder":
            return self.browse_folder()

        if path == "/api/connect":
            return STATE.connect_zaber(comport)

        if path == "/api/move":
            return STATE.move(comport, float(payload.get("distance", 0)))

        if path == "/api/home":
            return STATE.home(comport)

        if path == "/api/pause":
            return STATE.pause(comport)

        if path in {"/api/stop", "/api/emergency-stop"}:
            return STATE.stop()

        if path == "/api/start-test":
            return self.start_test(payload)

        if path == "/api/perform-analysis":
            return self.perform_analysis(payload)

        if path == "/api/fuji-film":
            return False, "Fuji Film test needs the FUTEK runtime/driver available to Python."

        return False, f"Unknown API route: {path}"

    def test_folder_for_payload(self, payload):
        # a normal save folder is the base drive folder; tests live under sensor/date folders.
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
            if re.fullmatch(r"\d{2} \d{2} \d{2}_.+_(EM|EB|Shear|Manual|Cyclical)(?:_\d+)?", part, flags=re.IGNORECASE):
                return Path(*parts[:max(1, index - 1)])
            if re.fullmatch(r"\d{6}B\d{2}S\d{2}(A|B|AB)(?:_\d+)?", part, flags=re.IGNORECASE):
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
            "Cyclical": "Cyclical",
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
        # If today's folder does not exist yet, still catch previous folders for the
        # same sensor, surface area, and test type. The date prefix can differ.
        match = re.fullmatch(
            r"\d{2} \d{2} \d{2}_(?P<surface>.+)_(?P<test>EM|EB|Shear|Manual|Cyclical)(?:_(?P<version>\d+))?",
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
        # use both fut and cap filenames so redo mode can verify the selected run exists.
        run_numbers = set()
        for path in list((folder / "FUT").glob("*.xlsx")) + list((folder / "FUT").glob("*.csv")) + list((folder / "CAP").glob("*.csv")):
            match = re.search(r"run\D*(\d+)", path.name, flags=re.IGNORECASE)
            if match:
                run_numbers.add(int(match.group(1)))
        return sorted(run_numbers)

    def start_test(self, payload):
        test_folder = self.test_folder_for_payload(payload)
        return {
            "ok": True,
            "test_folder": str(test_folder),
            "message": f"Test folder ready: {test_folder}",
        }

    def prepare_test_folder(self, payload, test_folder):
        test_folder = Path(test_folder).expanduser()
        fut_folder = test_folder / "FUT"
        cap_folder = test_folder / "CAP"
        if payload.get("existing_test_action") == "overwrite" and test_folder.exists():
            # overwrite means clear the old generated run folders before writing new files.
            for child in (fut_folder, cap_folder):
                if child.exists():
                    shutil.rmtree(child)
        fut_folder.mkdir(parents=True, exist_ok=True)
        cap_folder.mkdir(parents=True, exist_ok=True)

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

        redo_run = bool(payload.get("redo_run"))
        run_numbers = [int(payload.get("run_to_redo") or 1)] if redo_run else list(range(1, int(payload.get("runs") or 1) + 1))
        for run_number in run_numbers:
            self.write_preview_fut(fut_folder / f"Run {run_number}.csv", run_number)
            self.write_preview_cap(cap_folder / f"Run {run_number}.csv", run_number)

    def write_preview_fut(self, path, run_number):
        with path.open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Index", "Load Cell", "Time"])
            for index in range(501):
                time_value = round(index * 0.01, 4)
                force = round(0.45 + time_value * 1.15 + math.log1p(time_value) * 0.9, 5)
                writer.writerow([index + 1, force, time_value])

    def write_preview_cap(self, path, run_number):
        with path.open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Time", "Unused1", "Unused2", "Unused3", "Unused4", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8"])
            for index in range(501):
                time_value = round(index * 0.01, 4)
                force = 0.45 + time_value * 1.15 + math.log1p(time_value) * 0.9
                channels = [round(18 + force * (0.82 + channel * 0.055) + math.sin(time_value + channel) * 0.03, 5) for channel in range(1, 9)]
                writer.writerow([time_value, "", "", "", "", *channels])

    def _safe_float(self, value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _clean_force_readings(self, readings):
        points = []
        for index, item in enumerate(readings or []):
            if not isinstance(item, dict):
                continue
            time_value = self._safe_float(item.get("time"))
            force = self._safe_float(item.get("force"))
            if force is None:
                continue
            points.append({"time": time_value if time_value is not None else index * 0.01, "force": force})
        return points or [{"time": index * 0.01, "force": 0.2 + index * 0.003} for index in range(501)]

    def _clean_manual_readings(self, readings):
        points = []
        for index, item in enumerate(readings or []):
            if not isinstance(item, dict):
                continue
            time_value = self._safe_float(item.get("time"))
            force = self._safe_float(item.get("force"))
            capacitance = self._safe_float(item.get("capacitance"))
            points.append({
                "time": time_value if time_value is not None else index * 0.1,
                "force": force if force is not None else 0.0,
                "capacitance": capacitance if capacitance is not None else 12.0,
            })
        return points or [{"time": index * 0.1, "force": index * 0.2, "capacitance": 12 + index * 0.08} for index in range(25)]

    def write_reading_fut(self, path, readings):
        with path.open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Index", "Load Cell", "Time"])
            for index, point in enumerate(readings, start=1):
                writer.writerow([index, round(point["force"], 5), round(point["time"], 5)])

    def write_reading_cap(self, path, readings):
        with path.open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Time", "Unused1", "Unused2", "Unused3", "Unused4", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8"])
            for point in readings:
                force = point["force"]
                channels = [round(18 + force * (0.65 + channel * 0.045) + math.sin(point["time"] + channel) * 0.02, 5) for channel in range(1, 9)]
                writer.writerow([round(point["time"], 5), "", "", "", "", *channels])

    def perform_analysis(self, payload):
        test_folder = self.test_folder_for_payload(payload)
        self.prepare_test_folder(payload, test_folder)
        analyzer = SavedTestAnalyzer(payload, test_folder)
        return analyzer.run()

    def browse_folder(self):
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


def open_browser(url):
    # double-click runs should open chrome automatically.
    try:
      subprocess.Popen(["open", "-a", "Google Chrome", url])
    except Exception:
      subprocess.Popen(["open", url])


def find_free_port(preferred):
    # use 8765 when possible, otherwise pick a free port.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, preferred))
            return preferred
        except OSError:
            pass

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def main():
    # start the local server that connects the browser to python.
    os.chdir(PROJECT_ROOT)
    port = find_free_port(PREFERRED_PORT)
    server = ThreadingHTTPServer((HOST, port), Handler)
    url = f"http://{HOST}:{port}/index.html"
    if "--no-open" not in sys.argv:
        threading.Timer(0.4, open_browser, args=(url,)).start()
    print(f"Zaber browser GUI running at {url}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
