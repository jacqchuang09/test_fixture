// Generator for the GUI Test Fixture documentation set (consolidated to 6 docs).
// Nunito, 8.5pt body, 1.15 line spacing, colored headers, tables.
// Edit the STYLE constants once to restyle everything, then re-run.
//
//   node build_gui_docs.js
//
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, HeadingLevel, LineRuleType, VerticalAlign,
} = require("docx");

// ---- style knobs ----
const FONT = "Nunito";
const MONO = "Courier New";
const BODY = 17;   // 8.5pt
const H1SZ = 32;   // 16pt
const H2SZ = 24;   // 12pt (part)
const H3SZ = 20;   // 10pt (sub-section)
const LINE = 276;  // 1.15x
const INK = "1F2933", H1C = "1F3A56", BLUE = "2F6FE0", H3C = "31507A", MUTE = "697790";
const GREEN = "2E875B", AMBER = "B0560F", RED = "C5423C";
const CELLBORDER = "D7DEE9", CODEBG = "F2F3F5";
const OUT_DIR = path.join(process.env.HOME, "Downloads", "GUI_Test_Fixture_Docs_docx");

const sp = (after = 80, before = 0) => ({ line: LINE, lineRule: LineRuleType.AUTO, after, before });
const border = { style: BorderStyle.SINGLE, size: 4, color: CELLBORDER };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 40, bottom: 40, left: 90, right: 90 };

// ---- block helpers ----
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: sp(40, 0), children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: sp(60, 200), children: [new TextRun(t)] });
const H2P = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true, spacing: sp(60, 60), children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: sp(30, 120), children: [new TextRun(t)] });
function runs(text) {
  const arr = Array.isArray(text) ? text : [{ t: text }];
  return arr.map((r) => new TextRun({ text: r.t, bold: !!r.b, italics: !!r.i, color: r.color || INK, font: r.mono ? MONO : FONT, size: r.mono ? 16 : BODY }));
}
const P = (text, after = 80) => new Paragraph({ spacing: sp(after), children: runs(text) });
const SUB = (t) => new Paragraph({ spacing: sp(120), children: [new TextRun({ text: t, color: MUTE, font: FONT, size: BODY })] });
const NOTE = (t) => new Paragraph({ spacing: sp(80), children: [new TextRun({ text: t, italics: true, color: MUTE, font: FONT, size: BODY })] });
const CODE = (lines) => lines.map((ln, i) => new Paragraph({
  shading: { type: ShadingType.CLEAR, fill: CODEBG },
  spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: i === lines.length - 1 ? 100 : 0, before: i === 0 ? 40 : 0 },
  indent: { left: 80, right: 80 },
  children: [new TextRun({ text: ln === "" ? " " : ln, font: MONO, size: 16, color: "1A1A1A" })],
}));
const SHADE = (text, fill, lineColor) => new Paragraph({
  shading: { type: ShadingType.CLEAR, fill }, spacing: sp(80),
  indent: { left: 80, right: 80 },
  children: runs(text),
});
function TABLE(headers, rows, colW, boldFirst = true) {
  const headRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => new TableCell({
    width: { size: colW[i], type: WidthType.DXA }, borders, margins: cellMargins, shading: { type: ShadingType.CLEAR, fill: BLUE }, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 0 }, children: [new TextRun({ text: h, bold: true, color: "FFFFFF", font: FONT, size: BODY })] })],
  })) });
  const bodyRows = rows.map((r) => new TableRow({ children: r.map((c, i) => {
    const cell = typeof c === "string" ? { t: c } : c;
    const bold = cell.b !== undefined ? cell.b : (i === 0 && boldFirst);
    return new TableCell({ width: { size: colW[i], type: WidthType.DXA }, borders, margins: cellMargins, verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 0 }, children: [new TextRun({ text: cell.t, bold, color: cell.color || INK, font: FONT, size: BODY })] })] });
  }) }));
  return new Table({ width: { size: colW.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: colW, rows: [headRow, ...bodyRows] });
}

// ============================================================ CONTENT (6 docs)
const DOCS = [];
const doc = (name, blocks) => DOCS.push({ name, blocks: blocks.flat() });

// ---- 1. PROJECT OVERVIEW (scope/goals + release notes/versioning) ----
doc("1 - Project Overview", [
  H1("Project Overview"), SUB("EM Test Fixture GUI"),
  H2("Scope and goals"),
  H3("Purpose"),
  P([{ t: "A single browser-based desktop application an operator uses at the bench to run the sensor team's mechanical tests. It drives a precision Zaber actuator into a sensor while reading a FUTEK load cell, with every test, safety check, and result in one window. Control is " }, { t: "closed-loop", b: true }, { t: ": the GUI moves the actuator based on the live force reading, not a fixed script." }]),
  H3("Mission"),
  P("Provide a unified platform for configuring, executing, monitoring, and analyzing sensor characterization tests while maintaining ease of use, operator safety, data integrity, and workflow efficiency."),
  H3("Goals"),
  TABLE(["Goal", "What it means"], [
    ["Intuitive UX", "Easy to learn and operate with minimal training."],
    ["Safe hardware operation", "Reduce the risk of accidental misuse or unsafe actuator movement."],
    ["Data integrity", "Every test organized, reproducible, and tied to a sensor and configuration."],
    ["Efficient workflows", "Minimize repetitive actions and streamline characterization."],
    ["Clear monitoring", "Test progress and system status understandable in real time."],
    ["Flexible testing", "Support EM, Shear, Manual, and Cyclical/Fatigue modes."],
    ["Extensibility", "New methods and tools can be added without major redesign."],
    ["Maintainability", "Organized so future developers can understand and extend it."],
  ], [2900, 6460]),
  H3("In and out of scope"),
  P([{ t: "In scope: ", b: true }, { t: "five test workflows (EM, Calibration/Fuji, Manual, Shear, Fatigue); live force monitoring, safety stops, run management (auto-runs, pause/stop, no-overwrite redo); per-test analysis and saved outputs; packaged as a double-click app on Mac and Windows." }]),
  P([{ t: "Out of scope (this version): ", b: true }, { t: "automated pass/fail grading; Eco Blox tracking beyond EM (proposed); a custom waveform builder in the live app (mockup only); remote/networked operation." }]),
  H3("Success criteria"),
  P("Every test type runs end to end on real hardware; all safety behaviors verified on the rig with fault injection; the formal test plan executed with results recorded; the user-story tracker reconciled to the shipped code."),
  H2P("Release notes (v1.0)"),
  P([{ t: "What v1.0 is: ", b: true }, { t: "the first complete, packaged version, a double-click desktop app that runs all five sensor tests at the bench with live monitoring, safety stops, run management, and per-test analysis." }]),
  P([{ t: "Included: ", b: true }, { t: "five test workflows; closed-loop control at 100 Hz with a live force graph; safety (force ceiling 33 N, speed-scaled spike check, travel limits, disconnect handling with auto re-home, snap-to limits, single-owner load-cell reader); run management (auto-runs, immediate pause/stop, no-overwrite redo); per-test analysis (SVG figures, Excel workbook, JSON/pickle, interactive Plotly HTML) plus Analyze Saved Data; expanded fatigue waveforms (sine, square, triangle, sawtooth, blood-pressure pulse); packaged for Mac and Windows." }]),
  P([{ t: "Known limitations: ", b: true, color: AMBER }, { t: "force input cap is 32 N vs the 22.2 N load-cell rating; the fatigue too-fast warning uses a placeholder slew limit (60 N/s); Eco Blox tracking is EM-only; formal test execution and on-rig safety verification still in progress." }]),
  P([{ t: "Build reference: ", b: true }, { t: "corresponds to the GUI Updates Log through v0.68. Archive the exact built app alongside this note." }]),
  H3("Versioning plan"),
  TABLE(["Part", "Meaning"], [
    ["MAJOR (v1.0)", "a release milestone"], ["MINOR (v1.1)", "new features or notable changes"],
    ["PATCH (v1.0.1)", "bug fixes only"], ["beta (v1.1-beta.1)", "pre-release builds"],
  ], [2600, 6760]),
  P([{ t: "How the log feeds releases: ", b: true }, { t: "keep logging every change in the GUI Updates Log; at each release, roll the relevant entries into human-readable release notes; tag the build and archive the distributable with its version." }]),
  H3("Release checklist (per version)"),
  P("1. All Must-priority cases pass.   2. Safety cases pass on the rig.   3. Known issues updated.   4. Version bumped, app rebuilt on both platforms, archived.   5. Release notes written and shared."),
  NOTE("Owner: Jacqueline Chuang. Status: MVP complete; formal verification in progress."),
]);

// ---- 2. OPERATOR GUIDE (quick start + user manual + troubleshooting + training) ----
doc("2 - Operator Guide", [
  H1("Operator Guide"), SUB("EM Test Fixture GUI"),
  H2("First run (quick start)"),
  P("1. Mount the sensor and block; power on the Zaber actuator and FUTEK load cell.   2. Open the app (double-click) and pick the Zaber COM/serial port; with no hardware it runs in simulation.   3. Fill Save Folder, Sensor Type, and Sensor ID, then click Verify.   4. For an EM test, set runs (start with 3) and surface area, then Start.   5. Open the analysis tabs when it finishes."),
  H2P("Using the app"),
  H3("What it does"),
  P([{ t: "Runs the sensor team's mechanical tests at the bench, driving a Zaber actuator into a sensor while reading a FUTEK load cell, with every test, safety check, and result in one window. Five test types: " }, { t: "EM, Calibration/Fuji, Manual, Shear, Fatigue.", b: true }]),
  H3("Basic settings (main page)"),
  P([{ t: "Save Folder", b: true }, { t: " (missing folders are created), " }, { t: "Sensor Type", b: true }, { t: " (Standard/Inverted), " }, { t: "Sensor ID", b: true }, { t: " (segmented or custom). Click " }, { t: "Verify", b: true }, { t: "; if anything is missing or malformed the app blocks you and names what to fix." }]),
  H3("Running each test"),
  TABLE(["Test", "How to run it"], [
    ["EM", "set runs (1-10) and surface area; Start. It homes, approaches, and auto-runs the presses, pausing between so you can reset the sensor."],
    ["Calibration/Fuji", "set extrusion distance (up to 12 mm); fine-jog to nudge; a good press stops near 20 N."],
    ["Manual", "move by distance, or drive to a target force (press and release). Force records continuously; graph view editable mid-move, motion stays locked."],
    ["Shear", "load-cell-only: it records while you apply force by hand; flags shorted channels."],
    ["Fatigue", "pick a waveform; set lower/upper force, frequency, cycles. Preview shows one cycle and estimates the length; Start."],
  ], [1900, 7460]),
  H3("Results, analysis, and run management"),
  P([{ t: "Open the analysis tabs after a run, or use " }, { t: "Analyze Saved Data", b: true }, { t: " on an existing folder. Each folder holds an interactive plot you can zoom and annotate offline. Pause and Stop take effect immediately. " }, { t: "Redo never destroys data", b: true }, { t: ": it creates a new run number that supersedes the old one, with a reason." }]),
  H3("Safety, what the app does on its own"),
  P([{ t: "Stops and homes on the 33 N force ceiling, a sudden force jump (metal contact), or the travel limit. Stops safely on a disconnect and re-homes on reconnect. " }, { t: "The motion and run buttons move a real actuator into a load cell; never click them casually.", b: true, color: RED }]),
  NOTE("Screenshots to be added: main page, each test window, an analysis tab."),
  H2P("Troubleshooting and known issues"),
  TABLE(["Symptom", "Fix"], [
    ["Zaber will not connect", "check cable/power, pick the right port. The app reports the real reason (port in use, no device, missing driver). On Windows, confirm the driver."],
    ["Load cell reads simulated/zero", "confirm FUTEK is powered/connected. The driver is Windows-only; on Mac a mock is expected."],
    ["App opens in simulation", "wrong interpreter (no scientific stack) or missing driver. Use the build with numpy/scipy/matplotlib and pythonnet."],
    ["Old page after an update", "hard reload (Cmd+Shift+R) or reopen."],
    ["A test will not start", "read the message: blank save folder, invalid Sensor ID, or upper-not-greater-than-lower all block Start by design."],
    ["Move is blocked", "the target is outside 17 to 50.8 mm, or would exceed a limit. Intended."],
  ], [2700, 6660]),
  H3("Known issues / open items"),
  P([{ t: "Force input cap 32 N vs the 22.2 N load-cell rating; ", color: AMBER }, { t: "fatigue slew warning uses a 60 N/s placeholder; ", color: AMBER }, { t: "Eco Blox tracking is EM-only. ", color: AMBER }, { t: "Windows .exe must be built on Windows; fatigue folders are intentionally not analyzed by Analyze Saved Data." }]),
  H2P("Training protocol"),
  P([{ t: "Goal: ", b: true }, { t: "bring a new operator to running tests safely and unaided. Use as a checklist; trainee signs off at the end." }]),
  H3("Part 1: orientation"),
  P("The hardware (Zaber, FUTEK, fixture, home vs travel); the five test types; the safety behaviors and why they exist; the golden rule that motion/run buttons move a real actuator into a load cell."),
  H3("Part 2: guided run (trainer drives)"),
  P("Set basic settings and Verify; trigger a validation error on purpose. Run a 3-run EM test in sim, then on the rig. Pause and Stop mid-run. Read the analysis tabs."),
  H3("Part 3: hands-on (trainee drives)"),
  P("Full EM test on the rig to analysis; a Manual move-to-force; a Fatigue setup (waveform, bounds, frequency, read the preview, do not run a long fatigue unless instructed); a redo with a reason."),
  H3("Part 4: safety drills"),
  P("Force ceiling (confirm stop and home); disconnect (unplug mid-run, confirm safe stop and re-home); out-of-range input (confirm snap-to clamps and names the limit)."),
  H3("Sign-off"),
  P("Can run all five tests safely and unaided: yes / no.   Understands the safety behaviors: yes / no.   Trainee ______  Trainer ______  Date ______"),
]);

// ---- 3. TECHNICAL REFERENCE (limits/hardware + data/folders) ----
doc("3 - Technical Reference", [
  H1("Technical Reference"), SUB("EM Test Fixture GUI"),
  H2("Limits, bounds, and hardware specs"),
  P([{ t: "Snap-to: ", b: true }, { t: "a field rounds to its precision and clamps into range on commit; the message names the limit hit." }]),
  H3("Operator inputs (snap into range on commit)"),
  TABLE(["Field", "Range", "Notes"], [
    ["Manual position", "17 to 50.8 mm", "out-of-range moves are blocked"],
    ["Target force (manual)", "0 to 32 N", "safety stop near the ceiling"],
    ["Increment distance", "0.1 to 12 mm", "manual and Fuji"],
    ["Actuator speed", "0.01 to 2 mm/s", "well below the 25 mm/s hardware max"],
    ["Fatigue force bounds", "0 to 32 N, whole", "upper must exceed lower"],
    ["Fatigue frequency", "0.1 to 5 Hz; square 0.1 to 1 Hz", "a true square wave holds only up to ~0.25 Hz (see below)"],
    ["EM runs", "1 to 10", "surface area: any positive number"],
  ], [2700, 2300, 4360]),
  H3("Fixed physical and safety limits"),
  TABLE(["Item", "Value", "Behavior"], [
    ["Travel range", "17 to 50.8 mm", "stops, homes, dialog if reached"],
    ["Force ceiling (safety)", "33 N", "press stops immediately and homes; data not saved"],
    ["Actuator peak thrust", "25 N", "hardware max; lead screw stalls beyond"],
    ["EM / Fuji target", "32 N / 20 N", "where a good press stops, not limits"],
    ["Lost connection", "-", "safe stop without homing; auto re-home on reconnect"],
    ["Force sample rate", "100 Hz", "one reading every 10 ms"],
  ], [2700, 1700, 4960]),
  H3("Sudden-jump (spike) check, scaled by speed"),
  TABLE(["Speed", "Threshold", "Sensor contact", "Metal hit"], [
    ["0.05 mm/s", "1.5 N", "0.005 to 0.24 N (no)", "4.4 N (trips)"],
    ["1.0 mm/s", "20 N", "0.09 to 4.7 N (no)", "87 N (trips)"],
    ["2.0 mm/s", "40 N", "0.18 to 9.5 N (no)", "174 N (trips)"],
    ["25 mm/s", "500 N", "2.3 to 118 N (no)", "2175 N (trips)"],
  ], [1700, 1700, 3160, 2800], false),
  H3("Hardware"),
  P([{ t: "Zaber X-NA08A50-E09: ", b: true }, { t: "travel 50.8 mm; max speed 25 mm/s; peak thrust 25 N (5.6 lb); NEMA 08 lead-screw drive, 1/64 microstep." }]),
  P([{ t: "FUTEK LCM100 (5 lb): ", b: true }, { t: "rated 22.2 N; safe overload 33.3 N (150 percent); stiffness about 8,700 N/mm; 17-4 PH stainless steel." }]),
  P([{ t: "OPEN ITEM: ", b: true, color: AMBER }, { t: "force input fields cap at 32 N in code, while the load cell is rated 22.2 N. Decide whether to tighten the cap toward the load-cell rating.", color: AMBER }]),
  H2("Fatigue square-wave frequency limit"),
  P("A fatigue square wave presses the actuator between the lower and upper force and back. The rod cannot move infinitely fast, so above a certain frequency the press never holds a flat between edges - it rounds into a triangle, then can no longer even reach its bounds. A frequency sweep on the rig (tools/zaber_square_wave_characterization.py) measures exactly where that happens for this build."),
  H3("How squareness is measured"),
  P([{ t: "Flat-hold (the decider): ", b: true }, { t: "the fraction of each half-cycle the actuator actually sits at the commanded level. A true square holds most of it; a triangle holds almost none. A frequency counts as a usable square while flat-hold is at least 50 percent and the wave still reaches its bounds." }]),
  P([{ t: "Deviation (context only): ", b: true }, { t: "RMS error from the ideal step. It stays high (50 to 125 percent) at every frequency because a square always has an unavoidable slew edge, so it does not by itself pick the limit." }]),
  H3("Measured result (rig sweep, 1 mm swing at the sensor)"),
  TABLE(["Frequency", "Flat-hold", "Reaches bounds", "Shape"], [
    [{ t: "<= 0.25 Hz", b: true, color: GREEN }, { t: "50 to 81%", color: GREEN }, { t: "yes (100%)", color: GREEN }, { t: "square - holds a flat", color: GREEN }],
    [{ t: "0.3 to 0.45 Hz", b: true, color: AMBER }, { t: "13 to 42%", color: AMBER }, { t: "yes (100%)", color: AMBER }, { t: "rounding into a triangle", color: AMBER }],
    [{ t: "0.5 Hz", b: true, color: AMBER }, { t: "~1%", color: AMBER }, { t: "barely (98%)", color: AMBER }, { t: "triangle - no flat", color: AMBER }],
    [{ t: ">= 0.75 Hz", b: true, color: RED }, { t: "0%", color: RED }, { t: "no (60 to 46%)", color: RED }, { t: "cannot reach amplitude", color: RED }],
  ], [1900, 1500, 1900, 4060], false),
  P([{ t: "Why: ", b: true }, { t: "the actuator slews a 2 mm swing in about 1 second (roughly 1.5 to 2 mm/s effective, with settling) and lags the command by about 165 ms. A flat only survives while each half-cycle is longer than about twice the slew, i.e. at or below ~0.25 Hz. By 0.5 Hz the half-cycle equals the slew (a pure triangle); above ~0.5 Hz it cannot even reach the bounds." }]),
  NOTE("Paste characterization_curve.svg (flat-hold + amplitude fidelity + deviation + lag vs frequency, usable limit marked) below this note."),
  H3("Why so much lower than the speed-only estimate"),
  P("A naive speed limit (run speed divided by 4 and by the travel per swing) predicts a few hertz, but it assumes the rod reaches full speed instantly. In reality the edges are limited by acceleration, command and serial latency, and settling, which dominate the short travels of a square wave - so the measured square-wave limit lands far below the naive ceiling."),
  H3("Recommended limit"),
  P([{ t: "The frequency field accepts " }, { t: "0.1 to 5 Hz for sine and the other waveforms, and 0.1 to 1 Hz for a square wave", b: true }, { t: ". For a faithful square wave, keep it at or below " }, { t: "0.25 Hz", b: true, color: GREEN }, { t: "; above that the shape degrades to a rounded triangle, and above ~0.5 Hz it no longer reaches its bounds." }]),
  SHADE([{ t: "Tradeoff: ", b: true }, { t: "at 0.25 Hz the default 28,800-cycle test runs about 32 hours (and longer below it). If a true square is required, keep <= 0.25 Hz and reduce the cycle count or accept the duration. If only the cycling matters (a rounded shape is acceptable), a higher frequency up to 1 Hz - or a sine / triangle waveform, which the actuator tracks better - is fine." }], "FBF4E6"),
  P([{ t: "OPEN ITEM: ", b: true, color: AMBER }, { t: "confirm with the sensor team whether the fatigue test needs a true square (=> keep <= 0.25 Hz) or tolerates a rounded cycle (=> up to the 1 Hz field max).", color: AMBER }]),
  H2P("Data and folder structure"),
  H3("Test folder naming"),
  ...CODE(["<save_folder>/<MM DD YY>_<area>mm2_<TEST>/"]),
  P([{ t: "TEST", b: true }, { t: " is one of EM, Shear, Manual, Fatigue. Analyze Saved Data validates this pattern; the backend refuses to fabricate results for a non-matching folder." }]),
  H3("Outputs by test type"),
  TABLE(["Test", "Key outputs"], [
    ["EM", "Raw Signal/Run N/ (CH1-8); PS Curve/ (with inflection); EB_Analysis_Results.xlsx; Analysis_Plots.html; eb_analysis_results.json and .pkl"],
    ["Shear", "per-channel CAP and delta-CAP figure; shorted-channel detection; results workbook + archive"],
    ["Manual", "three figures (Cap-Force, Force-Time, Cap-Time); recorded data log (Time, Force, Capacitance); results + archive"],
    ["Fatigue", "Fatigue_Data.xlsx; a force-waveform summary figure"],
  ], [1500, 7860]),
  H3("Run log, formats, and identification"),
  P([{ t: "Each folder holds " }, { t: "run_log.json", b: true }, { t: " (runs + redos; a redo supersedes with a new run number, never overwrites). Figures are SVG; text files are UTF-8; FUT runs are .xlsx or .csv, CAP files .csv. Each test ties to a Sensor ID (segmented or custom); the Eco Blox ID is recorded in the EM report." }]),
  P([{ t: "Open item: ", b: true, color: AMBER }, { t: "confirm exact subfolder names against the current analysis code before publishing as authoritative.", color: AMBER }]),
]);

// ---- 4. DEVELOPER GUIDE (architecture + setup/build + API + hardware integration) ----
doc("4 - Developer Guide", [
  H1("Developer Guide"), SUB("EM Test Fixture GUI  |  See also the Code Walkthrough doc for a file-by-file tour."),
  H2("Architecture"),
  P([{ t: "A browser GUI talks to a tiny local Python server. The front end is plain HTML/CSS/JS (no framework, one file per tab). Click Start, the browser POSTs JSON; the server runs the test on a " }, { t: "background thread", b: true }, { t: "; the engine drives the Zaber and reads the FUTEK; the browser polls a status endpoint ~10x/sec to draw the live graph. The same code runs in simulation and on the real rig." }]),
  TABLE(["Layer", "What it is"], [
    ["Front end (web_preview/)", "index.html, styles.css (:root design system), js/ one file per tab plus shared.js and main.js. JSON POST; polls /api/run-status."],
    ["Server + engine", "server.py (endpoints), run_engine.py (ENGINE singleton, one thread per test), the single-owner load-cell reader, run_log.py, config.py."],
    ["Hardware drivers", "zaber_cli.py (serial via zaber_motion), futek_cli.py (.NET via pythonnet, Windows; a mock on Mac)."],
  ], [2700, 6660]),
  P([{ t: "Single-owner reader: ", b: true }, { t: "exactly one thread owns the FUTEK and reads ~100 Hz into a shared value; everything else reads the cached value, so two simultaneous device reads (which corrupted the driver) are impossible. " }, { t: "Safety cutoffs run on the raw backend sample stream, never on the displayed graph.", b: true }]),
  H2P("Setup and build"),
  P([{ t: "Repository: ", b: true }, { t: "web_preview/ (front end + backend + analysis modules), zaber_cli.py / futek_cli.py (drivers), app_desktop.py / app_desktop.spec (desktop wrapper + build), libs/windows/ (FUTEK DLLs), test_plan/, docs/." }]),
  H3("Run it in development"),
  ...CODE(["python3 -u web_preview/run_web_gui.py"]),
  P("Prints a local URL (about http://127.0.0.1:8765/index.html). Always serve through this backend; do not open the file directly. Or run the desktop app: python3 app_desktop.py."),
  H3("Dependencies"),
  P([{ t: "Python scientific stack (numpy, scipy, pandas, matplotlib); pywebview; " }, { t: "pythonnet==3.0.3", b: true }, { t: " (pinned) for the FUTEK driver on Windows; zaber_motion. Point your editor at the interpreter that has these, or the app silently drops into preview mode." }]),
  H3("Build the desktop app"),
  ...CODE(["python3 -m PyInstaller app_desktop.spec --noconfirm"]),
  P([{ t: "Output: dist/ZaberGUI.app (Mac), dist/ZaberGUI/ZaberGUI.exe (Windows). Windows builds must be done on Windows (build_windows.bat). " }, { t: "Rebuild the app after any code change.", b: true }]),
  H2P("API and endpoint reference"),
  P("The front end talks to server.py over JSON POST (GET for status/files). Confirm exact field names against server.py before publishing as authoritative."),
  TABLE(["Endpoint", "Method", "Purpose"], [
    [{ t: "/api/verify", color: "1A1A1A" }, "POST", "validate basic settings (save folder, sensor type, Sensor ID)"],
    [{ t: "/api/check-existing", color: "1A1A1A" }, "POST", "check whether a folder/version exists (no-overwrite flow)"],
    [{ t: "/api/list-ports", color: "1A1A1A" }, "GET", "list serial ports for the Zaber"],
    [{ t: "/api/start-run", color: "1A1A1A" }, "POST", "start an EM run"],
    [{ t: "/api/start-cyclical", color: "1A1A1A" }, "POST", "start a fatigue run (waveform, bounds, frequency, cycles)"],
    [{ t: "/api/start-shear", color: "1A1A1A" }, "POST", "start a shear capture"],
    [{ t: "/api/fuji-film", color: "1A1A1A" }, "POST", "run the Fuji/calibration press"],
    [{ t: "/api/move", color: "1A1A1A" }, "POST", "move by distance or to a position (17 to 50.8 mm)"],
    [{ t: "/api/move-to-force", color: "1A1A1A" }, "POST", "drive until the load cell reads a target force"],
    [{ t: "/api/read-force", color: "1A1A1A" }, "GET", "read the current force"],
    [{ t: "/api/run-status", color: "1A1A1A" }, "GET", "the polled status (status, force, position, samples, cycle, trace, flags)"],
    [{ t: "/api/perform-analysis", color: "1A1A1A" }, "POST", "run analysis; writes figures, workbook, JSON/pickle, HTML"],
    [{ t: "/plot-file", color: "1A1A1A" }, "GET", "serve a saved figure to the analysis tabs"],
  ], [2400, 1100, 5860]),
  NOTE("Removed: /api/analyze-sample. To finish: record exact request fields, response shape, and an example per endpoint from server.py."),
  H2P("Hardware integration"),
  P([{ t: "Zaber X-NA08A50-E09", b: true }, { t: " over serial (zaber_cli.py: connect/disconnect, auto-detect ports, falls back to a simulated stage). " }, { t: "FUTEK LCM100", b: true }, { t: " over .NET (futek_cli.py, Windows; DLLs in libs/windows/; pythonnet pinned 3.0.3; mock on Mac). simulated = (axis is None) or (futek is None)." }]),
  SHADE([{ t: "Single-owner reader: one thread owns the FUTEK; everything else reads the cached value. The .NET driver cannot be read by two threads at once. " }, { t: "Do not add a second direct reader.", b: true }], "FFF4E2", "F0CF96"),
  H3("Adding a new instrument"),
  P("1. Write a driver with connect/read/disconnect.   2. Wire it in behind the simulated-or-real check.   3. If read continuously, use a single-owner reader.   4. Add limits + safety checks.   5. Bundle native libraries via app_desktop.spec."),
]);

// ---- 5. TEST PLAN AND VERIFICATION (plan + execution + safety + traceability) ----
doc("5 - Test Plan and Verification", [
  H1("Test Plan and Verification"), SUB("EM Test Fixture GUI"),
  H2("Master test plan"),
  P("How the GUI is verified before release. The detailed EM cases exist (45 in test_plan/EM_Test_Cases.csv); this is the umbrella and the to-do for the other test types."),
  H3("Categories (every test type)"),
  TABLE(["Category", "Proves"], [
    ["Functional", "the happy path produces the expected behavior and outputs"],
    ["Negative", "bad or missing inputs are caught and the test is blocked"],
    ["Interruption", "pause, stop, disconnect, travel-limit events behave safely"],
    ["Boundary", "min, max, and snap-to limits behave correctly"],
    ["Journey", "realistic multi-step operator sequences work end to end"],
  ], [2200, 7160]),
  H3("Status by test type"),
  TABLE(["Test", "Status", "Scope"], [
    ["EM", { t: "Done", b: true, color: GREEN }, "45 cases across the five categories"],
    ["Shear", { t: "To do", color: AMBER }, "load-cell capture, shorted-channel detection, analysis"],
    ["Manual", { t: "To do", color: AMBER }, "move-by-distance, move-to-force, continuous logging"],
    ["Fatigue", { t: "To do", color: AMBER }, "each waveform, limits, spike protection, cycle count"],
    ["Calibration/Fuji", { t: "To do", color: AMBER }, "extrusion limit (12 mm), jog, target stop at 20 N"],
  ], [2200, 1500, 5660]),
  P([{ t: "Cross-cutting (run once): ", b: true }, { t: "verify-flow messages match the user stories; snap-to clamps and names the limit; run management; safety; packaging on Mac and Windows. " }, { t: "Entry: ", b: true }, { t: "build identified, hardware connected, known-good sensor/block. " }, { t: "Exit: ", b: true }, { t: "every Must-priority case passes, all safety cases pass on the rig, open defects logged." }]),
  H2P("Test execution report (template)"),
  P([{ t: "Build / version: ", b: true }, { t: "______   " }, { t: "Date: ", b: true }, { t: "______   " }, { t: "Tester: ", b: true }, { t: "______   " }, { t: "Mode: ", b: true }, { t: "simulation / real rig" }]),
  TABLE(["Case ID", "Type", "Category", "Title", "Expected", "Result", "Evidence", "Defect"], [
    ["EM-F-01", "EM", "Functional", "3-run press, per-channel stats", "stats + figures saved", "", "", ""],
    ["SAFE-02", "Cross", "Interruption", "force ceiling stops + homes", "stops at 33 N, homes, dialog", "", "", ""],
  ], [1100, 760, 1300, 1900, 1900, 900, 900, 600], false),
  P("Summary: Total ___  Passed ___  Failed ___  Blocked ___  Must-priority pass rate ___  Safety cases on rig ___ of ___.   Sign-off: tester ______ reviewer ______ date ______"),
  H2P("Safety verification report (template)"),
  P([{ t: "Proven " }, { t: "on the real rig", b: true }, { t: " with deliberate fault injection. Simulation is not sufficient for sign-off here. Build ______  Date ______  Tester/witness ______" }]),
  TABLE(["Safety case", "Method", "Expected", "Result / Evidence"], [
    ["Force ceiling (33 N)", "press into a stiff target toward 33 N", "stops immediately, homes, dialog; data not saved", ""],
    ["Sudden-jump check", "drive into a hard surface at a set speed", "trips at the speed-scaled threshold; soft contact does not", ""],
    ["Travel limit", "command a move to end of travel", "stops, homes, dialog; out-of-range moves blocked", ""],
    ["Zaber disconnect", "unplug actuator mid-run", "safe stop without homing; auto re-home on reconnect", ""],
    ["Load-cell disconnect", "interrupt FUTEK; exercise manual window during a test", "single-owner reader prevents corruption; no silent sim drop", ""],
    ["Snap-to limits", "enter out-of-range values", "clamps on commit; message names the limit hit", ""],
  ], [1900, 2500, 3360, 1600]),
  P("All safety cases passed on the rig: yes / no.   Tester ______ Witness ______ Date ______"),
  H2P("Requirements traceability matrix (template)"),
  P("One row per user story, linking it to where it is built and the test case that verifies it. Pull stories from the User Stories sheet; set Verified once the case has a Pass."),
  TABLE(["Story ID", "Title", "Priority", "Implemented In", "Test Case", "Verified"], [
    ["1.1.1", "Main Window", "must", "index.html", "UI-F-01", ""],
    ["1.1.2", "Save Folder Field", "must", "main.js, server verify", "BS-F-02", ""],
    ["1.x", "Sensor ID validation", "must", "main.js sensorBuilderError", "BS-N-04..09", ""],
  ], [1100, 2100, 1100, 2660, 1600, 800], false),
  P("Coverage: Stories ___  Implemented ___  Tested ___  Verified ___  Must coverage ___ percent.   Gaps (no test case): ______   Orphans (no story): ______"),
  NOTE("Keep Story IDs and Case IDs identical across the plan, the matrix, and the execution report."),
]);

// ---- 6. DESIGN CONCEPTS AND PROPOSALS ----
doc("6 - Design Concepts and Proposals", [
  H1("Design Concepts and Proposals"), SUB("EM Test Fixture GUI  |  Forward-looking ideas and mockups, not shipped features."),
  H2("Fatigue waveform builder (mockup)"),
  P([{ t: "A more flexible fatigue setup: pick a preset (sine, square, triangle, sawtooth, blood-pressure pulse) or type a custom equation, with live preview and a too-fast-to-track warning. Lower, Upper, Frequency, and Cycles always mean the same thing; the waveform only changes the shape between the bounds. Blood pressure exposes heart rate, dicrotic notch depth, and upstroke sharpness. A " }, { t: "safe parser", b: true }, { t: " handles custom equations (no eval; only math functions and the phase variable). " }, { t: "Status: ", b: true }, { t: "standalone HTML (fatigue_waveform_builder.html), not wired in; slew limit is a placeholder." }]),
  H2("Live-graph latency simulator (tool)"),
  P([{ t: "A standalone page modeling how far the live graph trails the real force. Typical ~60 ms (range 14 to 107 ms); streaming, not hard real time. " }, { t: "This is a model, not a measurement.", b: true }, { t: " For the real number, stamp a sample at acquisition (perf_counter) and at draw (performance.now), then report median and 95th percentile over a 30 to 60 s run. Safety cutoffs run on the raw backend stream, never on the graph." }]),
  H2("Measuring the actuator slew limit (next step)"),
  P([{ t: "The fatigue warning's limit is " }, { t: "block stiffness (N/mm) x max actuator speed (mm/s)", b: true }, { t: ". To get stiffness: slowly press into the block and log force vs position (the Manual window already records both), then take the slope (use the steepest part). The block dominates because it is far softer than the load cell. Multiply by max speed to replace the 60 N/s placeholder." }]),
  H2("Eco Blox usage tracking (proposal, pending Josh)"),
  P([{ t: "Block usage is recorded only for EM; Manual and Fatigue press the block too but record nothing. " }, { t: "Proposal: ", b: true }, { t: "add an Eco Blox ID field to Manual and Fatigue, and append every block test to one central tracker file. " }, { t: "Open decisions: ", b: true }, { t: "which tests (Shear/Fuji too?); what the count means for Manual/Fatigue (full cycle count or one session?); where the tally lives." }]),
  H2("Other extensibility ideas"),
  P("Automated pass/fail criteria; a sensor database integration; additional analysis metrics; showing the predicted-vs-achievable fatigue curve side by side."),
]);

// ============================================================ WRITE
const styles = {
  default: { document: { run: { font: FONT, size: BODY }, paragraph: { spacing: { line: LINE, lineRule: LineRuleType.AUTO, after: 80 } } } },
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: H1SZ, bold: true, font: FONT, color: H1C }, paragraph: { spacing: { before: 40, after: 60, line: LINE, lineRule: LineRuleType.AUTO }, outlineLevel: 0 } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: H2SZ, bold: true, font: FONT, color: BLUE }, paragraph: { spacing: { before: 200, after: 60, line: LINE, lineRule: LineRuleType.AUTO }, outlineLevel: 1 } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: H3SZ, bold: true, font: FONT, color: H3C }, paragraph: { spacing: { before: 120, after: 30, line: LINE, lineRule: LineRuleType.AUTO }, outlineLevel: 2 } },
  ],
};
const PAGE = { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } };

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
// clear old .docx so the folder reflects only the current set
fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".docx")).forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));
let pending = DOCS.length;
DOCS.forEach((d) => {
  const document = new Document({ styles, sections: [{ properties: { page: PAGE }, children: d.blocks }] });
  Packer.toBuffer(document).then((buf) => {
    fs.writeFileSync(path.join(OUT_DIR, d.name + ".docx"), buf);
    console.log("wrote", d.name + ".docx");
    if (--pending === 0) console.log("\nAll " + DOCS.length + " docs in:", OUT_DIR);
  });
});
