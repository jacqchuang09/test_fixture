const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://127.0.0.1:8765/index.html";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox","--headless=new","--user-data-dir=/tmp/zaber-shots-profile","--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 800));

  async function shotEl(selector, file) {
    const el = await page.$(selector);
    if (!el) { console.log("MISSING", selector); return false; }
    await el.screenshot({ path: file });
    console.log("saved", file);
    return true;
  }

  // 1. Main setup window - clip the visible content (header + Basic Settings)
  await page.screenshot({ path: "shot_main.png", clip: { x: 40, y: 0, width: 700, height: 200 } });
  console.log("saved shot_main.png");

  // 2. Manual Testing Window (force controls + live graphs)
  await page.evaluate(() => { if (window.openManualTest) openManualTest(); });
  await new Promise(r => setTimeout(r, 1000));
  await shotEl("#manualTestModal", "shot_manual.png");
  await page.evaluate(() => { const m = document.getElementById("manualTestModal"); if (m && m.open) m.close(); });

  // 3. Fatigue Testing Window (waveform preview) - capture the default Sine state
  // (the window's dropdown offers Sine and Square). 1 Hz / 28,800 cycles keeps the
  // "~8 hours" estimate the slide references.
  await page.evaluate(() => { if (window.openCyclicalTest) openCyclicalTest(); });
  await new Promise(r => setTimeout(r, 800));
  await shotEl("#cyclicalTestModal", "shot_fatigue.png");
  await page.evaluate(() => { const m = document.getElementById("cyclicalTestModal"); if (m && m.open) m.close(); });

  // 4. EM Testing Window (live force vs time) - may need to exist regardless of hardware
  await page.evaluate(() => { if (window.openEmTest) openEmTest(); });
  await new Promise(r => setTimeout(r, 1000));
  await shotEl("#emTestModal", "shot_em.png");

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
