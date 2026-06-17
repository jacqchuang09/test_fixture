# CLAUDE.md — Zaber/FUTEK Browser GUI Rules

This project is a **local lab-instrument control interface**, not a marketing website. The frontend lives in `web_preview/` (vanilla HTML/CSS/JS) and talks to real Zaber stages and FUTEK load cells through a local Python backend. Design for an operator running tests at a bench: clarity, density, and safety over visual flair.

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code, every session, no exceptions.
- Read `web_preview/styles.css` `:root` block before touching any visuals — it is the design system.

## Where the Frontend Lives
- `web_preview/index.html` — the single-page interface (tabs: Manual, Calibration, EM, Fatigue, Shear)
- `web_preview/styles.css` — all styling; CSS variables in `:root` are the only source of colors/shadows
- `web_preview/js/` — one file per tab (`manual.js`, `em.js`, `fatigue.js`, `shear.js`, `calibration.js`) plus `shared.js` and `main.js`
- `web_preview/run_web_gui.py` — the Python backend the buttons call
- Edit these files in place. Do **not** restructure into a new single-file page, do not add frameworks, build steps, or CDNs.

## Local Server
- **Always serve through the Python backend** — never open or screenshot a `file:///` URL (it can't reach the backend).
- Start it: `python3 -u web_preview/run_web_gui.py` (use `python3` on this Mac, never `python`). It prints `http://127.0.0.1:8765/index.html`.
- If the server is already running, do not start a second instance.

## Screenshot Workflow
- Use Claude's browser tools (Claude Preview / Chrome MCP) to load `http://127.0.0.1:8765/index.html` and screenshot it.
- After any visual change: screenshot, compare, fix mismatches, re-screenshot. Do at least 2 comparison rounds. Stop only when no visible differences remain or the user says so.
- When comparing, be specific: "heading is 32px but reference shows ~24px", "panel gap is 16px but should be 24px".
- Check: spacing/padding, font size/weight, colors (exact hex against `:root` variables), alignment, table layout, plot container sizing, console readability.
- Check every tab you touched, not just the one that was easiest to reach.

## Reference Images
- If a reference image or mockup is provided: match layout, spacing, typography, and color exactly. Do not improve or add to the design.
- If no reference: extend the existing GUI style — new UI must look like it was always part of this app, not like a different website pasted in.

## Hardware Safety
- Buttons in this GUI move real motors and read real load cells. **Never click motion/run/start buttons in a live browser session** unless the user explicitly asks; visual verification means looking, not operating.
- A screenshot proves layout, not behavior. Never claim hardware behavior works from UI inspection alone — say what was and wasn't verified.
- Stop/abort controls are safety-critical: keep them red, large, always visible, and never hide them behind hover states, animations, or collapsed sections.

## Design Guardrails
- **Colors:** Use only the `:root` variables (`--bg`, `--panel`, `--blue`, `--green`, `--red`, etc.). Need a new color? Add a variable; never inline a hex in a rule.
- **Status colors mean things:** green = safe/running, red = stop/error, muted = inactive. Never use them decoratively.
- **Density over whitespace:** this is an instrument panel. Operators want readings, state, and controls visible at once — no hero sections, no oversized padding.
- **Typography:** keep the existing system font stack; differentiate with weight and the existing muted color, not new fonts.
- **Animations:** essentially none. Only animate `transform`/`opacity` for small affordances (button press). Never `transition-all`. Nothing safety-relevant may rely on animation to be noticed.
- **Interactive states:** every clickable element needs hover, focus-visible, active, and a clearly distinct **disabled** state (much of this GUI gates buttons on hardware/run state).
- **Plots:** Plotly is vendored at `web_preview/vendor/plotly.min.js`. Style plots via `plot_style.py` / existing plot config so saved analysis plots and live plots match. No CDN Plotly.
- **Comments:** match the existing style — plain-English sentences explaining what a block is for (see the top of `styles.css`).

## After Any Code Change
- **Rebuild the desktop app**: `pyinstaller app_desktop.spec` → `dist/ZaberGUI.app`. Every change must be baked into the app; do this without being asked.

## Hard Rules
- Do not add sections, features, or controls the user didn't ask for
- Do not "improve" a reference design — match it
- Do not stop after one screenshot pass
- Do not use `transition-all`
- Do not add Tailwind, React, CDNs, or any build tooling
- Do not invent colors outside `styles.css` `:root`
- Do not operate hardware controls during visual checks
