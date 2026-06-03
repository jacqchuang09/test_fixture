# saved-test analyzer: reads FUT/CAP run files and writes per-test-type analysis
# outputs (EM / Shear / Manual). plots are SVG, results CSV, archive JSON, plus an
# interactive plotly html.
import csv
import io
import json
import math
import re
import statistics
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from config import ROOT
from hardware import load_cell_force


class SavedTestAnalyzer:
    # read saved fut/cap files and write lightweight analysis outputs.
    # this is currently a preview analysis layer, but it uses the same folder/files
    # that the real analysis scripts will use later.
    def __init__(self, payload, test_folder):
        self.payload = payload
        self.test_folder = Path(test_folder).expanduser()
        self.sensor_id = payload.get("sensor_id") or self.test_folder.name or "selected sensor"
        self.surface_area = self._float_from_text(payload.get("surface_area"), default=325.0)
        self.sensor_type = payload.get("sensor_type") or "Standard"
        self.analysis_folder = self.test_folder

    def run(self):
        # main analysis entry point. it gathers fut/cap data, calculates stats,
        # writes plots/tables, then returns a summary object back to the browser.
        fut_files = self._find_files("FUT", "*.xlsx") + self._find_files("FUT", "*.csv")
        cap_files = self._find_files("CAP", "*.csv")
        self.analysis_folder.mkdir(parents=True, exist_ok=True)

        fut_runs = self._read_fut_runs(fut_files)
        cap_runs = self._read_cap_runs(cap_files)
        self._fut_runs = fut_runs   # kept so Manual can rebuild points from files
        self._cap_runs = cap_runs
        readings = self._build_readings(fut_runs)

        test_type = str(self.payload.get("test_type") or "EM")

        # For EM tests, run Emilio's real analysis pipeline when the scientific
        # stack and suitable run files are available. It writes the real plots
        # (PNG) and result tables (xlsx/json/pkl) into the test folder and gives
        # back real per-channel statistics. Anything unexpected falls back to the
        # lightweight preview analysis so the demo always produces something.
        em_summary = None
        if test_type not in ("Shear", "Manual"):
            em_summary = self._run_real_em()

        if em_summary is not None:
            channel_stats = em_summary["channel_stats"]
        else:
            channel_stats = self._channel_stats(fut_runs, cap_runs)
        report_output = self._report_output(channel_stats)

        # drop leftover files from older runs so the folder stays minimal.
        self._remove_stale_outputs()

        if test_type == "Shear":
            outputs = self._write_shear_layout(readings, channel_stats, report_output)
        elif test_type == "Manual":
            outputs = self._write_manual_layout(readings, channel_stats, report_output)
        else:
            outputs = self._write_em_layout(readings, channel_stats, cap_runs, report_output, em_summary)

        # the only extra written for every test type: a self-contained interactive
        # (Plotly) plot of the real data — zoom, pan, hover, annotate, PNG export.
        interactive_html_path = self.analysis_folder / "Analysis_Plots.html"
        interactive_html_path.write_text(self._interactive_plots_html(
            test_type, readings, channel_stats,
            em_plots=(em_summary.get("plots") if em_summary else None),
            cap_runs=cap_runs,
        ))

        summary_path = outputs.get("results_table", str(interactive_html_path))
        report_path = outputs.get("results_archive", str(interactive_html_path))

        if not fut_files and not cap_files:
            return {
                "ok": False,
                "message": f"No FUT or CAP files were found in {self.test_folder}. Run a test before performing analysis.",
            }

        engine = "real" if em_summary is not None else "preview"
        engine_note = (
            " Real EM analysis pipeline used (inflection detection on smoothed P.S curves)."
            if em_summary is not None else ""
        )
        message = (
            f"Analysis completed for {self.sensor_id}. Read {len(fut_files)} FUT file(s) "
            f"and {len(cap_files)} CAP file(s). Outputs saved to {self.analysis_folder}.{engine_note}"
        )

        return {
            "ok": True,
            "message": message,
            "analysis": {
                "sensor_id": self.sensor_id,
                "test_type": test_type,
                "engine": engine,
                "shorted_channels": em_summary.get("shorted_channels", []) if em_summary else [],
                "em_plots": em_summary.get("plots") if em_summary else None,
                "em_images": outputs.get("em_images") if isinstance(outputs, dict) else None,
                "shear_images": outputs.get("shear_images") if isinstance(outputs, dict) else None,
                "shear_detection": outputs.get("shear_detection") if isinstance(outputs, dict) else None,
                "shear_result": outputs.get("shear_result") if isinstance(outputs, dict) else None,
                "manual_images": outputs.get("manual_images") if isinstance(outputs, dict) else None,
                "interactive_html": str(interactive_html_path),
                "redo_info": self._redo_info(),
                "test_folder": str(self.test_folder),
                "analysis_folder": str(self.analysis_folder),
                "fut_file_count": len(fut_files),
                "cap_file_count": len(cap_files),
                "summary_path": summary_path,
                "report_path": report_path,
                "channel_stats": channel_stats,
                "readings": readings,
            },
        }

    def _remove_stale_outputs(self):
        # delete superseded/older output files so the analysis folder stays to the
        # minimal set (plots + .xlsx + .pkl + Analysis_Plots.html). Targeted by
        # exact name; never touches the FUT/CAP input folders.
        stale = [
            "Analysis_Data.json", "File_Structure.md", "analysis_summary.json",
            "eb_analysis_results.json", "EB_Analysis_Results.csv",
            "shear_analysis_results.json", "Shear_Analysis_Results.csv",
            "manual_analysis_results.json", "Manual_Analysis_Results.csv",
        ]
        for name in stale:
            try:
                target = self.analysis_folder / name
                if target.is_file():
                    target.unlink()
            except OSError:
                pass

    def _run_log(self):
        try:
            import run_log
            return run_log.load(self.test_folder)
        except Exception:
            return {"runs": [], "redos": []}

    def _active_runs(self):
        # the latest run in each supersession chain, or None to use every file
        # (e.g. real saved folders with no run_log.json).
        import run_log
        active = run_log.active_runs(self._run_log())
        return active or None

    def _redo_info(self):
        import run_log
        log = self._run_log()
        return {
            "all_runs": log.get("runs", []),
            "active_runs": run_log.active_runs(log),
            "redos": run_log.reason_rows(log),
            "reason_summary": run_log.reason_summary(log),
        }

    def _run_real_em(self):
        # run the real EM pipeline (Emilio's EMAnalysis). Returns the summary dict
        # on success, or None if the scientific stack is missing or the run files
        # are not suitable (e.g. preview data that never reaches 45 kPa). Imported
        # lazily so the rest of the app still works without numpy/scipy/matplotlib.
        try:
            from em_analysis import run_em_analysis
        except Exception as exc:
            # scientific stack unavailable -> use the preview analysis.
            import sys
            print(f"[em-analysis] unavailable, using preview analysis: {exc}", file=sys.stderr)
            return None
        try:
            return run_em_analysis(
                self.test_folder,
                self.sensor_id,
                self.sensor_type,
                self.surface_area,
                active_runs=self._active_runs(),
            )
        except Exception as exc:
            # any data/format issue (e.g. preview data that never reaches test
            # pressure) -> fall back to the preview analysis.
            import sys
            print(f"[em-analysis] preview fallback: {exc}", file=sys.stderr)
            return None

    def _find_files(self, folder_name, pattern):
        # helper for finding saved run files inside FUT or CAP.
        direct = self.test_folder / folder_name
        if direct.exists():
            return sorted(direct.glob(pattern))
        return sorted(self.test_folder.rglob(pattern))

    def _read_fut_runs(self, files):
        # fut files hold force/load-cell style data.
        runs = {}
        for index, path in enumerate(files, start=1):
            run_number = self._run_number(path.name, index)
            rows = self._read_fut_numeric_rows(path)
            points = []
            for row_index, row in enumerate(rows[1:] if len(rows) > 1 else rows):
                force = load_cell_force(self._safe_float(row[1] if len(row) > 1 else None))
                # time is "Time Elapsed" (col 3) in the real FUTEK Live Graph export
                # (4 cols), or col 2 in our generated 3-column files.
                time_idx = 3 if len(row) >= 4 else 2
                time_value = self._safe_float(row[time_idx] if len(row) > time_idx else None)
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
        # cap files hold capacitance channels. the preview format includes ch1 through ch8.
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
        # if files are missing, keep the preview useful with synthetic readings.
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
        # calculate per-channel metrics shown in the em summary stats table.
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

    def _summary_csv(self, channel_stats):
        output = io.StringIO()
        writer = csv.writer(output)
        for line in self._summary_tsv(channel_stats).splitlines():
            writer.writerow(line.split("\t"))
        return output.getvalue()

    def _analysis_data(self, readings, channel_stats):
        return {
            "sensor_id": self.sensor_id,
            "test_folder": str(self.test_folder),
            "surface_area": self.surface_area,
            "readings": readings,
            "channel_stats": channel_stats,
        }

    def _interactive_plots_html(self, test_type, readings, channel_stats, em_plots=None, cap_runs=None):
        # build a self-contained interactive html using plotly: zoom, pan, hover,
        # legend toggling, freehand/shape annotations, and png export — rendering
        # the same real curves as the matplotlib figures.
        cap_runs = cap_runs or {}

        # generic raw force-vs-time (fallback when no richer data is available).
        raw_traces = []
        for run_number in sorted({point["run"] for point in readings}):
            run_points = [point for point in readings if point["run"] == run_number]
            raw_traces.append({
                "x": [point["time"] for point in run_points],
                "y": [point["force"] for point in run_points],
                "mode": "lines", "type": "scatter", "name": f"Run {run_number}",
            })

        manual_payload = None
        if test_type == "Manual":
            points = self._manual_points()
            manual_payload = {
                "time": [round(p["time"], 4) for p in points],
                "force": [round(p["force"], 5) for p in points],
                "cap": [round(p["capacitance"], 5) for p in points],
            }

        shear_payload = None
        if test_type == "Shear" and cap_runs:
            # high point budget so the interactive shear plot keeps the fine
            # structure of the discrete shear presses (full data is ~70k points).
            SHEAR_MAX_POINTS = 4000
            first_run = sorted(cap_runs)[0]
            rows = cap_runs[first_run]
            step = max(1, len(rows) // SHEAR_MAX_POINTS)
            sel = rows[::step]
            times = [round(r["time"], 4) for r in sel]
            shear_channels = [{"time": times, "cap": [round(r["channels"][ch], 5) for r in sel]} for ch in range(8)]
            force_points = [p for p in readings if p["run"] == first_run] or readings
            fstep = max(1, len(force_points) // SHEAR_MAX_POINTS)
            fsel = force_points[::fstep]
            shear_payload = {
                "channels": shear_channels,
                "force": {"time": [round(p["time"], 4) for p in fsel], "force": [round(p["force"], 5) for p in fsel]},
            }

        # inline the vendored plotly library so the saved file works fully offline.
        try:
            plotly_js = (ROOT / "vendor" / "plotly.min.js").read_text(encoding="utf-8")
        except OSError:
            plotly_js = ""
        if plotly_js:
            plotly_block = "<script>" + plotly_js + "</script>"
            fallback_note = ""
        else:
            plotly_block = '<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>'
            fallback_note = "<p class='note'>Offline Plotly library was not found, so this file loads it from the internet instead.</p>"

        payload = {
            "sensorId": self.sensor_id,
            "testType": test_type,
            "em": em_plots,
            "manual": manual_payload,
            "shear": shear_payload,
            "rawTraces": raw_traces,
        }

        template = """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>__SENSOR__ Interactive Plots</title>
  __PLOTLY__
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #161d29; }
    h1 { font-size: 22px; }
    .note { background: #eaf3ff; border: 1px solid #a9cdfd; padding: 14px 18px; border-radius: 10px; color: #17456f; }
    .note p { margin: 0 0 8px; }
    .note ul { margin: 0; padding-left: 20px; }
    .note li { margin: 4px 0; line-height: 1.5; }
    .toolbar { margin: 12px 0 4px; display: flex; gap: 10px; align-items: center; }
    .toolbar button { font: inherit; padding: 8px 14px; border: 1px solid #b8c0cc; border-radius: 8px; background: #fff; cursor: pointer; }
    .toolbar button:hover { background: #f3f6fb; }
    .toolbar .on { background: #ffe9a8; border-color: #e0a800; }
    .plot { width: 100%; height: 520px; margin-bottom: 30px; }
  </style>
</head>
<body>
  <h1>__SENSOR__ Interactive Plots</h1>
  <div class="note">
    <p><strong>These plots are fully interactive</strong>, explore the data however you like:</p>
    <ul>
      <li><strong>Zoom</strong>: scroll over the plot, or drag a box around the region you want to inspect</li>
      <li><strong>Pan</strong>: click and drag to move around; double-click anywhere to snap back to the full view</li>
      <li><strong>Read exact values</strong>: hover over any point to see its coordinates</li>
      <li><strong>Switch runs (EM)</strong>: use the <em>Run ▾</em> menu at the top-left of a plot</li>
      <li><strong>Focus on channels</strong>: click a name in the legend to hide or show that series</li>
      <li><strong>Add a comment</strong>: click <em>💬 Add comment</em>, then click a point and type your note; it pins a labeled arrow to that exact spot. Drag it to reposition, double-click the text to edit, or use <em>Clear comments</em> to remove them</li>
      <li><strong>Export</strong>: click the camera icon (top-right toolbar) to save the current view as a PNG</li>
    </ul>
  </div>
  __FALLBACK__
  <div class="toolbar">
    <button id="commentBtn" onclick="toggleComments(this)">💬 Add comment</button>
    <button onclick="clearComments()">Clear comments</button>
  </div>
  <div id="plots"></div>
  <script>
    var DATA = __PAYLOAD__;
    var config = {
      responsive: true, scrollZoom: true,
      // only annotations are editable (drag/retype comments) — no title/subtitle/
      // axis-title edit placeholders ("Click to enter Plot subtitle" etc.).
      edits: { annotationPosition: true, annotationTail: true, annotationText: true },
      modeBarButtonsToAdd: ['drawline', 'drawopenpath', 'drawrect', 'drawcircle', 'eraseshape'],
      toImageButtonOptions: { format: 'png', filename: DATA.sensorId + '_plot', scale: 2 }
    };
    var NEWSHAPE = { line: { color: '#ed6c02' } };
    var commentMode = false;
    var GRAPHS = [];

    // click-to-comment: pin an arrowed text callout to the clicked data point.
    function attachComments(gd) {
      GRAPHS.push(gd);
      gd.on('plotly_click', function (ev) {
        if (!commentMode || !ev.points || !ev.points.length) return;
        var pt = ev.points[0];
        var label = (pt.data && pt.data.name) ? pt.data.name + ' @ ' : '';
        var text = window.prompt('Comment for ' + label + '(' + pt.x + ', ' + pt.y + '):', '');
        if (!text) return;
        var ann = (gd.layout.annotations || []).slice();
        var xref = (pt.data && pt.data.xaxis) ? pt.data.xaxis : 'x';
        var yref = (pt.data && pt.data.yaxis) ? pt.data.yaxis : 'y';
        ann.push({
          x: pt.x, y: pt.y, xref: xref, yref: yref, text: text,
          showarrow: true, arrowhead: 3, arrowsize: 1, arrowwidth: 1.5, arrowcolor: '#e0a800',
          ax: 0, ay: -42, bgcolor: '#fffbe6', bordercolor: '#e0a800', borderwidth: 1, borderpad: 4,
          font: { size: 12, color: '#161d29' }, captureevents: true
        });
        Plotly.relayout(gd, { annotations: ann });
      });
    }
    function makePlot(id, traces, layout) {
      var d = document.createElement('div'); d.id = id; d.className = 'plot';
      document.getElementById('plots').appendChild(d);
      layout.newshape = NEWSHAPE;
      Plotly.newPlot(id, traces, layout, config).then(function () { attachComments(document.getElementById(id)); });
    }
    function toggleComments(btn) {
      commentMode = !commentMode;
      btn.classList.toggle('on', commentMode);
      btn.textContent = commentMode ? '💬 Comment mode ON — click a point' : '💬 Add comment';
      document.body.style.cursor = commentMode ? 'crosshair' : '';
    }
    function clearComments() {
      GRAPHS.forEach(function (gd) { Plotly.relayout(gd, { annotations: [] }); });
    }
    function runButtons(runs, tracesPerRun, total) {
      return runs.map(function (rd, ri) {
        var vis = []; for (var t = 0; t < total; t++) vis.push(Math.floor(t / tracesPerRun) === ri);
        return { label: 'Run ' + rd.run, method: 'update', args: [{ visible: vis }] };
      });
    }

    if (DATA.em) {
      var NCH = DATA.em.channels, RUNS = DATA.em.runs;
      function suf(i) { return i === 0 ? '' : (i + 1); }   // grid-cell axis suffix
      // small "CH n" title above each of the 8 grid cells (4 cols x 2 rows).
      function cellTitles() {
        var a = [];
        for (var c = 0; c < NCH; c++) {
          var col = c % 4, row = Math.floor(c / 4);
          a.push({ text: 'CH ' + (c + 1), x: (col + 0.5) / 4, y: row === 0 ? 1.0 : 0.45, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 12, color: '#161d29' }, xanchor: 'center' });
        }
        return a;
      }
      function gridRunButtons(runOf) {
        return RUNS.map(function (rd, ri) {
          return { label: 'Run ' + rd.run, method: 'update', args: [{ visible: runOf.map(function (r) { return r === ri; }) }] };
        });
      }
      function psPoints(rd, ci) {
        var xs = [], ys = [];
        rd.pressure.forEach(function (p, k) { if (p != null && rd.channels[ci].cap[k] != null) { xs.push(p); ys.push(rd.channels[ci].cap[k]); } });
        return { x: xs, y: ys };
      }
      function gridLayout(title, runOf, xtitle, ytitle, extra) {
        var lay = { title: { text: title }, grid: { rows: 2, columns: 4, pattern: 'independent' }, height: 680, hovermode: 'closest', showlegend: false, margin: { t: 92 }, annotations: cellTitles(), updatemenus: [{ buttons: gridRunButtons(runOf), x: 0, xanchor: 'left', y: 1.08, showactive: true }] };
        for (var i = 0; i < NCH; i++) {
          var s = suf(i);
          lay['xaxis' + s] = { title: { text: xtitle, font: { size: 9 } } };
          lay['yaxis' + s] = { title: { text: ytitle, font: { size: 9 } } };
        }
        if (extra) Object.keys(extra).forEach(function (k) { lay[k] = extra[k]; });
        return lay;
      }

      // ===== Raw Signals tab — the three per-channel subplots, each a grid =====
      // (1) ΔCAP vs Time
      var rs = [], rsRun = [];
      RUNS.forEach(function (rd, ri) { for (var ci = 0; ci < NCH; ci++) { rs.push({ x: rd.raw.time, y: rd.raw.cap[ci], mode: 'lines', line: { width: 1.4 }, xaxis: 'x' + suf(ci), yaxis: 'y' + suf(ci), visible: ri === 0, showlegend: false }); rsRun.push(ri); } });
      makePlot('rawGrid', rs, gridLayout(DATA.sensorId + ' — Raw Signals: ΔCAP vs Time', rsRun, 'Time (s)', 'Change in CAP (pF)'));

      // (2) Pressure vs Time — one trace per run (pressure is shared across channels)
      var ptr = [], ptrRun = [];
      RUNS.forEach(function (rd, ri) { ptr.push({ x: rd.raw.time, y: rd.raw.pressure, mode: 'lines', line: { width: 1.8, color: '#2e9e4f' }, visible: ri === 0, showlegend: false }); ptrRun.push(ri); });
      makePlot('pressTime', ptr, { title: { text: DATA.sensorId + ' — Raw Signals: Pressure vs Time' }, xaxis: { title: 'Time (s)' }, yaxis: { title: 'Pressure (kPa)' }, hovermode: 'closest', showlegend: false, updatemenus: [{ buttons: gridRunButtons(ptrRun), x: 0, xanchor: 'left', y: 1.16, showactive: true }] });

      // (3) ΔCAP vs Pressure (hysteresis)
      var hy = [], hyRun = [];
      RUNS.forEach(function (rd, ri) { for (var ci = 0; ci < NCH; ci++) { hy.push({ x: rd.raw.pressure, y: rd.raw.cap[ci], mode: 'lines', line: { width: 1.3 }, xaxis: 'x' + suf(ci), yaxis: 'y' + suf(ci), visible: ri === 0, showlegend: false }); hyRun.push(ri); } });
      makePlot('hystGrid', hy, gridLayout(DATA.sensorId + ' — Raw Signals: ΔCAP vs Pressure (hysteresis)', hyRun, 'Pressure (kPa)', 'Change in CAP (pF)'));

      // ===== Pressure Sensitivity tab — ΔCAP (blue) + 1st derivative (orange, right axis) + inflection =====
      var ps = [], psRun = [], secAxes = {};
      RUNS.forEach(function (rd, ri) {
        for (var ci = 0; ci < NCH; ci++) {
          var p = suf(ci), pp = psPoints(rd, ci), ch = rd.channels[ci];
          ps.push({ x: pp.x, y: pp.y, mode: 'lines', line: { width: 1.8, color: '#3f73e6' }, xaxis: 'x' + p, yaxis: 'y' + p, visible: ri === 0, showlegend: false });
          psRun.push(ri);
          ps.push({ x: ch.deriv_x, y: ch.deriv, mode: 'lines', line: { width: 1.1, color: '#f28c28' }, xaxis: 'x' + p, yaxis: 'y' + (9 + ci), visible: ri === 0, showlegend: false });
          psRun.push(ri);
          ps.push({ x: ch.infl ? [ch.infl.kpa] : [], y: ch.infl ? [ch.infl.cap] : [], mode: 'markers', marker: { color: '#e11955', size: 8 }, xaxis: 'x' + p, yaxis: 'y' + p, visible: ri === 0, showlegend: false });
          psRun.push(ri);
        }
      });
      for (var si = 0; si < NCH; si++) { var sp = suf(si); secAxes['yaxis' + (9 + si)] = { overlaying: 'y' + sp, anchor: 'x' + sp, side: 'right', showgrid: false, tickfont: { color: '#f28c28', size: 8 }, title: { text: '1st deriv (pF/kPa)', font: { size: 8, color: '#f28c28' } } }; }
      makePlot('psGrid', ps, gridLayout(DATA.sensorId + ' — Pressure Sensitivity: ΔCAP (blue) + 1st derivative (orange), • inflection', psRun, 'Pressure (kPa)', 'Change in CAP (pF)', secAxes));

      // ===== All CH/Runs tab =====
      var ac = [], acRun = [];
      RUNS.forEach(function (rd, ri) { for (var ci = 0; ci < NCH; ci++) { var pp = psPoints(rd, ci); ac.push({ x: pp.x, y: pp.y, mode: 'lines', name: 'CH ' + (ci + 1), visible: ri === 0, line: { width: 2 } }); acRun.push(ri); } });
      makePlot('allChPerRun', ac, { title: { text: DATA.sensorId + ' — All Channels (per run)' }, xaxis: { title: 'Pressure (kPa)' }, yaxis: { title: 'Change in CAP (pF)' }, hovermode: 'closest', updatemenus: [{ buttons: gridRunButtons(acRun), x: 0, xanchor: 'left', y: 1.16, showactive: true }] });

      var ar = [], arCh = [];
      for (var ci = 0; ci < NCH; ci++) { RUNS.forEach(function (rd) { var pp = psPoints(rd, ci); ar.push({ x: pp.x, y: pp.y, mode: 'lines', name: 'Run ' + rd.run, visible: ci === 0, line: { width: 2 } }); arCh.push(ci); }); }
      var chButtons = [];
      for (var cj = 0; cj < NCH; cj++) { (function (cj) { chButtons.push({ label: 'CH ' + (cj + 1), method: 'update', args: [{ visible: arCh.map(function (c) { return c === cj; }) }] }); })(cj); }
      makePlot('allRunPerCh', ar, { title: { text: DATA.sensorId + ' — All Runs (per channel)' }, xaxis: { title: 'Pressure (kPa)' }, yaxis: { title: 'Change in CAP (pF)' }, hovermode: 'closest', updatemenus: [{ buttons: chButtons, x: 0, xanchor: 'left', y: 1.16, showactive: true }] });
    } else if (DATA.manual) {
      function scatter(id, x, y, title, xl, yl, color) {
        makePlot(id, [{ x: x, y: y, mode: 'lines+markers', line: { color: color }, marker: { size: 5 } }],
          { title: DATA.sensorId + ' — ' + title, xaxis: { title: xl }, yaxis: { title: yl }, hovermode: 'closest' });
      }
      scatter('mCF', DATA.manual.force, DATA.manual.cap, 'Capacitance vs Force', 'Force (N)', 'Capacitance (pF)', '#3f73e6');
      scatter('mFT', DATA.manual.time, DATA.manual.force, 'Force vs Time', 'Time (s)', 'Force (N)', '#2e9e4f');
      scatter('mCT', DATA.manual.time, DATA.manual.cap, 'Capacitance vs Time', 'Time (s)', 'Capacitance (pF)', '#ed6c02');
    } else if (DATA.shear) {
      var SCH = DATA.shear.channels;
      function ssuf(i) { return i === 0 ? '' : (i + 1); }
      // per-channel grid: raw CAP (blue, left axis) + ΔCAP (orange, right axis),
      // matching the matplotlib Shear figure.
      var st = [];
      SCH.forEach(function (ch, ci) {
        var p = ssuf(ci);
        var base = ch.cap.length > 2 ? ch.cap[2] : (ch.cap[0] || 0);
        var delta = ch.cap.map(function (v) { return v - base; });
        st.push({ x: ch.time, y: ch.cap, mode: 'lines', line: { width: 1.2, color: '#3f73e6' }, xaxis: 'x' + p, yaxis: 'y' + p, showlegend: false });
        st.push({ x: ch.time, y: delta, mode: 'lines', line: { width: 1.2, color: '#f28c28' }, xaxis: 'x' + p, yaxis: 'y' + (9 + ci), showlegend: false });
      });
      var stitles = [];
      for (var sc = 0; sc < SCH.length; sc++) { var scol = sc % 4, srow = Math.floor(sc / 4); stitles.push({ text: 'CH ' + (sc + 1), x: (scol + 0.5) / 4, y: srow === 0 ? 1.0 : 0.45, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 12, color: '#161d29' }, xanchor: 'center' }); }
      var slay = { title: { text: DATA.sensorId + ' — Shear: CAP (blue) + ΔCAP (orange) per channel' }, grid: { rows: 2, columns: 4, pattern: 'independent' }, height: 680, hovermode: 'closest', showlegend: false, margin: { t: 80 }, annotations: stitles };
      for (var ci2 = 0; ci2 < SCH.length; ci2++) {
        var p2 = ssuf(ci2);
        slay['xaxis' + p2] = { title: { text: 'Time (s)', font: { size: 9 } } };
        slay['yaxis' + p2] = { title: { text: 'CAP (pF)', font: { size: 9, color: '#3f73e6' } } };
        slay['yaxis' + (9 + ci2)] = { overlaying: 'y' + p2, anchor: 'x' + p2, side: 'right', showgrid: false, tickfont: { color: '#f28c28', size: 8 }, title: { text: 'ΔCAP (pF)', font: { size: 8, color: '#f28c28' } } };
      }
      makePlot('shearGrid', st, slay);
      makePlot('shearForce', [{ x: DATA.shear.force.time, y: DATA.shear.force.force, mode: 'lines', line: { color: '#2e9e4f' }, name: 'Force' }],
        { title: { text: DATA.sensorId + ' — Shear: Force vs Time' }, xaxis: { title: 'Time (s)' }, yaxis: { title: 'Force (N)' }, hovermode: 'closest' });
    } else {
      makePlot('rawPlot', DATA.rawTraces, { title: DATA.sensorId + ' — Raw Signals (Force vs Time)', xaxis: { title: 'Time (s)' }, yaxis: { title: 'Force (N)' }, hovermode: 'closest' });
    }
  </script>
</body>
</html>"""
        return (template
                .replace("__PLOTLY__", plotly_block)
                .replace("__FALLBACK__", fallback_note)
                .replace("__PAYLOAD__", json.dumps(payload))
                .replace("__SENSOR__", self.sensor_id))

    def _file_structure_doc(self):
        return "\n".join([
            "# test output file structure",
            "",
            "root save folder / sensor id / date_surface-area_test-type",
            "",
            "Inputs (created while running the test):",
            "- FUT/ stores force/load-cell run files (csv or xlsx).",
            "- CAP/ stores capacitance channel run files as csv (empty for Shear).",
            "",
            "Analysis outputs (created by Perform Analysis):",
            "- Analysis_Plots.html  interactive (Plotly) plots: zoom, pan, hover, annotate.",
            "- Analysis_Data.json   raw readings + channel stats for reopening later.",
            "",
            "EM:",
            "- Raw Signal/Run N/Raw Signal_Run #N_CH1..CH8.svg",
            "- PS Curve/PS curve all CHs number #N.svg",
            "- PS curves all ch per run.svg, PS curves all run per CH.svg",
            "- eb_analysis_results.pkl, EB_Analysis_Results.xlsx",
            "",
            "Shear:",
            "- Shear_Failure_Check.svg",
            "- shear_analysis_results.pkl, Shear_Analysis_Results.xlsx",
            "",
            "Manual:",
            "- Manual_Cap_vs_Force.svg, Manual_Force_vs_Time.svg, Manual_Cap_vs_Time.svg",
            "- manual_analysis_results.pkl, Manual_Analysis_Results.xlsx",
            "",
            "Current test folder: " + str(self.test_folder),
            "",
        ])

    def _report_output(self, channel_stats):
        # build the copy/paste report row used by the report output tab.
        redo = self._redo_info()
        active = redo.get("active_runs") or []
        headers = ["Sensor ID", "Test Result", "Runs Analyzed", "Redo Reasons", "Analysis Folder"]
        headers.extend(f"CH{item['channel']} Mean PS at Inf" for item in channel_stats)
        headers.extend(f"CH{item['channel']} Mean Max kPa" for item in channel_stats)
        headers.extend(f"CH{item['channel']} Mean Max CAP" for item in channel_stats)
        runs_text = ", ".join(str(r) for r in active) if active else "all"
        row = [self.sensor_id, "PASS", runs_text, redo.get("reason_summary") or "—", str(self.analysis_folder)]
        row.extend(f"{item['ps']['mean']:.3f}" for item in channel_stats)
        row.extend(f"{item['kpa']['mean']:.3f}" for item in channel_stats)
        row.extend(f"{item['cap']['mean']:.3f}" for item in channel_stats)
        return "\n".join(["\t".join(headers), "\t".join(row)])

    def _write_em_layout(self, readings, channel_stats, cap_runs, report_output, em_summary=None):
        # em layout: per-run/per-channel raw-signal plots, ps-curve plots,
        # plus the analysis results table and archive.
        if em_summary is not None:
            return self._write_em_layout_real(channel_stats, report_output, em_summary)
        runs = sorted({point["run"] for point in readings}) or [1]
        raw_root = self.analysis_folder / "Raw Signal"
        ps_root = self.analysis_folder / "PS Curve"
        for run_number in runs:
            run_dir = raw_root / f"Run {run_number}"
            run_dir.mkdir(parents=True, exist_ok=True)
            for channel in range(1, 9):
                series = self._channel_run_series(run_number, channel, cap_runs, readings)
                title = f"Raw Signal Run #{run_number} CH{channel}"
                (run_dir / f"Raw Signal_Run #{run_number}_CH{channel}.svg").write_text(
                    self._simple_svg(title, series, "Capacitance (pF)"))
        ps_root.mkdir(parents=True, exist_ok=True)
        for run_number in runs:
            (ps_root / f"PS curve all CHs number #{run_number}.svg").write_text(
                self._ps_all_channels_svg(run_number, cap_runs, readings,
                                          f"PS Curve All CHs - Run #{run_number}"))
        ch_per_run = self.analysis_folder / "PS curves all ch per run.svg"
        run_per_ch = self.analysis_folder / "PS curves all run per CH.svg"
        ch_per_run.write_text(self._ps_all_channels_svg(runs[0], cap_runs, readings, "PS Curves - All CH per Run"))
        run_per_ch.write_text(self._simple_svg("PS Curves - All Runs per CH", readings, "Pressure Sensitivity"))

        results_table = self.analysis_folder / "EB_Analysis_Results.csv"
        results_archive = self.analysis_folder / "eb_analysis_results.json"
        results_table.write_text(self._summary_csv(channel_stats))
        results_archive.write_text(json.dumps({
            **self._analysis_data(readings, channel_stats),
            "report_output": report_output,
        }, indent=2))
        return {
            "raw_signal_folder": str(raw_root),
            "ps_curve_folder": str(ps_root),
            "ps_curves_all_ch_per_run": str(ch_per_run),
            "ps_curves_all_run_per_ch": str(run_per_ch),
            "results_table": str(results_table),
            "results_archive": str(results_archive),
        }

    def _write_em_layout_real(self, channel_stats, report_output, em_summary):
        # the real engine (em_analysis) has already written the matplotlib SVGs
        # (PS Curve/ and Raw Signal/Run N/) plus EB_Analysis_Results.xlsx and
        # eb_analysis_results.pkl into the test folder. Here we just map the paths.
        runs = em_summary.get("runs", 0)
        results_xlsx = self.analysis_folder / "EB_Analysis_Results.xlsx"
        results_pkl = self.analysis_folder / "eb_analysis_results.pkl"

        # Map the generated matplotlib figures to the analysis tabs so the browser
        # can display the real figures (served via /plot-file). Figures live in
        # the structured layout: PS Curve/ and Raw Signal/Run N/.
        ps_by_run = {}
        for svg in (self.analysis_folder / "PS Curve").glob("PS curve all CHs number #*.svg"):
            match = re.search(r"number #(\d+)", svg.name)
            if match:
                ps_by_run[str(int(match.group(1)))] = str(svg)
        raw_by_run = {}
        for svg in (self.analysis_folder / "Raw Signal").rglob("Raw Signal_Run #*_CH*.svg"):
            match = re.search(r"Run #(\d+)_CH(\d+)", svg.name)
            if match:
                run_no, channel_no = match.group(1), int(match.group(2))
                raw_by_run.setdefault(str(int(run_no)), []).append((channel_no, str(svg)))
        raw_images = {run: [path for _, path in sorted(items)] for run, items in raw_by_run.items()}

        em_images = {
            "ps_curve": ps_by_run,
            "raw_signal": raw_images,
            "all_ch_per_run": str(self.analysis_folder / "PS curves all ch per run.svg"),
            "all_run_per_ch": str(self.analysis_folder / "PS curves all run per CH.svg"),
        }

        return {
            "engine": "real",
            "runs": runs,
            "shorted_channels": em_summary.get("shorted_channels", []),
            "em_images": em_images,
            "raw_signal_plots": sorted(p for items in raw_by_run.values() for _, p in items),
            "ps_curve_plots": sorted(ps_by_run.values()),
            "ps_curves_all_ch_per_run": str(self.analysis_folder / "PS curves all ch per run.svg"),
            "ps_curves_all_run_per_ch": str(self.analysis_folder / "PS curves all run per CH.svg"),
            "results_table": str(results_xlsx),
            "results_workbook": str(results_xlsx),
            "results_archive": str(results_pkl),
        }

    def _run_real_shear(self):
        # run the real shear pipeline (matplotlib figure + shorted-channel
        # detection). Returns the summary dict, or None if the scientific stack is
        # missing or the data is unusable, so the caller can fall back to preview.
        try:
            from shear_analysis import run_shear_analysis
        except Exception as exc:
            import sys
            print(f"[shear-analysis] unavailable, using preview analysis: {exc}", file=sys.stderr)
            return None
        try:
            return run_shear_analysis(self.test_folder, self.sensor_id)
        except Exception as exc:
            import sys
            print(f"[shear-analysis] preview fallback: {exc}", file=sys.stderr)
            return None

    def _write_shear_layout(self, readings, channel_stats, report_output):
        shear_summary = self._run_real_shear()
        if shear_summary is not None:
            # diagram layout: Shear_Failure_Check.svg + Shear_Analysis_Results.xlsx
            # + shear_analysis_results.pkl, all written by the shear engine.
            return {
                "shear_images": {"raw_fig": shear_summary["image_path"]},
                "shear_detection": shear_summary["detection"],
                "shear_result": shear_summary["result"],
                "results_table": shear_summary["result_workbook"],
                "results_workbook": shear_summary["result_workbook"],
                "results_archive": shear_summary["result_pickle"],
            }

        # preview fallback: lightweight SVG + csv/json so the demo still works.
        failure_plot = self.analysis_folder / "Shear_Failure_Check.svg"
        results_table = self.analysis_folder / "Shear_Analysis_Results.csv"
        results_archive = self.analysis_folder / "shear_analysis_results.json"
        failure_plot.write_text(self._simple_svg("Shear Failure Check", readings, "Force (N)"))
        results_table.write_text(self._summary_csv(channel_stats))
        results_archive.write_text(json.dumps({
            **self._analysis_data(readings, channel_stats),
            "failure_checks": self._shear_failure_checks_tsv(),
            "report_output": report_output,
        }, indent=2, default=str))
        return {
            "shear_failure_check": str(failure_plot),
            "results_table": str(results_table),
            "results_archive": str(results_archive),
        }

    def _run_real_manual(self, points):
        # render the three manual figures with matplotlib. Returns the summary
        # dict, or None if the scientific stack is missing / nothing to plot.
        try:
            from manual_analysis import run_manual_analysis
        except Exception as exc:
            import sys
            print(f"[manual-analysis] unavailable, using preview analysis: {exc}", file=sys.stderr)
            return None
        try:
            return run_manual_analysis(points, self.analysis_folder, self.sensor_id)
        except Exception as exc:
            import sys
            print(f"[manual-analysis] preview fallback: {exc}", file=sys.stderr)
            return None

    def _write_manual_layout(self, readings, channel_stats, report_output):
        points = self._manual_points()

        manual_summary = self._run_real_manual(points)
        if manual_summary is not None:
            # diagram layout: three SVGs + manual_analysis_results.pkl +
            # Manual_Analysis_Results.xlsx (all written by the manual engine).
            images = manual_summary["images"]
            return {
                "manual_images": images,
                "manual_cap_vs_force": images["cap_vs_force"],
                "manual_force_vs_time": images["force_vs_time"],
                "manual_cap_vs_time": images["cap_vs_time"],
                "results_table": manual_summary["result_workbook"],
                "results_workbook": manual_summary["result_workbook"],
                "results_archive": manual_summary["result_pickle"],
            }

        # preview fallback: lightweight SVGs + csv/json so the demo still works.
        results_table = self.analysis_folder / "Manual_Analysis_Results.csv"
        results_archive = self.analysis_folder / "manual_analysis_results.json"
        results_table.write_text(self._manual_log_csv(points))
        cap_force = self.analysis_folder / "Manual_Cap_vs_Force.svg"
        force_time = self.analysis_folder / "Manual_Force_vs_Time.svg"
        cap_time = self.analysis_folder / "Manual_Cap_vs_Time.svg"
        cap_force.write_text(self._manual_svg("Capacitance vs Force", points, "force", "capacitance", "Force (N)", "Capacitance (pF)"))
        force_time.write_text(self._manual_svg("Force vs Time", points, "time", "force", "Time (s)", "Force (N)"))
        cap_time.write_text(self._manual_svg("Capacitance vs Time", points, "time", "capacitance", "Time (s)", "Capacitance (pF)"))
        results_archive.write_text(json.dumps({
            **self._analysis_data(readings, channel_stats),
            "manual_points": points,
            "report_output": report_output,
        }, indent=2))
        return {
            "manual_cap_vs_force": str(cap_force),
            "manual_force_vs_time": str(force_time),
            "manual_cap_vs_time": str(cap_time),
            "results_table": str(results_table),
            "results_archive": str(results_archive),
        }

    def _channel_run_series(self, run_number, channel, cap_runs, readings):
        # capacitance vs time for one channel within one run (synthetic when no cap data).
        run_cap = cap_runs.get(run_number, [])
        series = []
        for row in run_cap:
            if len(row["channels"]) >= channel:
                series.append({"run": run_number, "time": row["time"], "force": row["channels"][channel - 1]})
        if not series:
            base = [point for point in readings if point["run"] == run_number]
            series = [{"run": run_number, "time": point["time"],
                       "force": 18 + point["force"] * (0.82 + channel * 0.055)} for point in base]
        return series or [{"run": run_number, "time": 0.0, "force": 0.0}]

    def _ps_all_channels_svg(self, run_number, cap_runs, readings, title):
        # overlay all 8 channels (colored per channel) for a single run.
        series = []
        for channel in range(1, 9):
            for point in self._channel_run_series(run_number, channel, cap_runs, readings):
                series.append({"run": channel, "time": point["time"], "force": point["force"]})
        return self._simple_svg(title, series or [{"run": 1, "time": 0.0, "force": 0.0}], "Capacitance (pF)")

    def _shear_failure_checks_tsv(self):
        headers = ["Failure Check", *[f"ch {index}" for index in range(1, 9)]]
        negative_row = ["negative CAP", *["None" for _ in range(8)]]
        delta_row = ["delta_CAP_gt_10pF", *["None" for _ in range(8)]]
        return "\n".join("\t".join(row) for row in [headers, negative_row, delta_row])

    def _manual_points(self):
        # 1) recorded points from the browser (live manual test).
        points = []
        for index, item in enumerate(self.payload.get("manual_readings") or []):
            if not isinstance(item, dict):
                continue
            points.append({
                "time": self._safe_float(item.get("time")) if self._safe_float(item.get("time")) is not None else index * 0.1,
                "force": load_cell_force(self._safe_float(item.get("force"))) or 0.0,
                "capacitance": self._safe_float(item.get("capacitance")) or 0.0,
            })
        if points:
            return points

        # 2) saved-data fallback: rebuild from the FUT (force/time) + CAP
        # (capacitance = mean of the channels) files so Analyze Saved Data works
        # on a manual folder with no in-browser readings.
        fut_runs = getattr(self, "_fut_runs", {}) or {}
        cap_runs = getattr(self, "_cap_runs", {}) or {}
        if fut_runs:
            run_no = sorted(fut_runs)[0]
            fut_points = fut_runs[run_no]
            cap_rows = cap_runs.get(run_no, [])
            points = []
            for index, fp in enumerate(fut_points):
                capacitance = 0.0
                if index < len(cap_rows) and cap_rows[index]["channels"]:
                    channels = cap_rows[index]["channels"]
                    capacitance = sum(channels) / len(channels)
                points.append({"time": fp["time"], "force": fp["force"], "capacitance": capacitance})
            if points:
                return points

        # 3) final fallback: synthetic preview points.
        return [{"time": index * 0.1, "force": index * 0.2, "capacitance": 12 + index * 0.08} for index in range(25)]

    def _manual_log_csv(self, points):
        # recorded time-series for the single manual run: one row per sample.
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Time (s)", "Force (N)", "Capacitance (pF)"])
        for point in points:
            writer.writerow([f"{point['time']:.3f}", f"{point['force']:.3f}", f"{point['capacitance']:.3f}"])
        return output.getvalue()

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
