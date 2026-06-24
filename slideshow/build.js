const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";              // 13.33 x 7.5
pres.author = "Jacqueline Chuang";
pres.title = "Test Fixture GUI - Progress Update";

// palette: charcoal/slate base, product-blue accent, GUI-green for "shipped/safe"
const DARK = "1E2A33", DARKCARD = "27343D";
const INK = "1F2933", MUTE = "5B6770", LIGHT = "C7D0D6";
const ACCENT = "2F6FE0", GREEN = "2E875B", CARD = "F4F6F8", TINTB = "EAF0FC", WHITE = "FFFFFF";
const F = "Nunito";
const MONO = "Courier New";   // code lines
const W = 13.33, H = 7.5, M = 0.7, CW = W - 2 * M;

const sh = () => ({ type: "outer", color: "000000", blur: 8, offset: 3, angle: 90, opacity: 0.10 });
const shImg = () => ({ type: "outer", color: "000000", blur: 12, offset: 4, angle: 90, opacity: 0.18 });

function header(s, kicker, title, dark) {
  s.addText(kicker.toUpperCase(), { x: M, y: 0.52, w: CW, h: 0.3, margin: 0, fontFace: F, fontSize: 12, bold: true, color: ACCENT, charSpacing: 3 });
  s.addText(title, { x: M, y: 0.84, w: CW, h: 0.85, margin: 0, fontFace: F, fontSize: 31, bold: true, color: dark ? WHITE : INK });
}
function card(s, x, y, w, h, fill) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.06, fill: { color: fill || CARD }, line: { type: "none" }, shadow: sh() });
}
function numDot(s, x, y, d, label, color) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: color || ACCENT }, line: { type: "none" } });
  s.addText(label, { x, y, w: d, h: d, margin: 0, align: "center", valign: "middle", fontFace: F, fontSize: d > 0.5 ? 15 : 12, bold: true, color: WHITE });
}
function framedImage(s, path, x, y, w, h) {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: WHITE }, line: { color: "E3E7EB", width: 0.75 }, shadow: shImg() });
  s.addImage({ path, x, y, w, h });
}
// a documentation table with a styled header row. headers = [..], rows = [[..], ..]
function docTable(s, headers, rows, x, y, w, colW, fs) {
  const head = headers.map((h, i) => ({ text: h, options: { fill: { color: ACCENT }, color: "FFFFFF", bold: true, align: i === 0 ? "left" : (i === 1 ? "left" : "left") } }));
  const body = rows.map((r) => r.map((c, i) => ({ text: String(c), options: { bold: i === 0, color: i === 0 ? INK : MUTE } })));
  s.addTable([head, ...body], {
    x, y, w, colW, rowH: 0.36,
    border: { type: "solid", pt: 0.5, color: "E3E7EB" },
    fontFace: F, fontSize: fs || 12.5, valign: "middle", align: "left",
    margin: [3, 8, 3, 8], color: INK, fill: { color: "FFFFFF" },
  });
}
// a shaded monospace code block; lines is an array of strings (pre-padded for alignment)
function codeBlock(s, lines, x, y, w, fs) {
  fs = fs || 12;
  const lh = (fs / 72) * 1.5;
  const h = lines.length * lh + 0.26;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.04, fill: { color: "F2F3F5" }, line: { color: "E3E7EB", width: 0.75 } });
  s.addText(lines.map((ln) => ({ text: ln === "" ? " " : ln, options: { breakLine: true } })),
    { x: x + 0.2, y: y + 0.13, w: w - 0.4, h: h - 0.26, margin: 0, fontFace: MONO, fontSize: fs, color: "1A1A1A", align: "left", valign: "top", lineSpacingMultiple: 1.28 });
  return h;
}

// =================================================== 1. TITLE
(() => {
  const s = pres.addSlide(); s.background = { color: DARK };
  s.addText("PROGRESS UPDATE  ·  JUNE 2026", { x: M, y: 2.0, w: CW, h: 0.35, margin: 0, fontFace: F, fontSize: 13, bold: true, color: ACCENT, charSpacing: 3 });
  s.addText("Test Fixture GUI", { x: M, y: 2.45, w: CW, h: 1.2, margin: 0, fontFace: F, fontSize: 60, bold: true, color: WHITE });
  s.addText("Bench control software for the sensor-team test fixture", { x: M, y: 3.7, w: CW, h: 0.5, margin: 0, fontFace: F, fontSize: 21, color: LIGHT });
  s.addText("EM      ·      Calibration      ·      Manual      ·      Shear      ·      Fatigue", { x: M, y: 6.35, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 13, bold: true, color: "7E8B94", charSpacing: 1 });
  s.addText("Jacqueline Chuang", { x: M, y: 6.78, w: CW, h: 0.35, margin: 0, fontFace: F, fontSize: 13, color: LIGHT });
})();

// =================================================== 2. WHAT IT IS
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Overview", "What it is");
  s.addText("A single browser-based app an operator uses at the bench to run the sensor team's mechanical tests - driving a precision actuator into a sensor while reading a load cell, with every test, safety check, and result in one place.", { x: M, y: 1.85, w: CW, h: 1.0, margin: 0, fontFace: F, fontSize: 17, color: MUTE, lineSpacingMultiple: 1.2 });
  // hardware flow
  const fy = 3.5, fh = 1.7, bw = 3.0, gap = (CW - bw * 3) / 2;
  const boxes = [
    ["GUI", "Operator's laptop\nor the bench PC", ACCENT],
    ["Hardware", "Zaber actuator +\nFUTEK load cell", INK],
    ["Sensor", "The sensor\nunder test", GREEN],
  ];
  boxes.forEach(([t, d, c], i) => {
    const x = M + i * (bw + gap);
    card(s, x, fy, bw, fh, CARD);
    s.addText(t, { x: x + 0.3, y: fy + 0.28, w: bw - 0.6, h: 0.5, margin: 0, fontFace: F, fontSize: 20, bold: true, color: c });
    s.addText(d, { x: x + 0.3, y: fy + 0.82, w: bw - 0.6, h: 0.7, margin: 0, fontFace: F, fontSize: 13.5, color: MUTE, lineSpacingMultiple: 1.05 });
    if (i < 2) s.addText("→", { x: x + bw, y: fy, w: gap, h: fh, margin: 0, align: "center", valign: "middle", fontFace: F, fontSize: 26, color: "AEB7BE" });
  });
  s.addText("Closed-loop control: the GUI moves the actuator based on the live load-cell reading.", { x: M, y: 5.7, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 14, italic: true, color: INK });
})();

// =================================================== 2b. PROJECT GOALS
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Overview", "Project goals");
  s.addText("A platform for configuring, executing, monitoring, and analyzing sensor characterization tests, while keeping ease of use, operator safety, data integrity, and workflow efficiency front and center.", { x: M, y: 1.74, w: CW, h: 0.7, margin: 0, fontFace: F, fontSize: 14.5, color: MUTE, lineSpacingMultiple: 1.15 });
  const goals = [
    ["Intuitive user experience", "Easy to learn and operate with minimal training."],
    ["Safe hardware operation", "Reduces the risk of accidental misuse or unsafe actuator movement."],
    ["Data integrity & traceability", "Every test organized, reproducible, and tied to a sensor and configuration."],
    ["Efficiency", "Minimizes repetitive actions and streamlines characterization."],
    ["Clear test monitoring", "Test progress and system status are understandable in real time."],
    ["Multiple test modes", "Supports EM, Shear, Manual, and Cyclical testing."],
    ["Extensibility", "New tests and analysis tools can be added without a major redesign."],
    ["Maintainability", "Organized so future developers can understand, modify, and extend it."],
  ];
  const cols = 2, gap = 0.45, colW = (CW - gap) / cols;
  const top = 2.62, rh = 1.12;
  goals.forEach(([h, d], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = M + col * (colW + gap), y = top + row * rh;
    card(s, x, y, colW, 1.0, CARD);
    numDot(s, x + 0.26, y + 0.3, 0.42, String(i + 1), ACCENT);
    s.addText(h, { x: x + 0.86, y: y + 0.16, w: colW - 1.1, h: 0.35, margin: 0, fontFace: F, fontSize: 14.5, bold: true, color: INK });
    s.addText(d, { x: x + 0.86, y: y + 0.5, w: colW - 1.1, h: 0.42, margin: 0, fontFace: F, fontSize: 11.5, color: MUTE, lineSpacingMultiple: 1.02 });
  });
})();

// =================================================== 3. BY THE NUMBERS
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Status", "Where the project is");
  const stats = [
    ["5", "test workflows", "EM, Calibration, Manual,\nShear, and Fatigue"],
    ["6", "safety systems", "Force, spike, travel, disconnect,\nsnap-to, single-owner reader"],
    ["100+", "user stories", "Across 11 features, with a\nformal test plan underway"],
  ];
  const gap = 0.4, cw = (CW - gap * 2) / 3, cy = 2.05, ch = 2.5;
  stats.forEach(([big, label, sub], i) => {
    const x = M + i * (cw + gap); card(s, x, cy, cw, ch, CARD);
    s.addText(big, { x: x + 0.3, y: cy + 0.26, w: cw - 0.6, h: 1.0, margin: 0, fontFace: F, fontSize: 50, bold: true, color: ACCENT });
    s.addText(label, { x: x + 0.32, y: cy + 1.32, w: cw - 0.6, h: 0.4, margin: 0, fontFace: F, fontSize: 18, bold: true, color: INK });
    s.addText(sub, { x: x + 0.32, y: cy + 1.74, w: cw - 0.6, h: 0.7, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.05 });
  });
  s.addText([
    { text: "MVP built and running end to end - every test type completes.", options: { bullet: true, breakLine: true } },
    { text: "Packaged as a double-clickable desktop app on Mac and Windows.", options: { bullet: true } },
  ], { x: M, y: 4.95, w: CW, h: 1.2, margin: 0, valign: "top", fontFace: F, fontSize: 16, color: INK, paraSpaceAfter: 8 });
})();

// =================================================== 4. DIVIDER
function divider(kicker, title) {
  const s = pres.addSlide(); s.background = { color: DARK };
  s.addText(kicker.toUpperCase(), { x: M, y: 2.9, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 14, bold: true, color: ACCENT, charSpacing: 3 });
  s.addText(title, { x: M, y: 3.35, w: CW, h: 1.1, margin: 0, fontFace: F, fontSize: 44, bold: true, color: WHITE });
  return s;
}
divider("Part 1", "What I built");

// =================================================== 5. FIVE WORKFLOWS
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Capabilities", "Five test workflows");
  const items = [
    ["EM", "Press the sensor and read its response against pressure, automated across repeated runs."],
    ["Calibration / Fuji", "Fuji-film calibration with an operator-set extrusion distance and a fine manual jog."],
    ["Manual", "Free actuator control by distance or force, with live force recording for exploratory tests."],
    ["Shear", "Load-cell-only capture - the operator applies force by hand while the GUI records it."],
    ["Fatigue", "Cyclical loading on a choice of waveforms - sine, square, triangle, sawtooth, or a blood-pressure pulse - for thousands of cycles, with a live preview."],
  ];
  const top = 1.95, rh = 1.0;
  items.forEach(([t, d], i) => {
    const y = top + i * rh;
    numDot(s, M, y + 0.05, 0.44, String(i + 1), ACCENT);
    s.addText(t, { x: M + 0.7, y: y - 0.04, w: 3.0, h: 0.5, margin: 0, fontFace: F, fontSize: 18, bold: true, color: INK });
    s.addText(d, { x: M + 3.8, y: y - 0.02, w: CW - 3.8, h: 0.6, margin: 0, fontFace: F, fontSize: 14.5, color: MUTE, lineSpacingMultiple: 1.05 });
  });
})();

// =================================================== 6. DEMO: FATIGUE
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Demo", "Fatigue testing window");
  const tx = M, tw = 4.5;
  const points = [
    ["Five waveform types", "Sine, square, triangle, sawtooth, and a blood-pressure pulse, each redrawn live as the bounds and frequency change."],
    ["Whole-number force bounds", "Lower and upper force, snapped into the safe range on entry."],
    ["Cycle count + duration", "Shows the estimated test length - here, ~8 hours for 28,800 cycles."],
    ["Force-spike protection", "Stops safely if the load ever jumps beyond the configured swing."],
  ];
  let yy = 2.0;
  points.forEach(([h, d]) => {
    s.addShape(pres.shapes.OVAL, { x: tx, y: yy + 0.07, w: 0.14, h: 0.14, fill: { color: ACCENT }, line: { type: "none" } });
    s.addText(h, { x: tx + 0.32, y: yy - 0.05, w: tw - 0.32, h: 0.35, margin: 0, fontFace: F, fontSize: 15.5, bold: true, color: INK });
    s.addText(d, { x: tx + 0.32, y: yy + 0.3, w: tw - 0.32, h: 0.6, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.05 });
    yy += 1.12;
  });
  // image (1500x994 -> ratio 1.509)
  const iw = 7.1, ih = iw / 1.509, ix = M + tw + 0.5, iy = 1.95;
  framedImage(s, "shot_fatigue.png", ix, iy, iw, ih);
})();

// =================================================== 6b. CONCEPT: WAVEFORM BUILDER
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Concept", "Fatigue waveform builder");
  const tx = M, tw = 4.5;
  const points = [
    ["Presets, no math", "Sine, square, triangle, sawtooth, or a blood-pressure pulse: pick one and go."],
    ["Tunable by slider", "Blood pressure adds heart rate, dicrotic notch depth, and upstroke sharpness; the sliders write the equation."],
    ["Too-fast-to-track warning", "Flags any shape that changes force faster than the actuator can physically follow, before it runs."],
    ["Custom equation escape hatch", "Power users type a safe expression; live preview and validation, auto-scaled into the bounds."],
  ];
  let yy = 2.0;
  points.forEach(([h, d]) => {
    s.addShape(pres.shapes.OVAL, { x: tx, y: yy + 0.07, w: 0.14, h: 0.14, fill: { color: ACCENT }, line: { type: "none" } });
    s.addText(h, { x: tx + 0.32, y: yy - 0.05, w: tw - 0.32, h: 0.35, margin: 0, fontFace: F, fontSize: 15.5, bold: true, color: INK });
    s.addText(d, { x: tx + 0.32, y: yy + 0.3, w: tw - 0.32, h: 0.7, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.05 });
    yy += 1.12;
  });
  s.addText("Mockup, not yet wired into the app. The actuator speed limit is a placeholder until measured on the rig.", { x: tx, y: 6.55, w: tw, h: 0.6, margin: 0, fontFace: F, fontSize: 11.5, italic: true, color: MUTE, lineSpacingMultiple: 1.05 });
  // image (2240x1732 -> ratio 1.293)
  const iw = 6.3, ih = iw / 1.293, ix = M + tw + 0.5, iy = 1.7;
  framedImage(s, "shot_builder.png", ix, iy, iw, ih);
})();

// =================================================== 7. DEMO: MANUAL
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Demo", "Manual testing window");
  // image left (1500x1159 -> ratio 1.294)
  const ih = 4.55, iw = ih * 1.294, ix = M, iy = 1.95;
  framedImage(s, "shot_manual.png", ix, iy, iw, ih);
  const tx = ix + iw + 0.5, tw = W - tx - M;
  const points = [
    ["Distance or force control", "Jog by a set distance, or drive until the load cell reads a target force."],
    ["Compress and decompress", "Closed-loop in both directions - press to a force, then release back to one."],
    ["Continuous force recording", "Force vs time records from the moment the window opens."],
    ["Editable while moving", "Graph controls stay live mid-move; motion controls lock for safety."],
  ];
  let yy = 2.05;
  points.forEach(([h, d]) => {
    s.addShape(pres.shapes.OVAL, { x: tx, y: yy + 0.07, w: 0.14, h: 0.14, fill: { color: GREEN }, line: { type: "none" } });
    s.addText(h, { x: tx + 0.32, y: yy - 0.05, w: tw - 0.32, h: 0.35, margin: 0, fontFace: F, fontSize: 15.5, bold: true, color: INK });
    s.addText(d, { x: tx + 0.32, y: yy + 0.3, w: tw - 0.32, h: 0.65, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.05 });
    yy += 1.12;
  });
})();

// =================================================== 8. DEMO: EM + RUN MANAGEMENT
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Demo", "EM test & run management");
  const tx = M, tw = 4.5;
  const points = [
    ["Live state machine", "Every run moves through a strict set of states, each one timestamped in the status log."],
    ["Automated multi-run", "Runs the configured presses back to back, auto-pausing so the sensor can be reset."],
    ["Redo without data loss", "A redo creates a new superseding run - the original is never overwritten or deleted."],
    ["Homes first, every time", "Drives to the true baseline before pressing, never starting from an unknown spot."],
  ];
  let yy = 2.0;
  points.forEach(([h, d]) => {
    s.addShape(pres.shapes.OVAL, { x: tx, y: yy + 0.07, w: 0.14, h: 0.14, fill: { color: ACCENT }, line: { type: "none" } });
    s.addText(h, { x: tx + 0.32, y: yy - 0.05, w: tw - 0.32, h: 0.35, margin: 0, fontFace: F, fontSize: 15.5, bold: true, color: INK });
    s.addText(d, { x: tx + 0.32, y: yy + 0.3, w: tw - 0.32, h: 0.65, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.05 });
    yy += 1.12;
  });
  // image (1500x793 -> ratio 1.892)
  const iw = 7.1, ih = iw / 1.892, ix = M + tw + 0.5, iy = 2.55;
  framedImage(s, "shot_em.png", ix, iy, iw, ih);
})();

// =================================================== 9. CALIBRATION / FUJI
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Detail", "Calibration & Fuji film");
  const items = [
    ["Operator-set extrusion distance", "A new field controls how far the actuator extrudes for the Fuji-film press, capped at 12 mm and remembering the last value used."],
    ["Fine manual jog", "Step the actuator in small increments to fine-tune position before a calibration press."],
    ["Press to a calibrated target", "The Fuji press drives down until the load cell reaches its target force, then stops."],
    ["Reliable jog state", "Fixed an intermittent bug where the window thought the stage was still moving after a jog finished."],
  ];
  const top = 1.95, ch = 1.18, gy = 0.22;
  items.forEach(([h, d], i) => {
    const y = top + i * (ch + gy);
    card(s, M, y, CW, ch, CARD);
    numDot(s, M + 0.3, y + (ch - 0.5) / 2, 0.5, String(i + 1), GREEN);
    s.addText(h, { x: M + 1.05, y: y + 0.2, w: CW - 1.3, h: 0.4, margin: 0, fontFace: F, fontSize: 16, bold: true, color: INK });
    s.addText(d, { x: M + 1.05, y: y + 0.58, w: CW - 1.35, h: 0.5, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.03 });
  });
})();

// =================================================== 10. SAFETY
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Safety", "Built into every test");
  const items = [
    ["Force ceiling", "A hard over-force limit stops the actuator before the load cell can be overloaded."],
    ["Spike detection", "A sudden force jump - metal-on-metal contact - halts motion immediately."],
    ["Travel limits", "The stage never drives into its mechanical end stop."],
    ["Disconnect handling", "Losing the actuator or load cell mid-test stops safely and invalidates the run."],
    ["Snap-to input limits", "Out-of-range entries snap to the nearest limit and say which limit they hit."],
    ["Single-owner load cell", "Exactly one reader touches the device, so it can't be corrupted mid-session."],
  ];
  const gx = 0.4, gy = 0.32, cw = (CW - gx * 2) / 3, ch = 1.75, top = 2.0;
  items.forEach(([h, d], i) => {
    const col = i % 3, row = Math.floor(i / 3), x = M + col * (cw + gx), y = top + row * (ch + gy);
    card(s, x, y, cw, ch, CARD);
    s.addText(h, { x: x + 0.28, y: y + 0.24, w: cw - 0.56, h: 0.4, margin: 0, fontFace: F, fontSize: 15.5, bold: true, color: ACCENT });
    s.addText(d, { x: x + 0.28, y: y + 0.66, w: cw - 0.56, h: 1.0, margin: 0, fontFace: F, fontSize: 12, color: MUTE, lineSpacingMultiple: 1.08 });
  });
})();

// =================================================== 10b. LIMITS
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Reference", "Limits, bounds, and safety stops");
  const gap = 0.6, colW = (CW - gap) / 2;
  const cols = [
    { x: M, title: "Operator inputs - snap into range on commit", rows: [
      ["Manual position", "17 to 50.8 mm"],
      ["Target force (manual)", "0 to 32 N"],
      ["Increment distance", "0.1 to 12 mm"],
      ["Actuator speed", "0.01 to 2 mm/s"],
      ["Fatigue force bounds", "up to 32 N, upper > lower"],
      ["Fatigue frequency", "1 to 5 Hz"],
      ["EM runs per test", "1 to 10"],
    ] },
    { x: M + colW + gap, title: "Fixed physical and safety limits", rows: [
      ["Travel range", "17 to 50.8 mm"],
      ["Force ceiling (safety)", "33 N: stops + homes"],
      ["Actuator peak thrust", "25 N hardware max"],
      ["Sudden-jump cutoff", "speed-scaled, 1.5 to 500 N"],
      ["Lost connection", "safe stop, auto re-home"],
      ["Force sampling", "100 Hz"],
    ] },
  ];
  cols.forEach((col) => {
    s.addText(col.title, { x: col.x, y: 1.82, w: colW, h: 0.4, margin: 0, fontFace: F, fontSize: 14, bold: true, color: ACCENT });
    s.addShape(pres.shapes.LINE, { x: col.x, y: 2.22, w: colW, h: 0, line: { color: "DDE3E8", width: 1 } });
    const top = 2.42, rh = 0.52, lblW = colW * 0.52;
    col.rows.forEach(([label, value], i) => {
      const y = top + i * rh;
      s.addText(label, { x: col.x, y, w: lblW, h: 0.42, margin: 0, fontFace: F, fontSize: 13.5, color: INK, valign: "middle" });
      s.addText(value, { x: col.x + lblW, y, w: colW - lblW, h: 0.42, margin: 0, align: "right", fontFace: F, fontSize: 13.5, bold: true, color: INK, valign: "middle" });
      if (i < col.rows.length - 1) s.addShape(pres.shapes.LINE, { x: col.x, y: y + rh - 0.04, w: colW, h: 0, line: { color: "EEF1F4", width: 0.75 } });
    });
  });
  s.addText("Snap-to rounds each field to its precision and clamps it into range on commit, so you can still type freely while editing. EM run target (32 N) and Fuji target (20 N) are where a good press stops, not limits.", { x: M, y: 6.7, w: CW, h: 0.6, margin: 0, fontFace: F, fontSize: 11.5, italic: true, color: MUTE, lineSpacingMultiple: 1.05 });
})();

// =================================================== 11. DIVIDER
divider("Part 2", "Under the hood");

// =================================================== 12. ARCHITECTURE
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Architecture", "How it's built");
  const layers = [
    ["Browser GUI", ACCENT, "Vanilla HTML / CSS / JS - one file per test tab (em.js, manual.js, fatigue.js, shear.js, calibration.js), plus shared.js and main.js"],
    ["Local Python server + test engine", INK, "ThreadingHTTPServer (server.py) and run_engine.py - one background thread per test, polled for live status, a single-owner load-cell reader, and a simulation fallback"],
    ["Hardware drivers", GREEN, "Zaber actuator over serial (zaber-motion) and the FUTEK load cell over .NET (pythonnet, Windows only)"],
  ];
  const flows = ["JSON over local HTTP  ·  the UI polls for live status", "serial commands  ·  .NET driver calls"];
  const bw = CW, bh = 1.05, gap = 0.34; let y = 1.95;
  layers.forEach(([t, c, d], i) => {
    card(s, M, y, bw, bh, CARD);
    s.addText(t, { x: M + 0.35, y: y + 0.16, w: bw - 0.7, h: 0.38, margin: 0, fontFace: F, fontSize: 17, bold: true, color: c });
    s.addText(d, { x: M + 0.35, y: y + 0.54, w: bw - 0.7, h: 0.45, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE, lineSpacingMultiple: 1.0 });
    if (i < layers.length - 1) s.addText("↓   " + flows[i], { x: M, y: y + bh - 0.02, w: bw, h: gap + 0.06, margin: 0, align: "center", valign: "middle", fontFace: F, fontSize: 12, italic: true, color: ACCENT });
    y += bh + gap;
  });
  s.addText("Packaged as a pywebview desktop window, built into a single .app / .exe with PyInstaller - no terminal, no setup.", { x: M, y: y + 0.05, w: CW, h: 0.5, margin: 0, fontFace: F, fontSize: 13.5, italic: true, color: INK });
})();

// =================================================== 13. ENGINEERING STORY
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Engineering", "The hardest bug: the load cell");
  const steps = [
    ["Problem", "The load cell kept dropping to simulated data partway through a session - and once it dropped, every test after it read fake values."],
    ["Diagnosis", "The manual window's live graph and the active test were reading the device at the same time, on different threads. The driver can't be read twice at once, so it corrupted."],
    ["Fix", "Re-architected to a single-owner reader: one background loop owns the device and everything else reads its value. Two simultaneous reads are now impossible, in every window."],
  ];
  const gap = 0.45, cw = (CW - gap * 2) / 3, cy = 2.05, ch = 3.5;
  const colors = [INK, ACCENT, GREEN];
  steps.forEach(([h, d], i) => {
    const x = M + i * (cw + gap);
    card(s, x, cy, cw, ch, CARD);
    numDot(s, x + 0.32, cy + 0.34, 0.56, String(i + 1), colors[i]);
    s.addText(h, { x: x + 0.32, y: cy + 1.1, w: cw - 0.64, h: 0.45, margin: 0, fontFace: F, fontSize: 19, bold: true, color: colors[i] });
    s.addText(d, { x: x + 0.32, y: cy + 1.6, w: cw - 0.64, h: 1.8, margin: 0, fontFace: F, fontSize: 13, color: MUTE, lineSpacingMultiple: 1.15 });
  });
})();

// =================================================== 13b. ANTICIPATED Q: LIVE-GRAPH LAG
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Anticipated question", "Is the live graph behind the real force?");
  s.addText("During a fast fatigue cycle (up to 5 Hz), the on-screen trace can sit a few tens of milliseconds behind the true load. That is real, so here is why it does not put the test at risk.", { x: M, y: 1.78, w: CW, h: 0.6, margin: 0, fontFace: F, fontSize: 14.5, color: MUTE, lineSpacingMultiple: 1.1 });
  const points = [
    ["Safety never looks at the graph", "Spike and force-limit cutoffs run on the raw sample stream in the backend, before any point is drawn. Display lag cannot delay a safety stop.", GREEN],
    ["The actuator follows the backend, not the screen", "The waveform is generated and driven in Python. The live graph is a read-only mirror of that same stream.", ACCENT],
    ["So the lag is only a UX number", "It changes how live the graph feels, never whether the test is safe or the saved data is correct.", INK],
  ];
  const yy = 2.6, rh = 1.32;
  points.forEach(([h, d, c], i) => {
    const y = yy + i * rh;
    card(s, M, y, CW, 1.12, CARD);
    s.addShape(pres.shapes.OVAL, { x: M + 0.34, y: y + 0.39, w: 0.34, h: 0.34, fill: { color: c }, line: { type: "none" } });
    s.addText(h, { x: M + 0.95, y: y + 0.2, w: CW - 1.3, h: 0.4, margin: 0, fontFace: F, fontSize: 17, bold: true, color: c });
    s.addText(d, { x: M + 0.95, y: y + 0.58, w: CW - 1.3, h: 0.45, margin: 0, fontFace: F, fontSize: 13, color: MUTE, lineSpacingMultiple: 1.05 });
  });
})();

// =================================================== 13c. LATENCY SIMULATOR TOOL
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Tool", "Live graph latency simulator");
  const tx = M, tw = 4.7;
  s.addText("A standalone page (opens in any browser, no backend) that models how far the live graph trails the real force, so the number is honest instead of a guess.", { x: tx, y: 1.82, w: tw, h: 1.0, margin: 0, fontFace: F, fontSize: 13.5, color: MUTE, lineSpacingMultiple: 1.15 });
  const points = [
    ["Models the whole path", "Load cell sample, backend read, pywebview bridge, then redraw. Each stage is a slider you can dial in."],
    ["Gives a ballpark", "A typical setup lands near 60 ms (range 14-107 ms): streaming, not hard real time."],
    ["Measure the real number", "Stamp perf_counter() in Python and performance.now() at draw, then report the median and 95th-percentile gap over a 30-60 s run."],
  ];
  let yy = 3.0;
  points.forEach(([h, d]) => {
    s.addShape(pres.shapes.OVAL, { x: tx, y: yy + 0.07, w: 0.14, h: 0.14, fill: { color: ACCENT }, line: { type: "none" } });
    s.addText(h, { x: tx + 0.32, y: yy - 0.05, w: tw - 0.32, h: 0.35, margin: 0, fontFace: F, fontSize: 15, bold: true, color: INK });
    s.addText(d, { x: tx + 0.32, y: yy + 0.3, w: tw - 0.32, h: 0.9, margin: 0, fontFace: F, fontSize: 12, color: MUTE, lineSpacingMultiple: 1.05 });
    yy += 1.3;
  });
  // image (1720x1328 -> ratio 1.295)
  const iw = 5.9, ih = iw / 1.295, ix = M + tw + 0.4, iy = 2.0;
  framedImage(s, "shot_latency.png", ix, iy, iw, ih);
})();

// =================================================== DOC 1: LIVE FORCE GRAPH (values)
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Documentation", "Live force graph: values");
  s.addText("Current values for the live force display. Estimates for now; replace with measured numbers once profiled on the rig.", { x: M, y: 1.74, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 13, italic: true, color: MUTE, lineSpacingMultiple: 1.05 });
  docTable(s, ["Property", "Value", "Notes"], [
    ["Y axis", "Force (N)", "live load-cell reading"],
    ["X axis", "Time (s)", "scrolling window"],
    ["Sample rate", "100 Hz", "one reading every 10 ms"],
    ["Display lag (typical)", "~60 ms", "acquisition to drawn (estimate)"],
    ["Display lag (range)", "14 to 107 ms", "best to worst case (estimate)"],
    ["Update cadence", "~10 / second", "browser polls the status endpoint"],
    ["Data source", "raw backend stream", "safety reads this, not the graph"],
  ], M, 2.3, CW, [3.4, 2.6, CW - 6.0]);
})();

// =================================================== DOC 2: LIVE FORCE GRAPH (lag breakdown)
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Documentation", "Live force graph: lag breakdown");
  docTable(s, ["Stage", "Typical (ms)", "What it is"], [
    ["Acquisition", "5.0", "half a sample period"],
    ["Backend read", "0.5", "per-sample processing"],
    ["Transport wait", "25.0", "half the push interval"],
    ["Bridge", "5.0", "Python to JS hand-off"],
    ["Frame wait", "16.7", "half a redraw frame"],
    ["Redraw", "8.0", "paint one frame"],
    ["Total (typical)", "~60", "sum of the stages"],
  ], M, 1.95, CW, [3.0, 2.2, CW - 5.2]);
  s.addText("How the typical figure is built:", { x: M, y: 5.55, w: CW, h: 0.3, margin: 0, fontFace: F, fontSize: 13, bold: true, color: INK });
  codeBlock(s, [
    "typical = sample/2 + backend + batch/2 + bridge + frame/2 + redraw",
    "        = 5.0 + 0.5 + 25.0 + 5.0 + 16.7 + 8.0   ~=   60 ms",
  ], M, 5.9, CW);
})();

// =================================================== DOC 3: FATIGUE SIMULATOR (force calc)
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Documentation", "Fatigue simulator: force calculation");
  s.addText("How a shape becomes the force the actuator targets, cycle after cycle.", { x: M, y: 1.74, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 13, italic: true, color: MUTE });
  docTable(s, ["Step", "Calculation", "Result"], [
    ["Shape", "f(phase), phase 0 to 1", "the waveform you picked or typed"],
    ["Normalize", "(v - min) / (max - min)", "shape squashed to 0 to 1"],
    ["Scale to bounds", "lower + (upper - lower) * shape", "force in newtons"],
    ["Top-off (clamp)", "min(force, 33 N ceiling)", "never exceeds the safety ceiling"],
    ["Repeat", "one cycle per 1 / frequency", "thousands of cycles"],
  ], M, 2.3, CW, [2.5, 4.3, CW - 6.8]);
  s.addText("In code:", { x: M, y: 5.5, w: CW, h: 0.3, margin: 0, fontFace: F, fontSize: 13, bold: true, color: INK });
  codeBlock(s, [
    "shape = normalize(f(phase))                 // 0 to 1",
    "force = lower + (upper - lower) * shape      // newtons",
    "force = min(force, FORCE_CEILING_N)          // 33 N top-off",
  ], M, 5.85, CW);
})();

// =================================================== DOC 4: FATIGUE SIMULATOR (round-off)
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Documentation", "Fatigue simulator: round-off check");
  s.addText("Whether the actuator can physically follow the curve, or whether the sharp parts round off on the rig.", { x: M, y: 1.74, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 13, italic: true, color: MUTE });
  codeBlock(s, [
    "period  = 1 / frequency             // seconds per cycle",
    "dt      = period / samples          // time between points",
    "slope   = abs(f[i] - f[i-1]) / dt   // newtons per second",
    "maxSlew = max(slope over one cycle) // steepest demand",
    "limit   = stiffness * max_speed     // actuator ceiling (placeholder 60 N/s)",
    "verdict = maxSlew <= limit          // green, else amber: rounds off",
  ], M, 2.25, CW);
  s.addText("Worked examples (same 2 to 20 N bounds):", { x: M, y: 4.7, w: CW, h: 0.3, margin: 0, fontFace: F, fontSize: 13, bold: true, color: INK });
  docTable(s, ["Waveform", "Needs", "Verdict"], [
    ["Sine, 1 Hz", "~57 N/s", "green, follows faithfully"],
    ["Blood pressure, 60 bpm", "~230 N/s", "amber, upstroke rounds off"],
    ["Square", "very large (instant jump)", "amber, comes out like a sine"],
  ], M, 5.05, CW, [4.0, 3.2, CW - 7.2]);
  s.addText("limit = block stiffness (N/mm) x max actuator speed (mm/s). The 60 N/s is a placeholder until the block stiffness is measured on the rig.", { x: M, y: 6.95, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 11, italic: true, color: MUTE, lineSpacingMultiple: 1.05 });
})();

// =================================================== 13. TIMELINE
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Timeline", "Day by day");
  s.addText("Days 1-18 went to clinical data validation (OHSU / HFH cases, the MATLAB pipeline, and site decks). The fixture GUI begins on Day 19.", { x: M, y: 1.72, w: CW, h: 0.5, margin: 0, fontFace: F, fontSize: 13, italic: true, color: MUTE, lineSpacingMultiple: 1.05 });
  const rows = [
    ["Day 19  ·  Jun 10", "Annotated the test engine (run_engine) end to end - one code path for simulation and real hardware"],
    ["Day 20  ·  Jun 11", "Reliable motion + serial - killed the 12 s move lag, stopped false disconnects, fixed the 17 mm reference"],
    ["Day 21  ·  Jun 12", "Safety UI state - the waiting pill, control locking, safety-stop homes; redid the calibration window"],
    ["Day 22  ·  Jun 15", "Run management + reporting - made the report numbers match the graphs; the redo-run workflow"],
    ["Day 23  ·  Jun 16", "Other track - UCI data-parsing script and website planning (no GUI)"],
    ["Day 24  ·  Jun 17", "Real-hardware behavior - true home each test, Shear wired to the load cell, manual force-feedback"],
    ["Day 25  ·  Jun 18", "Load-cell reliability - the single-owner reader, plus fatigue and EM safety fixes"],
    ["Day 26  ·  Jun 19", "Other track - competitor research and a clinical-affairs interview (no GUI)"],
    ["Day 27  ·  Jun 22", "Snap-to input limits, the limits and bounds reference, and user-story reconciliation"],
    ["Day 28  ·  Jun 23", "Formal test plan done - 45 EM test cases across functional, negative, interruption, boundary, and journey paths"],
  ];
  const top = 2.35, rh = 0.53, dotD = 0.2, dotX = M + 0.06;
  s.addShape(pres.shapes.LINE, { x: dotX + dotD / 2, y: top + dotD / 2, w: 0, h: (rows.length - 1) * rh, line: { color: "DDE3E8", width: 1.5 } });
  rows.forEach(([label, text], i) => {
    const isOther = text.indexOf("Other track") === 0;
    const y = top + i * rh;
    s.addShape(pres.shapes.OVAL, { x: dotX, y, w: dotD, h: dotD, fill: { color: isOther ? "B6BFC6" : ACCENT }, line: { color: WHITE, width: 2 } });
    s.addText(label, { x: M + 0.5, y: y - 0.07, w: 2.5, h: 0.4, margin: 0, fontFace: F, fontSize: 13, bold: true, color: isOther ? MUTE : INK });
    s.addText(text, { x: M + 3.2, y: y - 0.07, w: CW - 3.2, h: 0.45, margin: 0, fontFace: F, fontSize: 12.5, color: MUTE });
  });
})();

// =================================================== 13b. DOCUMENTATION WORKBOOK
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Documentation", "It's all tracked in one workbook");
  s.addText("Every requirement, change, and check lives in a single documentation workbook, so nothing is only in someone's head.", { x: M, y: 1.74, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 13.5, italic: true, color: MUTE, lineSpacingMultiple: 1.05 });
  docTable(s, ["Section", "What it documents", "Size"], [
    ["Verification checklist", "Per-area pass/fail checks: when it happens, pass condition, status, verified", "84 checks"],
    ["GUI Updates Log", "Every visual, backend, hardware, and documentation change, with files touched and test status", "60+ entries"],
    ["User Story Tracker", "Feature requirements with priority, status, and acceptance criteria", "100+ stories"],
    ["Limits and bounds", "Every input range and fixed physical / safety limit, per test", "reference"],
    ["Testing info + folder workflow", "Test setup notes and the analysis save workflow", "reference"],
  ], M, 2.35, CW, [3.4, CW - 5.4, 2.0]);
  s.addText("Across 14 sheets. The checklist drives the formal test pass; the updates log is the change history.", { x: M, y: 5.9, w: CW, h: 0.4, margin: 0, fontFace: F, fontSize: 11.5, italic: true, color: MUTE });
})();

// =================================================== 14. STANDS + NEXT
(() => {
  const s = pres.addSlide(); s.background = { color: WHITE };
  header(s, "Status", "Where it stands & what's next");
  const colW = (CW - 0.6) / 2;
  // left: solid now
  s.addText("Solid now", { x: M, y: 1.9, w: colW, h: 0.4, margin: 0, fontFace: F, fontSize: 18, bold: true, color: GREEN });
  s.addText([
    { text: "Every test type runs end to end", options: { bullet: true, breakLine: true } },
    { text: "Safety behaviors verified in simulation", options: { bullet: true, breakLine: true } },
    { text: "Verified on the rig where hardware was available", options: { bullet: true, breakLine: true } },
    { text: "Packaged and runnable without a terminal", options: { bullet: true } },
  ], { x: M, y: 2.45, w: colW, h: 2.8, margin: 0, valign: "top", fontFace: F, fontSize: 15, color: INK, paraSpaceAfter: 12, lineSpacingMultiple: 1.05 });
  // right: next
  const rx = M + colW + 0.6;
  s.addText("Next", { x: rx, y: 1.9, w: colW, h: 0.4, margin: 0, fontFace: F, fontSize: 18, bold: true, color: ACCENT });
  s.addText([
    { text: "Execute the formal test plan (full path coverage)", options: { bullet: true, breakLine: true } },
    { text: "Confirm safety-critical cases on the real rig", options: { bullet: true, breakLine: true } },
    { text: "Reconcile the user-stories doc to the current GUI", options: { bullet: true } },
  ], { x: rx, y: 2.45, w: colW, h: 2.8, margin: 0, valign: "top", fontFace: F, fontSize: 15, color: INK, paraSpaceAfter: 12, lineSpacingMultiple: 1.05 });
})();

// =================================================== RESOURCES (dark closing)
(() => {
  const s = pres.addSlide(); s.background = { color: DARK };
  s.addText("RESOURCES", { x: M, y: 0.85, w: CW, h: 0.35, margin: 0, fontFace: F, fontSize: 13, bold: true, color: ACCENT, charSpacing: 3 });
  s.addText("Documentation & code", { x: M, y: 1.2, w: CW, h: 0.9, margin: 0, fontFace: F, fontSize: 33, bold: true, color: WHITE });
  const items = [
    ["User stories", "11 features, 100+ stories - every happy and unhappy path, safety handling, and a verification method for each.", "[ add link ]"],
    ["Test plan", "Formal test cases traced to each story, organized by technique and tagged simulation vs real rig.", "[ add link ]"],
    ["Source code", "The full GUI, test engine, and hardware drivers, version-controlled.", "github.com/jacqchuang09/test_fixture"],
  ];
  const gap = 0.45, cw = (CW - gap * 2) / 3, cy = 2.5, ch = 3.15;
  items.forEach(([h, d, l], i) => {
    const x = M + i * (cw + gap);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: cy, w: cw, h: ch, rectRadius: 0.06, fill: { color: DARKCARD }, line: { type: "none" } });
    s.addText(h, { x: x + 0.35, y: cy + 0.35, w: cw - 0.7, h: 0.5, margin: 0, fontFace: F, fontSize: 19, bold: true, color: WHITE });
    s.addText(d, { x: x + 0.35, y: cy + 0.95, w: cw - 0.7, h: 1.55, margin: 0, fontFace: F, fontSize: 13, color: LIGHT, lineSpacingMultiple: 1.15 });
    s.addText(l, { x: x + 0.35, y: cy + ch - 0.62, w: cw - 0.7, h: 0.4, margin: 0, fontFace: F, fontSize: 11.5, bold: true, color: ACCENT });
  });
  s.addText("Thank you  ·  Jacqueline Chuang", { x: M, y: 6.85, w: CW, h: 0.35, margin: 0, fontFace: F, fontSize: 12.5, color: "7E8B94" });
})();

pres.writeFile({ fileName: "Test_Fixture_GUI_Update.pptx" }).then(f => console.log("wrote", f));
