const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
        BorderStyle, ShadingType } = require("docx");

const ARIAL = "Arial";
const MONO = "Consolas";
const BODY = 17;     // 8.5pt (half-points)

// ---- helpers ----
const styles = {
  default: { document: { run: { font: ARIAL, size: BODY } } },
  paragraphStyles: [
    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal",
      run: { size: 40, bold: true, font: ARIAL },
      paragraph: { spacing: { after: 80 } } },
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 26, bold: true, font: ARIAL, color: "1F3A56" },
      paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 20, bold: true, font: ARIAL, color: "2F6FE0" },
      paragraph: { spacing: { before: 180, after: 70 }, outlineLevel: 1 } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 18, bold: true, font: ARIAL },
      paragraph: { spacing: { before: 120, after: 50 }, outlineLevel: 2 } },
  ],
};

const numbering = {
  config: [{ reference: "b", levels: [{ level: 0, format: "bullet", text: "•",
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] }],
};

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const TITLE = (t) => new Paragraph({ style: "Title", children: [new TextRun(t)] });

// paragraph: text may be a string or an array of {t, b, i} runs
function P(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text.map(r => new TextRun({ text: r.t, bold: r.b, italics: r.i, font: ARIAL, size: BODY }))
    : [new TextRun({ text, font: ARIAL, size: BODY })];
  return new Paragraph({ children: runs, spacing: { after: opts.after ?? 120, line: 250 } });
}
function BULL(text) {
  return new Paragraph({ numbering: { reference: "b", level: 0 },
    children: [new TextRun({ text, font: ARIAL, size: BODY })], spacing: { after: 50, line: 250 } });
}
// code block: array of lines -> shaded monospace paragraphs
function CODE(lines) {
  return lines.map((ln, i) => new Paragraph({
    children: [new TextRun({ text: ln === "" ? " " : ln, font: MONO, size: 16, color: "1A1A1A" })],
    shading: { type: ShadingType.CLEAR, fill: "F2F3F5" },
    spacing: { after: i === lines.length - 1 ? 140 : 0, before: i === 0 ? 60 : 0, line: 230 },
    indent: { left: 120, right: 120 },
  }));
}
function SMALL(text) {
  return new Paragraph({ children: [new TextRun({ text, font: ARIAL, size: 15, color: "6B7280", italics: true })],
    spacing: { after: 140, line: 240 } });
}

const PAGE = { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } };

function write(name, children) {
  const doc = new Document({ styles, numbering, sections: [{ properties: { page: PAGE }, children }] });
  Packer.toBuffer(doc).then(buf => { fs.writeFileSync(name, buf); console.log("wrote", name); });
}

// ============================================================ PROJECT GOALS (shared)
const GOALS_INTRO = "The EM Test Fixture GUI should provide a unified platform for configuring, executing, monitoring, and analyzing sensor characterization tests while maintaining ease of use, operator safety, data integrity, and workflow efficiency.";
const GOALS = [
  { title: "Goal 1: Intuitive User Experience",
    line: "The GUI should be easy to learn and operate with minimal training.",
    bullets: ["Testing workflows should follow a logical progression",
      "Related settings should be grouped together",
      "Important actions should be clearly labeled",
      "Informational tooltips should explain technical settings",
      "Users should be able to understand the current state of the test at all times"] },
  { title: "Goal 2: Safe Hardware Operation",
    line: "The GUI should reduce the risk of accidental hardware misuse or unsafe actuator movement.",
    bullets: ["User inputs should be validated before testing begins",
      "Hardware initialization should occur before motion commands",
      "Unsafe operations should be blocked",
      "Home / Reset functions should be easily accessible",
      "Clear status messages should indicate hardware state and errors"] },
  { title: "Goal 3: Data Integrity and Traceability",
    line: "All test data should be organized, reproducible, and traceable to a specific sensor and test configuration.",
    bullets: ["Each test should be associated with a Sensor ID",
      "Test outputs should be automatically saved",
      "Folder structures should be generated consistently",
      "Existing test data should be protected from accidental overwrites",
      "Analysis outputs should be linked to the originating test"] },
  { title: "Goal 4: Efficient Testing Workflows",
    line: "The GUI should minimize repetitive user actions and streamline sensor characterization.",
    bullets: ["Common settings should be remembered when appropriate",
      "Folder creation should be automated",
      "Test setup should require minimal manual configuration",
      "Existing test workflows should support reruns and versioning",
      "Analysis should be accessible directly from testing windows"] },
  { title: "Goal 5: Clear Test Monitoring",
    line: "Users should be able to understand test progress and system status in real time.",
    bullets: ["Active test status should be visible",
      "Graphs should update live when applicable",
      "Run progress should be clearly displayed",
      "Error conditions should be communicated immediately",
      "Analysis results should be presented in an organized manner"] },
  { title: "Goal 6: Flexible Sensor Characterization",
    line: "The platform should support multiple testing modes (EM, Shear, Manual, and Cyclical) while maintaining a consistent user experience.",
    bullets: ["Supported testing modes: EM Testing, Shear Testing, Manual Testing, Cyclical Testing",
      "Each testing mode should follow consistent navigation, status reporting, and data management principles"] },
  { title: "Goal 7: Extensibility",
    line: "The software should be designed so future testing methods and analysis tools can be added without major redesign.",
    bullets: ["Examples: additional waveform types",
      "Blood-pressure waveform simulation",
      "Automated pass / fail criteria",
      "Sensor database integration",
      "Additional analysis metrics",
      "Future hardware platforms"] },
  { title: "Goal 8: Maintainability",
    line: "The software should be organized so future developers can understand, modify, and extend the system.",
    bullets: ["Workflows should be clearly documented",
      "User stories should map directly to GUI functionality",
      "Validation logic should be consistent throughout the application",
      "Analysis outputs should be standardized across test types"] },
];

// one-sentence-each version for the walkthrough doc
const goalsBrief = [P(GOALS_INTRO)];
for (const g of GOALS) goalsBrief.push(P([{ t: g.title + ". ", b: true }, { t: g.line }]));

// full version (statement + bullets) for the speaker notes
const goalsFull = [P(GOALS_INTRO)];
for (const g of GOALS) {
  goalsFull.push(H3(g.title));
  goalsFull.push(P(g.line));
  for (const b of g.bullets) goalsFull.push(BULL(b));
}

// ============================================================ DOC 1: SPEAKER NOTES
const notes = [
  TITLE("Test Fixture GUI - Speaker Notes"),
  SMALL("Casual talking points, one block per slide. Read them like you'd say them. Times are rough."),

  H2("1 - Title"),
  P("Quick intro: this is the test fixture GUI I've been building. I'll walk through what it does, demo a couple of the test windows live, then get into how it's actually built and where things stand. Should be about ten minutes."),

  H2("2 - What it is"),
  P("Big picture: it's one app an operator runs at the bench. It drives a precision Zaber actuator into a sensor while reading a FUTEK load cell, and every test, every safety check, and the results all live in one window. The key idea is that it's closed-loop: the GUI moves the actuator based on the live force reading, not a fixed script."),

  H2("3 - Project goals"),
  P("Before the demos, the goals the GUI was built around. The line up top is the mission: a platform to configure, run, monitor, and analyze sensor tests without giving up ease of use, safety, data integrity, or efficiency. The eight goals underneath are the specifics: intuitive to operate, safe with the hardware, every test traceable to a sensor, efficient, clear to monitor, covers all four test modes (EM, Shear, Manual, Cyclical), and built to extend and maintain. The appendix at the end has the detailed bullets under each goal if anyone wants to drill in."),

  H2("4 - Where the project is"),
  P("Where things stand: five test workflows all run end to end, there are six safety systems built in, and it's documented with over a hundred user stories across eleven features. It's an MVP, packaged as a double-click app on Mac and Windows. The piece that's still in progress is the formal test pass."),

  H2("5 - Divider: What I built"),
  P("Let me start with what the GUI actually does for the operator."),

  H2("6 - Five test workflows"),
  P("There are five test types. EM is the main one: press the sensor and read its response against pressure. Calibration / Fuji is the Fuji-film setup. Manual is free actuator control for exploring. Shear is load-cell-only, the operator pushes by hand. And Fatigue is cyclical loading, thousands of cycles."),

  H2("7 - Demo: Fatigue window"),
  P("This is a good one to show live. You pick a waveform - sine, square, triangle, sawtooth, or a blood-pressure pulse - set the force bounds and frequency, and it draws a live preview of exactly what the actuator will do. It even estimates the test length, here about eight hours for 28,800 cycles. And there's spike protection: if the force ever jumps past the configured swing, it stops."),
  SMALL("If presenting live: open the Fatigue window, change the frequency, and let them watch the preview redraw."),

  H2("8 - Concept: fatigue waveform builder"),
  P("This one is a concept, a mockup of where the fatigue window could go next, so flag it as not-yet-built. The idea: a fatigue test is just pressing between a low and a high force, so Lower, Upper, frequency, and cycles always mean the same thing. The waveform only changes the shape of the press in between. Most operators just pick a preset, sine, square, triangle, sawtooth, or a blood-pressure pulse, and never touch math. Blood pressure adds a couple of sliders, heart rate, dicrotic notch depth, and upstroke sharpness, so you can dial a realistic arterial pulse. The clever part is the warning banner: it works out the steepest part of the shape in newtons per second and compares it to what the actuator can physically do, so it tells you up front when a curve is too sharp to follow on the rig. That is the same reason a square wave comes out looking like a sine on real hardware. And for power users there is a custom equation box with a safe parser, type any shape in terms of phase and it auto-scales into your bounds."),
  SMALL("Two honest caveats to say out loud: it is a mockup, not wired into the app yet, and the actuator speed limit in it is a placeholder until it is measured on the rig. If presenting live: open the standalone page, switch a smooth shape to square, and watch the banner flip to the warning."),

  H2("9 - Demo: Manual window"),
  P("The manual window is the most flexible. You can move by a set distance, or, the cool part, drive until the load cell reads a target force, both pressing down and releasing back up. Force records continuously the whole time the window is open, and you can tweak the graph view mid-move while the motion controls stay locked for safety."),

  H2("10 - Demo: EM test and run management"),
  P("EM is the workhorse. Under the hood every run is a strict state machine, and you can see each state timestamped in the status log. It auto-runs multiple presses back to back, pausing between so you can reset the sensor. And redo never destroys data: redoing a run creates a new run number and supersedes the old one, so the original is always kept."),

  H2("11 - Calibration and Fuji film"),
  P("Calibration and the Fuji film test. The newer piece is the extrusion-distance field: the operator sets how far the actuator extrudes, capped at 12 mm, and it remembers the last value used. There's a fine jog for nudging position, and I fixed a nasty bug where the window thought the stage was still moving after a jog had finished."),

  H2("12 - Safety, in every test"),
  P("Safety is the part I'm most careful about, since this drives real motors into a load cell. Six systems: a hard force ceiling, spike detection for metal-on-metal contact, travel limits, disconnect handling, snap-to on every input field, and the single-owner load-cell reader. These are built into every test, not bolted on per feature."),

  H2("13 - Limits, bounds, and safety stops"),
  P("This is the reference slide, the actual numbers behind the safety story. The left side is everything the operator can set, and every one of those snaps into range the moment you commit it, so you can type freely while editing but you can't leave a bad value in. The right side is the fixed stuff nobody can touch: the stage travels seventeen to fifty point eight millimeters, the actuator physically tops out around twenty-five newtons, and the hard safety ceiling is thirty-three newtons, where a press stops instantly and homes itself. The sudden-jump cutoff scales with speed, so a slow press trips at a gentle force and a fast one tolerates more, that's what catches metal-on-metal contact. And two things that look like limits but aren't: the thirty-two newton EM target and the twenty newton Fuji target are just where a good press stops, not safety caps."),
  SMALL("Reconciliation note, only if someone digs in: the load cell is rated about 22 N, but the force input fields currently cap at 32 N (with the 33 N safety ceiling). Whether to tighten the input cap to the load-cell rating is an open item between the limits doc and the code."),

  H2("14 - Divider: Under the hood"),
  P("Okay, let me get into how it's actually built, in case the architecture is interesting."),

  H2("15 - Architecture: how it's built"),
  P("It's three layers. The front end is plain HTML, CSS, and JavaScript, one file per test tab, no framework. That talks to a small local Python server over JSON, and the browser just polls a status endpoint many times a second to draw the live graphs. The server owns a test engine that runs each test on a background thread, and the engine talks to the hardware drivers, Zaber over serial and the FUTEK load cell over .NET. The whole thing packages into one double-click app with PyInstaller."),

  H2("16 - The hardest bug: the load cell"),
  P("If I had to pick the hardest bug, it was this. The load cell kept dropping to simulated data partway through a session, and once it dropped, every test after it read fake values too. It turned out the manual window's live graph and the running test were both reading the device at the same time on different threads, and the driver cannot be read twice at once, so it corrupted. The fix was to make exactly one background thread own the device and have everything else read its cached value. Two simultaneous reads are now impossible."),

  H2("17 - Is the live graph behind the real force?"),
  P("This is the question I would expect about the fast tests. Honest answer first: yes, during a quick fatigue cycle the on-screen trace can sit a few tens of milliseconds behind the true load, because every sample has to travel from the load cell, through the backend, across the pywebview bridge, and wait for a redraw. But that lag does not put the test at risk, and here is the why. The safety cutoffs, the spike check and the force ceiling, run on the raw sample stream in the backend, before a single point is ever drawn, so display lag can never delay a safety stop. The actuator is driven from the same backend waveform, not from the screen, so the graph is just a read-only mirror. That makes the lag a UX number: it changes how live the graph feels, never whether the test is safe or the saved data is right."),
  SMALL("If pressed on numbers, go to the next slide and show the simulator."),

  H2("18 - Live graph latency simulator"),
  P("To keep myself honest about that number I built a little standalone page, it opens in any browser with no backend running, that models the whole signal path. You set the sample rate, how samples are pushed, the bridge overhead, and the redraw cadence, and it estimates the display lag and shows the true signal against the lagging on-screen one. A typical setup lands around 60 ms, somewhere in the 14 to 107 ms range, which is streaming, not hard real time. The key caveat on the slide: this is a model, not a measurement. To get the real figure for a given machine you stamp the sample with perf_counter() in Python when it is acquired, record performance.now() in the draw callback, take the difference, and report the median and the 95th percentile over a 30 to 60 second run. The 95th percentile is the honest worst case to quote, not the average."),
  SMALL("If presenting live: open the simulator, drag the redraw cadence or batch interval slider, and watch the lag number and the two traces respond."),

  H2("19 - Live force graph: values"),
  P("The next four are reference slides, the documentation behind the numbers, so I will go quick unless you want detail. This first one is just the live force graph's properties: it plots force in newtons against time, samples at 100 Hz, and the display lag is roughly 60 ms typical. The values are estimates for now; the plan is to swap in measured numbers once I profile it on the rig."),

  H2("20 - Live force graph: lag breakdown"),
  P("This breaks that 60 ms into where it actually goes. The biggest chunks are the transport wait and the frame wait, the two waiting-for-the-next-turn stages, while the backend and bridge are tiny. The line at the bottom is just the sum: each waiting stage contributes about half its interval on average."),

  H2("21 - Fatigue simulator: force calculation"),
  P("This documents how the fatigue simulator turns a shape into a force. You take the shape, normalize it to a 0-to-1 range, scale it into your lower and upper bounds, and top it off at the 33 N ceiling. The three lines of code at the bottom are the whole force calculation."),

  H2("22 - Fatigue simulator: round-off check"),
  P("And this is the round-off, or slew, check. It measures the steepest the force ever needs to change, in newtons per second, and compares it to what the actuator can physically do. The examples make it concrete: a slow sine is fine, but a blood-pressure pulse and a square wave are too steep, so they round off on the rig. The limit is block stiffness times max actuator speed, and the 60 N/s is a placeholder until the block stiffness is measured."),

  H2("23 - Day by day"),
  P("Quick timeline. The first couple of weeks were clinical data work; the GUI really starts at Day 19 with documenting the engine. Then it's motion and serial reliability, safety and UI state, run management, and then the big hardware-behavior and load-cell days. The most recent stretch was the snap-to input limits, the limits-and-bounds reference, reconciling the user stories, and then writing the formal test plan, forty-five EM test cases, which just wrapped. A couple of days in there were other-track work, the data script and the website."),

  H2("24 - It's all tracked in one workbook"),
  P("Quick credibility slide. None of this lives only in my head: there's one documentation workbook, fourteen sheets, that tracks everything. A verification checklist of eighty-plus pass/fail checks across every area, which is what drives the formal test pass. A GUI updates log with sixty-plus entries, every visual, backend, hardware, and documentation change, with the files it touched and whether it's tested. A user-story tracker with over a hundred stories and their acceptance criteria. Plus the limits reference and the folder workflow. So anyone can pick this up and see exactly what was done and what still needs verifying."),

  H2("25 - Where it stands and what's next"),
  P("Where it stands: every test type runs end to end, the safety behaviors are verified in simulation, and it's verified on the rig where I had hardware. What's next is executing the formal test plan, confirming the safety-critical cases on the real rig with deliberate fault injection (unplugging cables, pressing into metal), and reconciling the user-stories doc to the current GUI."),

  H2("26 - Resources"),
  P("And it's all documented: the user stories, the formal test plan, and the code is version-controlled. Happy to dig into any layer. Questions?"),

  H2("Appendix - Project goals (talking points)"),
  SMALL("If someone asks what the project was actually aiming for, these are the eight goals and the specifics under each."),
  ...goalsFull,
];
write("Test_Fixture_GUI_Speaker_Notes.docx", notes);

// ============================================================ DOC 2: CODE WALKTHROUGH
const code = [
  TITLE("Test Fixture GUI - Code Walkthrough"),
  SMALL("How the whole thing fits together, file by file. Skim the layer intros, then dig into whatever you care about. Snippets are in monospace; everything else is the plain-English version."),

  H1("Project goals"),
  ...goalsBrief,

  H1("The 30-second mental model"),
  P("It's a browser GUI talking to a tiny local Python server. The front end is plain HTML/CSS/JS (no framework, one file per test tab). When you click Start, the browser POSTs JSON to the server; the server hands the request to one engine object that runs the test on a background thread; the engine drives the Zaber actuator and reads the FUTEK load cell. While a test runs, the browser just polls a status endpoint about ten times a second and redraws the live graph from whatever the engine reports. The same code runs in simulation (no hardware) and on the real rig; the only difference is whether the actuator and load cell are real or stand-ins."),
  P([{ t: "Request/poll loop in one line: ", b: true }, { t: "click Start -> POST /api/start-run -> engine spawns a thread -> browser polls /api/run-status ~10x/sec -> draw graph -> repeat until the status says completed." }]),

  H1("Front end (web_preview/)"),

  H2("index.html"),
  P("The entire single-page interface: the main setup header, and a dialog (modal) for each test window (EM, Manual, Shear, Fatigue, Calibration) plus the analysis windows. No routing, no build step; it just loads the CSS and the JS files at the bottom. Everything the operator sees is in here as plain markup, and the JS files wire up the behavior."),

  H2("styles.css"),
  P("All the styling, and the single source of truth for the look. The :root block at the top holds every color and shadow as a CSS variable (--bg, --panel, --blue, --green, --red, and so on). The rule across the project is: never inline a hex color, always use a variable. The vibe is an instrument panel, dense and readable, not a marketing site."),

  H2("js/main.js"),
  P("Owns the main setup window. It builds the config object the server needs, runs the Verify Settings flow, handles the segmented Sensor ID builder, lists COM ports, and sets up a few global behaviors. Two bits worth knowing:"),
  P([{ t: "The verify flow ", b: true }, { t: "checks each field and shows the documented message before it lets you into a test (blank save folder, blank sensor type, incomplete sensor ID, and so on)." }]),
  P([{ t: "The global snap-to ", b: true }, { t: "clamps any numeric input with min/max limits into range on commit, reading the limits straight from each field's HTML attributes, so all the limited fields behave the same and pick up limit changes automatically:" }]),
  ...CODE([
    "function snapNumberInput(el) {",
    "  const hasMin = el.getAttribute('min') !== null && el.min !== '';",
    "  const hasMax = el.getAttribute('max') !== null && el.max !== '';",
    "  if (!hasMin && !hasMax) return false;          // no limits -> leave it",
    "  let n = Number(el.value);",
    "  n = Math.min(max, Math.max(min, n));           // clamp into range",
    "  // ...round to the field's step precision...",
    "  return hitLimit;   // caller shows a message naming the limit",
    "}",
  ]),

  H2("js/shared.js"),
  P("The shared toolbox every window uses. The important pieces: callApi (the one wrapper that POSTs JSON to the server and parses the reply), setMainMessage and the state-pill helpers (the colored READY / RUNNING / ERROR badges), drawMiniGraph (the hand-rolled SVG line-graph used by every live plot), runAnalysisProgress (the loading bar), the disconnect dialog, and snapNumberInput's partner normalizeNumberField. drawMiniGraph is the workhorse:"),
  ...CODE([
    "drawMiniGraph(canvasId, points, xKey, yKey, xLabel, yLabel, settings)",
    "  // builds an <svg> path from points, autoscales the axes, draws",
    "  // ticks + markers, and wires hover tooltips. Used by the EM, manual,",
    "  // shear, and fatigue live graphs so they all look identical.",
  ]),

  H2("js/em.js"),
  P("The EM testing window: the biggest of the tab files. It opens the modal, drives the run state machine (IDLE -> READY -> CONNECTING -> RUNNING -> BETWEEN_RUNS_PAUSED / COMPLETED / ERROR), and runs the poll loop that reads /api/run-status and redraws the Live Force vs Time graph. It also owns the multi-run flow, the auto-pause between runs, and the redo-with-reason dialog."),

  H2("js/manual.js"),
  P("The manual testing window. Two control modes: by distance (jog a set number of mm) and by force (drive until the load cell hits a target, which it calls Compress and Decompress). It runs a continuous force sampler so the Force vs Time graph keeps advancing even when nothing is moving, and it keeps the graph-display controls editable mid-move while locking the motion controls."),

  H2("js/fatigue.js"),
  P("The fatigue (cyclical) window. Small file: it reads the waveform type, force bounds, frequency, and cycle count, draws the live waveform preview, shows the estimated duration, and starts/stops the run. There are five waveform shapes - sine, square, triangle, sawtooth, and a blood-pressure pulse - and the shape math in cyclicalShape() is kept identical to target_force() in run_engine.py so the preview matches what the actuator actually does. The force bounds and frequency are whole numbers and snap into range on entry."),

  H2("js/shear.js"),
  P("The shear window. Shear is the odd one out: no actuator, just the load cell on the bottom while the operator pushes by hand. So this file is mostly the live force graph, the Start/Stop recording, and the graph controls; there are no move buttons."),

  H2("js/calibration.js"),
  P("The calibration / Fuji film window. It owns the fine manual jog, the extrusion-distance field (operator-set, capped at 12 mm, remembers the last value), the Start Fuji button (gated on a valid extrusion distance), and the in-place Pause. A chunk of this file exists to fix a real bug: making sure the window does not get stuck thinking the stage is still moving after a jog finished."),

  H1("The local server and engine (web_preview/)"),

  H2("run_web_gui.py"),
  P("The launcher. It builds the local HTTP server and figures out the URL. It tries port 8765 first and falls back to any free port if that's taken (that's why the port sometimes changes). When run from the command line it also opens Chrome at the page."),
  ...CODE([
    "def find_free_port(preferred):",
    "    # try 8765 first, otherwise pick any open port",
    "    try: probe.bind((HOST, preferred)); return preferred",
    "    except OSError: probe.bind((HOST, 0)); return probe.getsockname()[1]",
  ]),

  H2("config.py"),
  P("Shared config for all the Python modules: the host, the preferred port, and where web_preview lives. The one subtle bit is that it is 'frozen-aware': when PyInstaller packages the app, the files unpack into a temp folder (sys._MEIPASS), so the paths have to be computed differently in the bundle vs from source."),
  ...CODE([
    "if getattr(sys, 'frozen', False):     # running from the packaged app",
    "    PROJECT_ROOT = Path(sys._MEIPASS)",
    "    ROOT = PROJECT_ROOT / 'web_preview'",
    "else:                                  # running from source",
    "    ROOT = Path(__file__).resolve().parent",
  ]),

  H2("server.py"),
  P("The HTTP server and the JSON API. It's a ThreadingHTTPServer, so each request runs on its own thread. Most of the file is one big handler that matches the request path to an action: serve a static file, or hit an /api/... endpoint. The endpoints are thin; they mostly validate the payload and hand off to the engine. For example, starting an EM run:"),
  ...CODE([
    "if path == '/api/start-run':",
    "    run_number = run_log.next_run_number(log)        # never overwrite",
    "    ok, message = ENGINE.start(run_number, test_folder, surface_area,",
    "                               redo_of=redo_of, reason=reason)",
    "    return {'ok': ok, 'message': message, 'run_number': run_number}",
  ]),
  P("Other endpoints: /api/run-status (the one the browser polls), /api/verify, /api/move and /api/move-to-force (manual), /api/start-cyclical (fatigue), /api/fuji-film, /api/shear-start, /api/read-force, /api/perform-analysis, /api/list-ports, and the folder/existing-test plumbing."),

  H2("run_engine.py"),
  P("The heart of the whole thing. There's exactly one engine object (ENGINE) that the server calls for every test. The big design idea: the same control flow runs in simulation and on real hardware. Two values decide the mode, the axis (the Zaber motor, or None) and futek (the load cell, or None); 'simulated' is true when either is missing, and the engine fills in the missing piece with math."),
  P([{ t: "The constants block ", b: true }, { t: "at the top keeps every limit in one place: home position, the gap before a press, the 100 Hz sample rate, the force target, the travel limits, the descend/ascend speeds, the spike numbers, and the hard force ceiling." }]),
  P([{ t: "Force in simulation ", b: true }, { t: "is a gently stiffening spring based on how far the actuator has pressed, so a whole test can run on a laptop:" }]),
  ...CODE([
    "press = max(0.0, depth - SIM_FREE_GAP_MM)",
    "return SIM_STIFFNESS_N_MM * press * (1.0 + 0.06 * press)",
  ]),
  P([{ t: "The safety checks ", b: true }, { t: "live in a small record() function called on every 100 Hz sample. It raises a custom exception the run loop catches: a force spike or the hard ceiling stops the press, a disconnect is handled separately (it must NOT home, because after comms are lost the position is unknown):" }]),
  ...CODE([
    "if (prev_force is not None and abs(stage - prev_force) > spike_limit) \\",
    "        or stage > FORCE_CEILING_N:",
    "    raise ForceSpikeStop()",
  ]),
  P([{ t: "The single-owner load cell reader ", b: true }, { t: "is the important threading detail. The .NET driver cannot be read from two places at once, so one background thread owns the device and reads it ~100 Hz into a shared value; everything else reads that cached value and never touches the driver:" }]),
  ...CODE([
    "def _run(self):                      # the ONLY place the device is read",
    "    device = futek_cli.FUTEKDeviceCLI()",
    "    while not self._stop:",
    "        try:",
    "            raw = device.getNormalData()",
    "            with self._lock: self._latest_raw = raw",
    "        except Exception: pass        # keep the last value, keep going",
    "        time.sleep(SAMPLE_DT)",
  ]),
  P("The rest of the file is one method per test (the EM press, the manual jog and force move, Fuji film, shear, and the fatigue waveform), plus the home-to-baseline move, the approach move, and the disconnect safe state. They all share that same record()/safety pattern."),

  H2("hardware.py"),
  P("Zaber control. It holds a single STATE object with the live connection, the tracked position, and the disconnect flags. The notable bit is how it avoids false disconnects: a single failed position read is usually just the port being busy mid-move, so it only flags a real disconnect after several failures in a row."),
  ...CODE([
    "self._read_fail_count += 1",
    "if self._read_fail_count >= 3:        # 3 in a row = real loss",
    "    self.comms_lost = True",
  ]),
  P("It also deliberately does NOT use the actuator's normal homing: on this fixture the home sensor sits past the baseline, down inside the load cell, so a real homing would press the sensor into its limit. Instead it sets a 17 mm reference on connect and moves to it with absolute moves."),

  H2("run_log.py"),
  P("The no-overwrite run model. Data is never deleted. Redoing a run creates the next run number and marks the old one 'superseded'; analysis then uses only the active runs (the latest in each chain). Every redo records a required reason that shows up in the report. It's all stored in a small run_log.json in the test folder."),
  ...CODE([
    "def active_runs(log):                 # captured runs minus the redone ones",
    "    superseded = superseded_runs(log)",
    "    return sorted(r for r in log['runs'] if r not in superseded)",
  ]),

  H1("Hardware drivers (project root)"),

  H2("zaber_cli.py"),
  P("A small wrapper around the zaber-motion serial connection: open the port, grab the first detected device's axis, unpark it, and report a human-readable reason if the connect fails (wrong port, port in use, stage off, or the zaber-motion package missing). The engine talks to the actuator through this."),

  H2("futek_cli.py"),
  P("The load cell wrapper. It tries to load the real .NET FUTEK driver; if that's not available (for example on the dev Mac, or if the DLLs are missing), it falls back to a mock that returns synthetic force. The rest of the code never has to care which one it got:"),
  ...CODE([
    "if _REAL_FUTEK_AVAILABLE:",
    "    FUTEKDeviceCLI = RealFUTEKDeviceCLI    # Windows + .NET driver",
    "else:",
    "    FUTEKDeviceCLI = MockFUTEKDeviceCLI    # synthetic force",
  ]),
  P("The real class reads force through the .NET DeviceUSB225 calls; the metadata reads (model, serial, unit) are non-fatal so a quirky driver build still opens for readings."),

  H1("Analysis (web_preview/)"),
  SMALL("These turn a finished test's saved files into plots and a results workbook. Not the focus of the GUI work, but here's what each one is."),

  H2("analysis.py"),
  P("The dispatcher. It takes a test type and a folder, runs the right pipeline (EM, shear, manual, or fatigue), and reports progress back so the loading bar can move. It also handles the 'Analyze Saved Data' path, re-processing a folder of saved runs without re-running a test."),

  H2("em_analysis.py"),
  P("Emilio's real EM science pipeline: it resamples the capacitance and force to a common 200 Hz timeline, syncs them on the release peak, derives the pressure-sensitivity curves per channel, and writes the figures plus a results workbook. This is the one that orients force positive and guards against degenerate runs so a quirky dataset can't crash the whole analysis."),

  H2("shear_analysis.py / manual_analysis.py"),
  P("The shear and manual equivalents: smaller pipelines that turn each test's saved capacitance/force into the per-channel plots and a results workbook for that test type."),

  H2("plot_style.py"),
  P("Shared matplotlib styling so the saved analysis figures and the live GUI plots look like the same family (fonts, colors, sizing). One place to change the plot look."),

  H1("Packaging"),

  H2("app_desktop.py"),
  P("The double-click desktop wrapper. It starts the same local server the browser uses, then shows the page in a native pywebview window instead of a browser tab. The one safety touch: it blocks closing the whole app while a test is physically running, so you can't abandon the actuator mid-motion."),
  ...CODE([
    "def _on_closing():",
    "    if ENGINE.is_running():",
    "        showErrorDialog('A test is running. Pause or stop it first.')",
    "        return False                  # cancel the close",
    "    return True",
  ]),

  H2("app_desktop.spec"),
  P("The PyInstaller build recipe. It bundles the Python backend, the web_preview folder, and the Windows FUTEK DLLs into one .app (Mac) or .exe (Windows). Build it with: pyinstaller app_desktop.spec. The Windows build has to be made on Windows, since PyInstaller can't cross-compile and the FUTEK driver is Windows-only."),

  H1("So, end to end"),
  P("Operator double-clicks the app (app_desktop.py) -> it starts the server (run_web_gui.py / server.py) and shows the page (index.html + the JS files) -> operator sets up a test and clicks Start -> the browser POSTs to the server -> the server hands off to the one engine (run_engine.py) -> the engine drives the Zaber (zaber_cli.py / hardware.py) and reads the load cell (futek_cli.py) on a background thread, with safety checks on every sample -> the browser polls for status and draws the live graph -> when it's done, the saved files can be pushed through the analysis pipeline (analysis.py). Same path in simulation, just with the hardware swapped for math."),
];
write("Test_Fixture_GUI_Code_Walkthrough.docx", code);
