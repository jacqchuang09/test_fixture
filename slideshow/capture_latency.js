const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + __dirname + "/live_graph_latency_simulator.html";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--headless=new", "--user-data-dir=/tmp/zaber-latency-profile", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 860, height: 1100, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  // let the model compute and the scope animation fill in
  await new Promise(r => setTimeout(r, 1600));

  // clip from the top of .wrap down through the "where the lag comes from" panel,
  // which is the punchy, self-contained part for a slide (title, lag number,
  // acquired-vs-displayed scope, and the lag breakdown bar).
  const box = await page.evaluate(() => {
    const wrap = document.querySelector(".wrap");
    const panels = document.querySelectorAll(".panel");
    const breakdown = panels[2]; // estimated lag, scope, breakdown
    const w = wrap.getBoundingClientRect();
    const b = breakdown.getBoundingClientRect();
    return { x: Math.max(0, w.left), y: 0, width: w.width + w.left * 2, bottom: b.bottom + 16 };
  });
  await page.screenshot({
    path: "shot_latency.png",
    clip: { x: box.x, y: box.y, width: box.width, height: box.bottom },
  });
  console.log("saved shot_latency.png", JSON.stringify(box));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
