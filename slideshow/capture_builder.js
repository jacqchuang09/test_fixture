const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + __dirname + "/../fatigue_waveform_builder.html";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--headless=new", "--user-data-dir=/tmp/zaber-builder-profile", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 800)); // let the BP default render

  const el = await page.$(".dialog");
  if (!el) { console.log("MISSING .dialog"); process.exit(1); }
  await el.screenshot({ path: "shot_builder.png" });
  console.log("saved shot_builder.png");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
