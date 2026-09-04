// Headless capture of the *current* GUI for the Test Fixture GUI Mockups deck.
// For each window/state we drive the live app (everything runs in simulation,
// no hardware needed), screenshot the relevant element, and record the on-screen
// bounding box of each control we want to highlight on a slide. The boxes are
// stored relative to the captured element so build_mockups.js can draw a highlight
// rectangle that lines up no matter how the image is scaled into a slide.
const path = require("path");
const NM = path.join(__dirname, "..", "slideshow", "node_modules");
const puppeteer = require(path.join(NM, "puppeteer-core"));

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://127.0.0.1:8765/index.html";
const ROOT = path.join(__dirname, "..");
const EM_SAMPLE = path.join(ROOT, "web_preview", "sample_data", "03 09 26_325mm2_EM");
const SHEAR_SAMPLE = path.join(ROOT, "web_preview", "sample_data", "260310B01S02BA", "04 17 26_50.27_Shear");
const OUT = path.join(__dirname, "shots");

const meta = {}; // shotKey -> { w, h, boxes: { name: {x,y,w,h} } }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--headless=new", "--user-data-dir=/tmp/zaber-mockup-profile", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1640, height: 2200, deviceScaleFactor: 2 });
  page.on("console", (m) => { if (m.type() === "error") console.log("  [page error]", m.text()); });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await sleep(800);

  // page-side helper: rect of a child relative to a container element
  await page.evaluate(() => {
    window.__boxes = (containerSel, map) => {
      const c = document.querySelector(containerSel);
      if (!c) return null;
      const cr = c.getBoundingClientRect();
      const out = {};
      for (const [name, sel] of Object.entries(map)) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        out[name] = { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
      }
      return out;
    };
    // all visible help icons inside a container: label, tooltip, and box (relative to the container)
    window.__helpIcons = (containerSel) => {
      const c = document.querySelector(containerSel);
      if (!c) return [];
      const cr = c.getBoundingClientRect();
      return [...c.querySelectorAll(".sensor-help")].map((el) => {
        const r = el.getBoundingClientRect();
        let label = "";
        const hdr = el.closest(".sensor-header");
        if (hdr) { const lt = hdr.querySelector(".label-text"); if (lt) label = lt.textContent.trim(); }
        if (!label) {
          const lab = el.closest("label");
          if (lab) { const sp = lab.querySelector("span:not(.sensor-help):not(.label-text)"); if (sp) label = sp.textContent.trim(); }
        }
        return { label, tooltip: el.getAttribute("data-tooltip") || "", x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
      }).filter((h) => h.w > 0 && h.h > 0);
    };
    window.__resetMain = () => {
      // collapse any opened modal & test config so the main page is clean
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      const tc = document.getElementById("testConfig");
      if (tc) tc.classList.add("hidden");
      const cm = document.getElementById("configMessage");
      if (cm) cm.textContent = "";
      const mm = document.getElementById("mainMessage");
      if (mm) mm.textContent = "";
    };
  });

  // capture one shot: prepare() runs in node (can call page.evaluate), then we
  // screenshot `sel` and record boxes relative to it.
  async function shot(key, sel, boxMap, prepare, helpSel) {
    try {
      if (prepare) await prepare();
      await page.waitForSelector(sel, { timeout: 5000 });
      const el = await page.$(sel);
      if (!el) { console.log("MISSING", key, sel); return; }
      const file = path.join(OUT, key + ".png");
      await el.screenshot({ path: file });
      const dims = await page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { w: r.width, h: r.height };
      }, sel);
      const boxes = boxMap ? await page.evaluate((s, m) => window.__boxes(s, m), sel, boxMap) : {};
      meta[key] = { w: dims.w, h: dims.h, boxes: boxes || {} };
      if (helpSel) {
        const icons = await page.evaluate((s) => window.__helpIcons(s), helpSel);
        meta[key].helpIcons = icons || [];
        console.log("saved", key, `${Math.round(dims.w)}x${Math.round(dims.h)}`, "boxes:", Object.keys(boxes || {}).join(","), "| helpIcons:", (icons || []).length);
        return;
      }
      console.log("saved", key, `${Math.round(dims.w)}x${Math.round(dims.h)}`, "boxes:", Object.keys(boxes || {}).join(","));
    } catch (e) {
      console.log("FAILED", key, "-", e.message);
    }
  }

  const ev = (fn, ...a) => page.evaluate(fn, ...a);

  // ============================================================ 1.1 MAIN WINDOW
  await shot("main", "main", {
    title: "header h1",
    saveFolder: ".folder-row",
    sensorId: ".sensor-segment-row",
    sensorPreview: ".sensor-preview",
    sensorType: "#sensorType",
    customCheck: ".option-check",
    verify: ".basic-actions",
  }, async () => { await ev(() => window.__resetMain()); await sleep(200); });

  await shot("main_custom", "main", { customField: "#customSensorIdField" }, async () => {
    await ev(() => {
      window.__resetMain();
      const cb = document.getElementById("useCustomSensorId");
      cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await sleep(300);
  });

  await shot("main_reverify", "main", { message: "#configMessage" }, async () => {
    await ev(() => {
      window.__resetMain();
      const cb = document.getElementById("useCustomSensorId");
      if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await sleep(200);
    // verify, then change a basic setting to trigger the re-verify message
    await ev(() => { if (window.verifySettings) verifySettings(); });
    await sleep(700);
    await ev(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
    await ev(() => {
      const f = document.getElementById("saveFolder");
      f.value = "/Users/jacqueline/Google Drive/Test Data";
      f.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(400);
  });

  await shot("help_icons", "main", { help: ".sensor-help" }, async () => {
    await ev(() => window.__resetMain()); await sleep(200);
  }, "main");

  // ============================================================ 1.2 EXISTING TEST
  await shot("existing_test", "#existingTestModal", {
    versioned: ".conflict-actions button.primary",
    redo: "#existingRedoButton",
  }, async () => {
    await ev(() => {
      window.__resetMain();
      if (window.promptExistingTestChoice) {
        promptExistingTestChoice({
          folder: "/Users/.../Test Data/250506B01S01B/05 21 26_325mm2_EM",
          message: "A test folder already exists for this Sensor ID and test configuration:\n/Users/.../Test Data/250506B01S01B/05 21 26_325mm2_EM\nChoose how you want to continue.",
          is_em_test: true,
        });
      }
    });
    await sleep(400);
  });

  // ============================================================ 1.3 TEST CONFIG
  await shot("test_config", "#testConfig", {
    testType: "#testType",
    surfaceArea: "#surfaceArea",
    runs: "#runs",
    comport: "#comport",
    runToRedo: "#runToRedo",
    begin: "#beginButton",
    openCalib: "#testConfig .actions button:nth-child(2)",
  }, async () => {
    await ev(() => {
      window.__resetMain();
      const cb = document.getElementById("useCustomSensorId");
      if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); }
      if (window.verifySettings) verifySettings();
    });
    await sleep(800);
    await ev(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
    // force the section visible in case the backend folder check blocked it
    await ev(() => document.getElementById("testConfig").classList.remove("hidden"));
    await sleep(300);
  }, "#testConfig");

  // ============================================================ 1.4 CALIBRATION
  await shot("calibration", "#calibrationModal", null, async () => {
    await ev(() => { window.__resetMain(); if (window.openCalibration) openCalibration(); });
    await sleep(1400);
  });

  // ============================================================ 1.5 EM TEST
  await shot("em_test", "#emTestModal", {
    state: "#emState",
    status: ".em-live-panel:nth-child(1)",
    graph: ".em-live-panel:nth-child(2)",
    start: "#emStartButton",
    pause: "#emPauseButton",
    analysis: "#emAnalysisButton",
  }, async () => {
    await ev(() => { window.__resetMain(); if (window.openEmTest) openEmTest(); });
    await sleep(900);
  });

  // ============================================================ 1.6 EM ANALYSIS
  await ev(() => { window.__resetMain(); });
  const emOpened = await openAnalysis(page, EM_SAMPLE, "EM", "325", "emAnalysisModal");
  console.log("EM analysis opened:", emOpened);
  if (emOpened) {
    for (const [key, tab] of [
      ["em_an_raw", "rawSignals"], ["em_an_ps", "pressureSensitivity"],
      ["em_an_all", "allChannelsRuns"], ["em_an_summary", "summary"],
      ["em_an_report", "reportOutput"], ["em_an_interactive", "interactive"],
    ]) {
      await ev((t) => showAnalysisTab("em", t), tab);
      await sleep(tab === "interactive" ? 3500 : 2600);
      await shot(key, "#emAnalysisModal", { tabs: "#emAnalysisTabs" });
    }
  }
  await ev(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
  await sleep(300);

  // ============================================================ 1.7 SHEAR TEST
  await shot("shear_test", "#shearTestModal", {
    graph: ".graph-wrap",
    controls: ".graph-settings",
    start: "#shearStartButton",
    stop: "#shearPauseButton",
    analysis: "#shearAnalysisButton",
  }, async () => {
    await ev(() => { window.__resetMain(); if (window.openShearTest) openShearTest(); });
    await sleep(900);
  }, "#shearTestModal");

  // ============================================================ 1.8 SHEAR ANALYSIS
  await ev(() => { window.__resetMain(); });
  const shOpened = await openAnalysis(page, SHEAR_SAMPLE, "Shear", "50.27", "shearAnalysisModal");
  console.log("Shear analysis opened:", shOpened);
  if (shOpened) {
    for (const [key, tab] of [
      ["sh_an_plot", "plot"], ["sh_an_detection", "detection"], ["sh_an_report", "reportOutput"],
    ]) {
      await ev((t) => showAnalysisTab("shear", t), tab);
      await sleep(2600);
      await shot(key, "#shearAnalysisModal", { tabs: "#shearAnalysisTabs" });
    }
  }
  await ev(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
  await sleep(300);

  // ============================================================ 1.9 MANUAL TEST
  await shot("manual_test", "#manualTestModal", {
    mode: "#manualModeField",
    primary: "#manualPrimaryControlField",
    speed: "#manualSpeedField",
    moves: ".manual-move-row",
    drag: "#manualDragCard",
    graphs: "#manualTestModal .manual-graph",
    controls: "#manualTestModal .graph-settings",
    pause: "#manualPauseButton",
    analysis: "#manualAnalysisButton",
  }, async () => {
    await ev(() => { window.__resetMain(); if (window.openManualTest) openManualTest(); });
    await sleep(900);
  }, "#manualTestModal");

  await shot("manual_test_force", "#manualTestModal", {
    primary: "#manualPrimaryControlField",
    moves: ".manual-move-row",
  }, async () => {
    await ev(() => { if (window.setManualControlMode) setManualControlMode("force"); });
    await sleep(500);
  });

  // ============================================================ 1.10 MANUAL ANALYSIS
  // Generate a little preview data by simulating moves, then run analysis.
  const manOpened = await (async () => {
    try {
      await ev(() => { window.__resetMain(); if (window.openManualTest) openManualTest(); });
      await sleep(700);
      await ev(() => { if (window.setManualControlMode) setManualControlMode("force"); });
      await sleep(300);
      for (let i = 0; i < 4; i++) {
        await ev(() => window.manualTestMove && manualTestMove("down"));
        await sleep(700);
      }
      await ev(() => window.performManualAnalysis && performManualAnalysis());
      // wait for the analysis modal
      for (let i = 0; i < 40; i++) {
        const open = await ev(() => document.getElementById("manualAnalysisModal").open === true);
        if (open) return true;
        await sleep(250);
      }
    } catch (e) { console.log("manual analysis drive failed:", e.message); }
    return false;
  })();
  console.log("Manual analysis opened:", manOpened);
  if (manOpened) {
    for (const [key, tab] of [
      ["man_an_capforce", "capForce"], ["man_an_forcetime", "forceTime"], ["man_an_captime", "capTime"],
    ]) {
      await ev((t) => showAnalysisTab("manual", t), tab);
      await sleep(2200);
      await shot(key, "#manualAnalysisModal", { tabs: "#manualAnalysisModal .tabs" });
    }
  }
  await ev(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
  await sleep(300);

  // ============================================================ 1.11 CYCLICAL TEST
  await shot("cyclical_test", "#cyclicalTestModal", {
    waveform: "#waveformType",
    lower: "#cyclicalLowerForce",
    upper: "#cyclicalUpperForce",
    frequency: "#waveformFrequency",
    cycles: "#cyclicalCycleCount",
    estimate: "#cyclicalEstimate",
    start: "#cyclicalStartButton",
    stop: "#cyclicalPauseButton",
    graph: "#cyclicalGraph",
  }, async () => {
    await ev(() => { window.__resetMain(); if (window.openCyclicalTest) openCyclicalTest(); });
    await sleep(900);
  }, "#cyclicalTestModal");

  require("fs").writeFileSync(path.join(__dirname, "shots_meta.json"), JSON.stringify(meta, null, 2));
  console.log("\nwrote shots_meta.json with", Object.keys(meta).length, "shots");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function openAnalysis(page, folder, type, surface, modalId) {
  await page.evaluate((f, t, s) => {
    window.__an = null;
    analyzeFolderAs(f, t, s).then(() => (window.__an = "ok")).catch((e) => (window.__an = "err:" + e));
  }, folder, type, surface);
  for (let i = 0; i < 90; i++) {
    const open = await page.evaluate((id) => document.getElementById(id).open === true, modalId);
    if (open) return true;
    const st = await page.evaluate(() => window.__an);
    if (st && String(st).startsWith("err")) { console.log("  analysis error:", st); return false; }
    await sleep(1000);
  }
  return false;
}
