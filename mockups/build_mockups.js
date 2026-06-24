// Builds the Test Fixture GUI Mockups deck (PPTX) from the current GUI screenshots.
// Title slide -> per-feature divider -> one slide per user story (story text on the
// left, a fresh GUI screenshot with an optional orange highlight on the right).
const path = require("path");
const fs = require("fs");
const NM = path.join(__dirname, "..", "slideshow", "node_modules");
const pptxgen = require(path.join(NM, "pptxgenjs"));
const { FEATURES, STORIES } = require("./stories");

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "shots_meta.json"), "utf8"));
const SHOTS = path.join(__dirname, "shots");

// palette (shared with the slideshow deck) + an orange highlight
const DARK = "16223A", INK = "1F2933", MUTE = "5B6770", LIGHT = "C7D0D6";
const ACCENT = "2F6FE0", TINTB = "EAF0FC", CARD = "F4F6F8", WHITE = "FFFFFF";
const LINE = "E3E7EB", HL = "F08A24";
const F = "Nunito";
const W = 13.33, H = 7.5, M = 0.55;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Jacqueline Chuang";
pres.title = "Test Fixture GUI Mockups";

const shImg = () => ({ type: "outer", color: "000000", blur: 11, offset: 4, angle: 90, opacity: 0.16 });
const featName = (n) => (FEATURES.find((f) => f.num === n) || {}).name || "";

// ---- contain-fit an image inside a box, return drawn geometry + px->inch scale
function fit(natW, natH, bx, by, bw, bh) {
  const r = natW / natH, br = bw / bh;
  let dw, dh;
  if (r > br) { dw = bw; dh = bw / r; } else { dh = bh; dw = bh * r; }
  const x = bx + (bw - dw) / 2, y = by + (bh - dh) / 2;
  return { x, y, w: dw, h: dh, scale: dw / natW };
}

// place a screenshot (contain-fit) and draw a highlight rectangle for each box in
// hlBoxes (boxes are in capture pixels, relative to the shot's top-left).
function placeShot(s, shotKey, bx, by, bw, bh, hlBoxes) {
  const m = meta[shotKey];
  if (!m) { s.addText("[missing: " + shotKey + "]", { x: bx, y: by, w: bw, h: 0.4, fontFace: F, color: "C0392B" }); return; }
  const g = fit(m.w, m.h, bx, by, bw, bh);
  s.addShape(pres.shapes.RECTANGLE, { x: g.x, y: g.y, w: g.w, h: g.h, fill: { color: WHITE }, line: { color: LINE, width: 0.75 }, shadow: shImg() });
  s.addImage({ path: path.join(SHOTS, shotKey + ".png"), x: g.x, y: g.y, w: g.w, h: g.h });
  (hlBoxes || []).forEach((b) => {
    const pad = 0.045;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: g.x + b.x * g.scale - pad, y: g.y + b.y * g.scale - pad,
      w: b.w * g.scale + pad * 2, h: b.h * g.scale + pad * 2, rectRadius: 0.04,
      fill: { type: "solid", color: HL, transparency: 90 },
      line: { color: HL, width: 2 },
    });
  });
}

// ---- build the acceptance-criteria bullet list (■ top level, ○ for "  - " sub-points)
function criteriaRuns(items, fs) {
  return items.map((raw) => {
    const sub = /^\s*-\s/.test(raw);
    const text = raw.replace(/^\s*-\s/, "");
    return {
      text,
      options: {
        bullet: { code: sub ? "25CB" : "25AA", indent: sub ? 14 : 16 },
        indentLevel: sub ? 1 : 0,
        fontSize: sub ? fs - 0.5 : fs,
        color: sub ? MUTE : INK,
        paraSpaceAfter: sub ? 2 : 4,
        breakLine: true,
      },
    };
  });
}

// =================================================================== TITLE
(() => {
  const s = pres.addSlide(); s.background = { color: DARK };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: H, fill: { color: ACCENT }, line: { type: "none" } });
  s.addText("USER STORIES", { x: 1.1, y: 2.55, w: 10, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: "5E9BF5", charSpacing: 3 });
  s.addText("Test Fixture GUI Mockups", { x: 1.05, y: 2.95, w: 11.5, h: 1.1, fontFace: F, fontSize: 50, bold: true, color: WHITE });
  s.addText(
    "Main Window · Existing Test Found · Test Configuration · Calibration · EM Test · EM Analysis\nShear Test · Shear Analysis · Manual Test · Manual Analysis · Cyclical Test",
    { x: 1.1, y: 4.35, w: 11, h: 0.9, fontFace: F, fontSize: 15, color: LIGHT, lineSpacingMultiple: 1.3 }
  );
})();

// =================================================================== FEATURES
FEATURES.forEach((feat) => {
  // divider
  const d = pres.addSlide(); d.background = { color: DARK };
  d.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: H, fill: { color: ACCENT }, line: { type: "none" } });
  d.addText("FEATURE " + feat.num, { x: 1.1, y: 3.05, w: 10, h: 0.35, fontFace: F, fontSize: 14, bold: true, color: "5E9BF5", charSpacing: 3 });
  d.addText(feat.div, { x: 1.05, y: 3.45, w: 11.5, h: 1.0, fontFace: F, fontSize: 40, bold: true, color: WHITE });

  // one slide per story
  STORIES.filter((st) => st.f === feat.num).forEach((st) => {
    const s = pres.addSlide(); s.background = { color: WHITE };

    // header
    s.addText((`FEATURE ${feat.num}  ·  ${feat.name}`).toUpperCase(),
      { x: M, y: 0.42, w: 8.5, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: MUTE, charSpacing: 2 });
    s.addText("STORY " + st.id, { x: M, y: 0.74, w: 6, h: 0.32, fontFace: F, fontSize: 13, bold: true, color: ACCENT, charSpacing: 1 });
    // MUST badge (top-right)
    const bw = 1.15, bx = W - M - bw;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: 0.46, w: bw, h: 0.42, rectRadius: 0.06, fill: { color: TINTB }, line: { type: "none" } });
    s.addText("MUST", { x: bx, y: 0.46, w: bw, h: 0.42, align: "center", valign: "middle", fontFace: F, fontSize: 12, bold: true, color: ACCENT, charSpacing: 1 });
    // title
    s.addText(st.title, { x: M, y: 1.06, w: W - 2 * M, h: 0.7, fontFace: F, fontSize: 26, bold: true, color: INK });

    const shotMeta = meta[st.shot] || { boxes: {} };
    const icons = Array.isArray(shotMeta.helpIcons) ? shotMeta.helpIcons : [];
    const isInfo = st.title === "Info Icons" && icons.length > 0;

    // ---- left column
    const lx = M, lw = 4.55, top = 1.98;
    // user-story card: height grows with the text, and the text shrinks to fit as a backstop
    const usLines = Math.max(1, Math.ceil(st.us.length / 40));
    const cardH = Math.max(1.35, 0.52 + usLines * 0.205 + 0.14);
    s.addShape(pres.shapes.RECTANGLE, { x: lx, y: top, w: lw, h: cardH, fill: { color: CARD }, line: { type: "none" } });
    s.addShape(pres.shapes.RECTANGLE, { x: lx, y: top, w: 0.07, h: cardH, fill: { color: ACCENT }, line: { type: "none" } });
    s.addText("USER STORY", { x: lx + 0.26, y: top + 0.16, w: lw - 0.5, h: 0.28, fontFace: F, fontSize: 10.5, bold: true, color: ACCENT, charSpacing: 2 });
    s.addText(st.us, { x: lx + 0.26, y: top + 0.46, w: lw - 0.5, h: cardH - 0.58, fontFace: F, fontSize: 12, italic: true, color: INK, lineSpacingMultiple: 1.08, valign: "top", fit: "shrink" });

    const secTop = top + cardH + 0.26;

    if (isInfo) {
      // list every help icon on this page with its tooltip description
      s.addText("INFO ICONS ON THIS PAGE", { x: lx, y: secTop, w: lw, h: 0.28, fontFace: F, fontSize: 10.5, bold: true, color: MUTE, charSpacing: 2 });
      const dLines = icons.reduce((n, ic) => n + Math.max(1, Math.ceil((ic.label.length + ic.tooltip.length + 3) / 54)), 0);
      const fs = dLines > 16 ? 8 : dLines > 12 ? 8.75 : dLines > 9 ? 9.5 : 10.5;
      const runs = [];
      icons.forEach((ic) => {
        runs.push({ text: ic.label + ":  ", options: { bold: true, color: INK, fontSize: fs, bullet: { code: "25AA", indent: 16 }, breakLine: false } });
        runs.push({ text: ic.tooltip, options: { color: MUTE, fontSize: fs, breakLine: true } });
      });
      s.addText(runs, { x: lx, y: secTop + 0.34, w: lw, h: 6.95 - (secTop + 0.34), fontFace: F, valign: "top", lineSpacingMultiple: 1.05, paraSpaceAfter: 5, fit: "shrink" });
    } else {
      // acceptance criteria
      s.addText("ACCEPTANCE CRITERIA", { x: lx, y: secTop, w: lw, h: 0.28, fontFace: F, fontSize: 10.5, bold: true, color: MUTE, charSpacing: 2 });
      const lines = st.ac.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / 52)), 0);
      const fs = lines > 14 ? 8.5 : lines > 10 ? 9.5 : lines > 7 ? 10.5 : 11.5;
      s.addText(criteriaRuns(st.ac, fs), { x: lx, y: secTop + 0.34, w: lw, h: 6.95 - (secTop + 0.34), fontFace: F, color: INK, valign: "top", lineSpacingMultiple: 1.04, fit: "shrink" });
    }

    // ---- right column: screenshot + highlight(s)
    let hlBoxes = [];
    if (isInfo) hlBoxes = icons.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    else if (st.hl && shotMeta.boxes && shotMeta.boxes[st.hl]) hlBoxes = [shotMeta.boxes[st.hl]];
    placeShot(s, st.shot, lx + lw + 0.4, 1.98, W - M - (lx + lw + 0.4), 4.78, hlBoxes);
  });
});

const outPptx = path.join(__dirname, "Test_Fixture_GUI_Mockups.pptx");
pres.writeFile({ fileName: outPptx }).then(() => {
  console.log("wrote", outPptx, "slides:", 1 + FEATURES.length + STORIES.length);
});
