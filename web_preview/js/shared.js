/*
 * shared.js - global state, DOM references, and cross-window helpers.
 *
 * Loaded FIRST, before every other js/ file, because it declares the
 * top-level variables and element handles that the per-window scripts read
 * at runtime. Nothing here belongs to a single test window.
 *
 * Structure:
 *   1. DOM element handles (modals, status boxes) and live state vars -
 *      settingsVerified, currentPosition, currentForce, the per-test data
 *      arrays (emReadings, shearData, manualData, cyclicalData) and timers.
 *   2. Actuator limit constants: ACTUATOR_MIN_MM / MAX_MM / PEAK_THRUST_N.
 *   3. graphTooltip - the floating element shared by every SVG hover handler.
 *   4. Generic helpers used across windows:
 *        - status/readout: stamp, setStatePill, setMainMessage,
 *          setPositionReadout, setForceReadout
 *        - python bridge: apiUrl, callApi
 *        - format/math: summaryStats, coefficientOfVariation, formattedDate,
 *          formatDuration, formatShortedChannels, escapeHtml, clampForce
 *        - analysis UI: showAnalysisTab, runAnalysisProgress,
 *          closeAnalysisToMain, metricCards, statValueTable, metricValueTable,
 *          reportPreviewTable, copy helpers
 *        - chart primitives: xAxisTicks, setGraphHoverPoints, drawWaveformSvg,
 *          drawMiniGraph
 *
 * Page load order: shared -> em -> shear -> manual -> fatigue ->
 * calibration -> main (main.js wires up DOM events and runs startup last).
 */

      const emStatusEl = document.getElementById("emStatus");
      const emStateEl = document.getElementById("emState");
      const mainMessageEl = document.getElementById("mainMessage");
      const emTestModal = document.getElementById("emTestModal");
      const emAnalysisModal = document.getElementById("emAnalysisModal");
      const manualTestModal = document.getElementById("manualTestModal");
      const manualAnalysisModal = document.getElementById("manualAnalysisModal");
      const cyclicalTestModal = document.getElementById("cyclicalTestModal");
      const shearTestModal = document.getElementById("shearTestModal");
      const existingTestModal = document.getElementById("existingTestModal");
      const existingTestMessageEl = document.getElementById("existingTestMessage");
      let existingTestChoiceResolver = null;
      let liveExistingCheckTimer = null;
      let liveExistingCheckSeq = 0;
      const shearAnalysisModal = document.getElementById("shearAnalysisModal");
      const shearStateEl = document.getElementById("shearState");
      const calibrationModal = document.getElementById("calibrationModal");
      // X-NA08A50-E09 actuator limits. 17 mm is the working baseline/home; 50.8 mm is the datasheet travel range.
      const ACTUATOR_MIN_MM = 17;
      const ACTUATOR_MAX_MM = 50.8;
      const ACTUATOR_PEAK_THRUST_N = 25;
      let settingsVerified = false;
      let currentPosition = 17;
      let currentForce = 0;
      // true while a real Zaber jog/home is in progress; the position readout
      // updates only after the move finishes, so block overlapping moves.
      let calibrationMoveInFlight = false;
      let fujiTimer = null;
      let fujiStartedAt = null;
      let calibrationLines = ["[ready] calibration window ready."];
      let emStatusLines = [];
      // most EM characterizations use 3 runs; cap the count so a typo can't start
      // an enormous test (each run is a full press cycle). Redo mode uses 1 run.
      const MAX_EM_RUNS = 10;
      let emCurrentRun = 1;
      let emCompletedRuns = 0;
      let emTotalRuns = 3;
      let emRunTimer = null;
      let emReturnHomeTimer = null;
      let emRunStartedAt = null;
      // when the just-finished run is a redo, holds its NEW run number so the
      // completion can tell the operator exactly what to name the CAP file.
      let emRedoNewRun = null;
      let emReadings = [];
      let emAnalysisReadings = [];
      // real computed curve data from the python EM engine (em_analysis.plot_payload).
      // when present, the EM analysis tabs render Emilio's real plots instead of the
      // synthetic preview curves. null in preview/no-hardware mode.
      let emPlotData = null;
      // paths to the real matplotlib PNG figures the python engine saved. when
      // present, the analysis tabs display these high-quality images (served via
      // /plot-file) instead of redrawing curves in the browser. null in preview mode.
      let emImages = null;
      // redo/supersession info from the run log: active runs + per-redo reasons.
      // feeds the "Notes" column in the EM Report Output.
      let emRedoInfo = null;
      // real per-channel stats from the Python EM pipeline (computed from the actual
      // CAP files): list of {channel, ps, kpa, cap, inf} with mean/std/cov/min/max.
      // Used by the Summary Statistics table instead of the synthesized preview.
      let emBackendChannelStats = null;
      // shear report state (shorted channels + pass/fail) for the Shear Report Output.
      let shearReportShorted = "None";
      let shearReportResult = "Pass";
      // manual matplotlib figures {cap_vs_force, force_vs_time, cap_vs_time}.
      let manualImages = null;
      let emRawSignalRun = 1;
      let emPressureSensitivityRun = 1;
      let emAllChRunsMode = "channel";
      let shearData = [];
      let latestShearAnalysisData = [];
      let shearTimer = null;
      let shearAnalysisUnlockTimer = null;
      let shearStartTime = null;
      let manualData = [];
      let manualPosition = 17;
      let manualPendingPosition = 17;
      let manualStatusLines = [];
      let manualAnalysisZoom = 1;
      let manualMotionTimer = null;
      let cyclicalData = [];
      let cyclicalTimer = null;
      let cyclicalReturnHomeTimer = null;
      let cyclicalStartedAt = null;
      const graphTooltip = document.createElement("div");
      graphTooltip.className = "graph-tooltip";
      document.body.appendChild(graphTooltip);


      // add timestamps to the status output.
      function stamp() {
        return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      }

      function xAxisTicks(start, end, toX, axisY, suffix = "") {
        const tickCount = 5;
        const span = Math.max(1, end - start);
        return Array.from({ length: tickCount + 1 }, (_, index) => {
          const value = start + (span * index) / tickCount;
          const x = toX(value);
          const label = `${value.toFixed(value >= 10 ? 0 : 1)}${suffix}`;
          return `
            <line x1="${x.toFixed(2)}" y1="${axisY}" x2="${x.toFixed(2)}" y2="${axisY + 5}" stroke="#c7d1df" stroke-width="1"></line>
            <text x="${x.toFixed(2)}" y="${axisY + 20}" text-anchor="middle" fill="#697790" font-size="12" font-family="Inter, sans-serif">${label}</text>
          `;
        }).join("");
      }

      function setGraphHoverPoints(svgId, hoverPoints) {
        const graph = document.getElementById(svgId);
        if (!graph) return;
        graph.__hoverPoints = hoverPoints;
        graph.onmouseleave = () => {
          graphTooltip.style.display = "none";
        };
        graph.onmousemove = (event) => {
          if (!graph.__hoverPoints?.length || graph.classList.contains("drawing")) {
            graphTooltip.style.display = "none";
            return;
          }
          const host = graph.closest("dialog") || document.body;
          if (graphTooltip.parentElement !== host) host.appendChild(graphTooltip);
          const rect = graph.getBoundingClientRect();
          const viewBox = graph.viewBox.baseVal;
          const x = ((event.clientX - rect.left) / rect.width) * viewBox.width + viewBox.x;
          const y = ((event.clientY - rect.top) / rect.height) * viewBox.height + viewBox.y;
          const nearest = graph.__hoverPoints.reduce((best, point) => {
            const distance = Math.abs(point.x - x) + Math.abs(point.y - y) * 0.35;
            return distance < best.distance ? { point, distance } : best;
          }, { point: null, distance: Infinity }).point;
          if (!nearest) return;
          graphTooltip.innerHTML = nearest.label;
          graphTooltip.style.left = `${event.clientX + 14}px`;
          graphTooltip.style.top = `${event.clientY + 14}px`;
          graphTooltip.style.display = "block";
        };
      }

      // variant: "" neutral, "kept" (green, data saved), "discarded" (amber, no
      // data saved) - so the operator can tell an auto-pause from a user pause.
      function setStatePill(elementOrId, state, message = "", variant = "") {
        const element = typeof elementOrId === "string" ? document.getElementById(elementOrId) : elementOrId;
        if (!element) return;
        element.classList.remove("state-kept", "state-discarded");
        if (variant) element.classList.add(`state-${variant}`);
        element.innerHTML = "";
        const tag = document.createElement("span");
        tag.className = "state-tag";
        tag.textContent = message ? `${state}:` : state;
        element.appendChild(tag);
        if (message) {
          const body = document.createElement("span");
          body.className = "state-message";
          body.textContent = message;
          element.appendChild(body);
        }
      }

      // pick where a setup message shows: while the Test Configuration section is
      // open, messages appear right above it (config-related); otherwise they show
      // at the top, under Basic Settings.
      function messageTargetEl() {
        const cfg = document.getElementById("testConfig");
        const configEl = document.getElementById("configMessage");
        return (cfg && configEl && !cfg.classList.contains("hidden")) ? configEl : mainMessageEl;
      }

      // show setup messages near the relevant box (Basic Settings vs Test Config).
      function setMainMessage(message, kind = "") {
        const el = messageTargetEl();
        const other = el === mainMessageEl ? document.getElementById("configMessage") : mainMessageEl;
        // clear the other slot so a message never lingers in both places.
        if (other) { other.textContent = ""; other.className = "main-message"; }
        el.textContent = message;
        el.className = `main-message ${kind}`.trim();
      }

      function setPositionReadout(value) {
        currentPosition = value;
        document.getElementById("positionReadout").textContent = `${value.toFixed(2)} mm`;
      }

      function setForceReadout(value) {
        // load-cell force is always positive; flip polarity if it reads negative.
        currentForce = Math.abs(value);
      }

      function apiUrl(path) {
        // app only runs through the Python launcher now - no file:// fallback.
        return window.location.protocol === "file:" ? `http://127.0.0.1:8765${path}` : path;
      }

      // send button clicks to python.
      async function callApi(path, payload = {}, successMessage = null) {
        try {
          const response = await fetch(apiUrl(path), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...config(), ...payload }),
          });
          const result = await response.json();
          if (successMessage && result.ok) {
            appendEmStatus(successMessage);
          } else if (!result.ok) {
            const message = result.message || JSON.stringify(result);
            appendEmStatus(message);
            setMainMessage(message, "error");
          }
          return result;
        } catch (error) {
          const message = `browser could not reach python backend: ${error.message}`;
          appendEmStatus(message);
          setMainMessage(message, "error");
          return { ok: false, message };
        }
      }

      function closeAnalysisToMain(kind) {
        const analysisModal = { em: emAnalysisModal, manual: manualAnalysisModal, shear: shearAnalysisModal, fatigue: fatigueAnalysisModal }[kind];
        const testModal = { em: emTestModal, manual: manualTestModal, shear: shearTestModal, fatigue: cyclicalTestModal }[kind];
        if (analysisModal?.open) analysisModal.close();
        if (testModal?.open) testModal.close();

        settingsVerified = false;
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = "";
        saveFolderInput.dataset.existingTestAction = "";
        const redoRunInput = document.getElementById("redoRun");
        redoRunInput.checked = false;
        redoRunInput.disabled = false;
        redoRunInput.dataset.lockedByExistingFolder = "";
        setRunToRedoOptions([]);
        document.getElementById("testType").disabled = false;
        document.getElementById("testConfig").classList.add("hidden");
        setMainMessage("analysis complete. verify settings again before starting another test.", "ok");
      }

      async function runAnalysisProgress(title, work) {
        const modal = document.getElementById("analysisProgressModal");
        const fill = document.getElementById("analysisProgressFill");
        const copy = document.getElementById("analysisProgressCopy");
        document.getElementById("analysisProgressTitle").textContent = title;
        fill.style.width = "0%";
        copy.textContent = "Preparing plots and summary tables...";
        modal.showModal();

        let progress = 0;
        const steps = [
          "Reading FUT and CAP files...",
          "Generating plots...",
          "Calculating summary statistics...",
          "Saving analysis outputs...",
        ];
        const progressTimer = setInterval(() => {
          progress = Math.min(92, progress + 7 + Math.random() * 8);
          fill.style.width = `${progress}%`;
          copy.textContent = steps[Math.min(steps.length - 1, Math.floor(progress / 25))];
        }, 120);

        try {
          const [result] = await Promise.all([
            Promise.resolve().then(work),
            new Promise((resolve) => setTimeout(resolve, 1800)),
          ]);
          clearInterval(progressTimer);
          fill.style.width = "100%";
          copy.textContent = "Analysis outputs ready.";
          await new Promise((resolve) => setTimeout(resolve, 250));
          modal.close();
          return result;
        } catch (error) {
          clearInterval(progressTimer);
          modal.close();
          throw error;
        }
      }

      function showAnalysisTab(group, tabName) {
        document.querySelectorAll(`#${group}AnalysisTabs .tab-button`).forEach((button) => {
          button.classList.toggle("active", button.getAttribute("onclick").includes(`'${tabName}'`));
        });
        document.querySelectorAll(`[id^="${group}-"]`).forEach((panel) => {
          panel.classList.toggle("active", panel.id === `${group}-${tabName}`);
        });
      }

      // show a modal error pop-up (falls back to window.alert if the dialog is absent).
      function showErrorDialog(message, title, asHtml = false) {
        const dialog = document.getElementById("errorDialog");
        if (!dialog) { window.alert(message); return; }
        const titleEl = document.getElementById("errorDialogTitle");
        if (titleEl && title) titleEl.textContent = title;
        const messageEl = document.getElementById("errorDialogMessage");
        if (asHtml) messageEl.innerHTML = message;
        else messageEl.textContent = message;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }

      // safety-stop dialog: shows the reason a run was halted (force spike, force
      // ceiling, or travel limit) with a single Continue button. The actuator has
      // already stopped and homed; onContinue restarts whatever was running.
      let safetyStopOnContinue = null;
      function showSafetyStopDialog(message, onContinue) {
        const dialog = document.getElementById("safetyStopDialog");
        const msgEl = document.getElementById("safetyStopMessage");
        if (!dialog) { if (onContinue) onContinue(); return; }
        if (msgEl) msgEl.textContent = message || "The test was stopped for safety.";
        safetyStopOnContinue = onContinue || null;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      function runSafetyStopContinue() {
        const dialog = document.getElementById("safetyStopDialog");
        if (dialog && dialog.open) dialog.close();
        const cb = safetyStopOnContinue;
        safetyStopOnContinue = null;
        if (cb) cb();
      }

      // two-choice confirm dialog; resolves true (confirm) or false (cancel/close).
      let confirmDialogResolver = null;
      function promptConfirm(message, options) {
        const opts = options || {};
        return new Promise((resolve) => {
          const dialog = document.getElementById("confirmDialog");
          if (!dialog) { resolve(window.confirm(message)); return; }
          document.getElementById("confirmDialogTitle").textContent = opts.title || "Confirm";
          document.getElementById("confirmDialogMessage").textContent = message || "";
          document.getElementById("confirmDialogOk").textContent = opts.confirmLabel || "OK";
          document.getElementById("confirmDialogCancel").textContent = opts.cancelLabel || "Cancel";
          confirmDialogResolver = resolve;
          dialog.showModal();
        });
      }
      function resolveConfirmDialog(value) {
        const dialog = document.getElementById("confirmDialog");
        if (dialog) dialog.close();
        if (confirmDialogResolver) { confirmDialogResolver(!!value); confirmDialogResolver = null; }
      }

      // prompt the user for a required free-text reason (e.g. redoing a run).
      // resolves to the trimmed reason, or null if cancelled / left blank.
      let reasonDialogResolver = null;
      function promptReason(message, title) {
        return new Promise((resolve) => {
          const dialog = document.getElementById("reasonDialog");
          if (!dialog) { resolve((window.prompt(message) || "").trim() || null); return; }
          document.getElementById("reasonDialogTitle").textContent = title || "Reason required";
          document.getElementById("reasonDialogMessage").textContent = message || "";
          const input = document.getElementById("reasonDialogInput");
          input.value = "";
          updateReasonSaveState();   // Save stays disabled until something is typed
          reasonDialogResolver = resolve;
          dialog.showModal();
          setTimeout(() => input.focus(), 0);
        });
      }
      // enable Save only when the reason field has non-whitespace text.
      function updateReasonSaveState() {
        const input = document.getElementById("reasonDialogInput");
        const save = document.getElementById("reasonDialogSave");
        if (save) save.disabled = !(input && input.value.trim());
      }
      function resolveReasonDialog(value) {
        const dialog = document.getElementById("reasonDialog");
        if (dialog) dialog.close();
        if (reasonDialogResolver) {
          const reason = (value || "").trim();
          reasonDialogResolver(reason || null);
          reasonDialogResolver = null;
        }
      }

      // small HTML escaper for user-entered text (redo reasons).
      function escapeRunHtml(text) {
        return String(text == null ? "" : text)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      // build the run-list panel: active runs vs superseded runs (grayed out, with
      // the run that replaced them and the reason). Empty string when there is no
      // run log (e.g. a bundled sample or a folder analyzed without the app).
      function runListHtml(redoInfo) {
        if (!redoInfo || !Array.isArray(redoInfo.all_runs) || !redoInfo.all_runs.length) return "";
        const active = new Set((redoInfo.active_runs || []).map(Number));
        const bySuperseded = {};
        (redoInfo.redos || []).forEach((r) => { bySuperseded[Number(r.superseded_run)] = r; });
        const items = redoInfo.all_runs.slice().map(Number).sort((a, b) => a - b).map((n) => {
          if (active.has(n)) {
            return `<li class="run-item"><span class="run-name">Run ${n}</span><span class="run-tag active">active</span></li>`;
          }
          const r = bySuperseded[n];
          const by = r ? `superseded by Run ${r.new_run}` : "superseded";
          const reason = r && r.reason ? ` - ${escapeRunHtml(r.reason)}` : "";
          return `<li class="run-item superseded"><span class="run-name">Run ${n}</span><span class="run-tag">${by}${reason}</span></li>`;
        }).join("");
        const activeList = (redoInfo.active_runs || []).join(", ");
        return `<div class="run-list-panel">
            <h3 class="run-list-title">Runs</h3>
            <ul class="run-list">${items}</ul>
            <p class="run-list-note">Analysis uses the active runs only${activeList ? ` (${activeList})` : ""}. Superseded runs are kept but not analyzed.</p>
          </div>`;
      }

      // embed the self-contained interactive (Plotly) plots in the analysis
      // window's "Interactive" tab - gives in-app zoom/pan/hover and click-to-
      // comment, served from the same Analysis_Plots.html written to disk.
      function renderInteractivePanel(group, analysis) {
        const panel = document.getElementById(`${group}-interactive`);
        if (!panel) return;
        const htmlPath = analysis && analysis.interactive_html;
        panel.innerHTML = htmlPath
          ? `<iframe class="analysis-iframe" src="/plot-file?path=${encodeURIComponent(htmlPath)}" title="Interactive plots"></iframe>`
          : `<p class="hint">Interactive plots will appear here after analysis runs.</p>`;
      }

      // fill the Fatigue analysis window: a summary stats table plus the
      // interactive Force-vs-Time plot served from the saved Analysis_Plots.html.
      function populateFatigueAnalysis(analysis) {
        renderInteractivePanel("fatigue", analysis);
        const summary = document.getElementById("fatigue-summary");
        if (!summary) return;
        const stats = (analysis && analysis.fatigue && analysis.fatigue.stats) || {};
        const rows = Object.keys(stats).map((key) => [escapeHtml(key), escapeHtml(String(stats[key]))]);
        summary.innerHTML = rows.length
          ? `<h3 class="analysis-section-title">Fatigue summary</h3>${statValueTable(rows)}`
          : `<p class="hint">No fatigue summary found. Expected Fatigue_Stats.xlsx (or .csv) in this folder.</p>`;
      }

      // live reconnect watcher: after a Zaber disconnect, poll the backend to
      // reopen the last known port. On success the actuator is re-homed (its
      // position was unknown after the comms loss) and onReconnect() re-enables the
      // owning test window. Only one watcher runs at a time.
      let reconnectWatchTimer = null;
      function startReconnectWatch(onReconnect) {
        if (reconnectWatchTimer) return;
        reconnectWatchTimer = setInterval(async () => {
          const res = await callApi("/api/zaber-reconnect", {});
          if (res && res.connected === true) {
            stopReconnectWatch();
            if (typeof onReconnect === "function") onReconnect(res);
          }
        }, 2000);
      }
      function stopReconnectWatch() {
        if (reconnectWatchTimer) {
          clearInterval(reconnectWatchTimer);
          reconnectWatchTimer = null;
        }
      }

      function metricCards(metrics) {
        return `
          <div class="stats-table-wrap metric-table-wrap">
            <table class="stats-table metric-table">
              <thead>
                <tr>${metrics.map(([label]) => `<th>${label}</th>`).join("")}</tr>
              </thead>
              <tbody>
                <tr>${metrics.map(([, value, className = ""]) => `<td${className ? ` class="${className}"` : ""}>${value}</td>`).join("")}</tr>
              </tbody>
            </table>
          </div>
        `;
      }

      function statValueTable(rows) {
        return `
          <div class="stats-table-wrap metric-table-wrap">
            <table class="stats-table stat-value-table">
              <thead>
                <tr><th>Stat</th><th>Value</th></tr>
              </thead>
              <tbody>
                ${rows.map(([label, value, className = ""]) => `
                  <tr>
                    <td>${label}</td>
                    <td${className ? ` class="${className}"` : ""}>${value}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      }

      function metricValueTable(rows) {
        return `
          <div class="stats-table-wrap metric-table-wrap">
            <table class="stats-table metric-value-table">
              <thead>
                <tr><th>Metric</th><th>Value</th></tr>
              </thead>
              <tbody>
                ${rows.map(([metric, value, className = ""]) => `
                  <tr>
                    <td>${metric}</td>
                    <td${className ? ` class="${className}"` : ""}>${value}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      }

      function formatShortedChannels(channels) {
        const unique = [...new Set(channels)].sort((a, b) => a - b);
        return unique.length ? unique.map((channel) => `CH${channel}`).join(", ") : "None";
      }

      function formattedDate(date = new Date()) {
        return date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
      }

      // ISO-style date (e.g. 2024-05-07) for the report "Check Date" column.
      function isoDate(date = new Date()) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      function reportPreviewTable(tsvText) {
        const rows = tsvText.split("\n").map((line) => line.split("\t"));
        if (!rows.length) return "";
        const headerRows = rows.slice(0, -1);
        const valueRows = rows.slice(-1);
        return `
          <div class="report-preview-wrap">
            <table class="report-preview-table">
              <thead>
                ${headerRows.map((row) => `
                  <tr>${row.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>
                `).join("")}
              </thead>
              <tbody>
                ${valueRows.map((row) => `
                  <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      }

      async function copyTextToClipboard(text, button) {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const scratch = document.createElement("textarea");
          scratch.value = text;
          scratch.style.position = "fixed";
          scratch.style.opacity = "0";
          document.body.appendChild(scratch);
          scratch.focus();
          scratch.select();
          document.execCommand("copy");
          scratch.remove();
        }
        if (button) {
          const original = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = original;
          }, 1200);
        }
      }

      async function copyReportValues(textareaId, buttonId) {
        const textarea = document.getElementById(textareaId);
        const button = document.getElementById(buttonId);
        if (!textarea) return;
        const lines = textarea.value.split("\n").map((line) => line.trim()).filter(Boolean);
        const valuesOnly = lines[lines.length - 1] || "";
        try {
          await copyTextToClipboard(valuesOnly, button);
        } catch (error) {
          textarea.focus();
          textarea.select();
        }
      }

      function summaryStats(values) {
        const count = values.length || 1;
        const average = values.reduce((sum, value) => sum + value, 0) / count;
        const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / count;
        return {
          min: Math.min(...values),
          max: Math.max(...values),
          average,
          standardDeviation: Math.sqrt(variance),
        };
      }

      function coefficientOfVariation(values) {
        const stats = summaryStats(values);
        return (stats.standardDeviation / Math.max(0.001, Math.abs(stats.average))) * 100;
      }

      function clampForce(value) {
        return Math.min(32, Math.max(0, Number(value || 0)));
      }

      // snap a numeric input to its allowed precision and range. Runs on
      // change/blur (when the user commits a value), NOT on every keystroke, so a
      // partly-typed decimal like "1." is never clobbered mid-edit. decimals = how
      // many places to keep (e.g. 1 -> 0.1 N, 2 -> 0.01 mm/s).
      function normalizeNumberField(id, min, max, decimals) {
        const el = document.getElementById(id);
        if (!el) return;
        const raw = String(el.value).trim();
        if (raw === "" || raw === "-" || raw === "." || raw === "-.") return; // mid-edit, leave it
        let n = Number(raw);
        if (!Number.isFinite(n)) return;
        const f = Math.pow(10, decimals);
        n = Math.round(n * f) / f;                 // round to the allowed precision
        n = Math.min(max, Math.max(min, n));        // clamp into range
        el.value = n;
      }

      function formatDuration(seconds) {
        const totalMinutes = Math.max(1, Math.round(seconds / 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours && minutes) return `${hours} h ${minutes} min`;
        if (hours) return `${hours} h`;
        return `${minutes} min`;
      }

      function drawWaveformSvg(svgId, points, xKey, yKey, xLabel, yLabel, yMin, yMax, xMax) {
        const graph = document.getElementById(svgId);
        const width = 960;
        const height = 340;
        const padLeft = 92;
        const padBottom = 52;
        const padTop = 58;
        const padRight = 24;
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;
        const ySpan = Math.max(1, yMax - yMin);
        const toX = (value) => padLeft + (value / Math.max(1, xMax)) * plotWidth;
        const toY = (value) => height - padBottom - ((value - yMin) / ySpan) * plotHeight;
        const zeroY = toY(0);
        const axisY = height - padBottom;
        const xTicks = xAxisTicks(0, Math.max(1, xMax), toX, axisY, xLabel.toLowerCase().includes("time") ? "s" : "");
        const path = points.map((point, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${toX(point[xKey]).toFixed(2)},${toY(point[yKey]).toFixed(2)}`;
        }).join(" ");
        setGraphHoverPoints(svgId, points.map((point) => ({
          x: toX(point[xKey]),
          y: toY(point[yKey]),
          label: `${xLabel}: ${point[xKey].toFixed(3)}${xLabel.toLowerCase().includes("time") ? " s" : ""}<br>${yLabel}: ${point[yKey].toFixed(3)}`,
        })));

        graph.innerHTML = `
          <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
          <path d="M${padLeft},${padTop} L${padLeft},${height - padBottom} L${width - padRight},${height - padBottom}" fill="none" stroke="#c7d1df" stroke-width="1"></path>
          ${xTicks}
          <line x1="${padLeft}" y1="${zeroY.toFixed(2)}" x2="${width - padRight}" y2="${zeroY.toFixed(2)}" stroke="#e2e8f0" stroke-width="1"></line>
          <text x="${padLeft}" y="20" fill="#697790" font-size="15" font-family="Inter, sans-serif">${yLabel}</text>
          <text x="${width / 2 - 30}" y="${height - 12}" fill="#697790" font-size="15" font-family="Inter, sans-serif">${xLabel}</text>
          <text x="${padLeft - 12}" y="${height - padBottom + 5}" text-anchor="end" fill="#697790" font-size="13" font-family="Inter, sans-serif">${yMin.toFixed(1)}</text>
          <text x="${padLeft - 12}" y="${padTop + 5}" text-anchor="end" fill="#697790" font-size="13" font-family="Inter, sans-serif">${yMax.toFixed(1)}</text>
          <path d="${path}" fill="none" stroke="#3f73e6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
        `;
      }

      function drawMiniGraph(canvasId, points, xKey, yKey, xLabel, yLabel, settings = null) {
        const graph = document.getElementById(canvasId);
        const viewBox = graph.viewBox?.baseVal;
        const width = viewBox?.width || 420;
        const height = viewBox?.height || 260;
        const isAnalysisGraph = canvasId.startsWith("manualAnalysis");
        const padLeft = isAnalysisGraph ? 44 : 58;
        const padRight = isAnalysisGraph ? 8 : 18;
        const padTop = isAnalysisGraph ? 30 : 34;
        const padBottom = isAnalysisGraph ? 38 : 42;
        const data = points.length ? points : [{ [xKey]: 0, [yKey]: 0 }];
        const xValues = data.map((point) => point[xKey]);
        const yValues = data.map((point) => point[yKey]);
        // axis bounds: when a live graph asks for autoScale, a force axis starts at
        // 0 and tops out at least at 5 N (like the other force-over-time graphs),
        // growing with the data, and a capacitance axis tracks a sensible band
        // around the data. Otherwise honor the fixed yMin / yLimit controls.
        const autoScale = !!(settings && settings.autoScale);
        const boundsFor = (key, values) => {
          const lo = Math.min(...values), hi = Math.max(...values);
          if (key === "force") return { min: 0, max: Math.max(5, Math.ceil(hi + 0.5)) };
          if (key === "capacitance") {
            const pad = Math.max(1, (hi - lo) * 0.15);
            let min = Math.floor(lo - pad), max = Math.ceil(hi + pad);
            if (max - min < 5) { const mid = (min + max) / 2; min = mid - 2.5; max = mid + 2.5; }
            return { min, max };
          }
          const pad = Math.max(0.5, (hi - lo) * 0.12);
          return { min: lo - pad, max: hi + pad };
        };
        const xMin = xKey === "time" ? Math.min(...xValues, 0)
          : (autoScale ? boundsFor(xKey, xValues).min : Math.min(...xValues));
        const xMax = xKey === "time"
          ? (settings && !settings.cumulativeTime ? xMin + settings.seconds : Math.max(...xValues, xMin + 1))
          : (autoScale ? boundsFor(xKey, xValues).max : Math.max(...xValues, xMin + 1));
        let yMin, yMax;
        if (autoScale) {
          const b = boundsFor(yKey, yValues);
          yMin = b.min; yMax = b.max;
        } else {
          const rawYMin = Math.min(...yValues);
          const rawYMax = Math.max(...yValues);
          const yPadding = Math.max(0.5, (rawYMax - rawYMin) * 0.12);
          yMin = settings && !settings.autoY && Number.isFinite(settings.yMin) ? settings.yMin : rawYMin - yPadding;
          yMax = settings && !settings.autoY && Number.isFinite(settings.yLimit) ? settings.yLimit : rawYMax + yPadding;
        }
        const xSpan = Math.max(1, xMax - xMin);
        const ySpan = Math.max(1, yMax - yMin);
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;
        const toX = (value) => padLeft + ((value - xMin) / xSpan) * plotWidth;
        const toY = (value) => height - padBottom - ((value - yMin) / ySpan) * plotHeight;
        const axisY = height - padBottom;
        const xTicks = xAxisTicks(xMin, xMax, toX, axisY, xKey === "time" ? "s" : "");
        const path = data.map((point, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${toX(point[xKey]).toFixed(2)},${toY(point[yKey]).toFixed(2)}`;
        }).join(" ");
        const markers = (!settings || settings.showMarkers)
          ? data.map((point) => `<circle cx="${toX(point[xKey]).toFixed(2)}" cy="${toY(point[yKey]).toFixed(2)}" r="3" fill="#3f8b42"></circle>`).join("")
          : "";
        setGraphHoverPoints(canvasId, data.map((point) => ({
          x: toX(point[xKey]),
          y: toY(point[yKey]),
          label: `${xLabel}: ${point[xKey].toFixed(3)}${xKey === "time" ? " s" : ""}<br>${yLabel}: ${point[yKey].toFixed(3)}`,
        })));

        graph.innerHTML = `
          <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
          <path d="M${padLeft},${padTop} L${padLeft},${height - padBottom} L${width - padRight},${height - padBottom}" fill="none" stroke="#c7d1df" stroke-width="1"></path>
          ${xTicks}
          <text x="${padLeft}" y="18" fill="#697790" font-size="13" font-family="Inter, sans-serif">${yLabel}</text>
          <text x="${width / 2 - 24}" y="${height - 10}" fill="#697790" font-size="13" font-family="Inter, sans-serif">${xLabel}</text>
          <text x="${padLeft - 8}" y="${height - padBottom + 4}" text-anchor="end" fill="#697790" font-size="12" font-family="Inter, sans-serif">${yMin.toFixed(1)}</text>
          <text x="${padLeft - 8}" y="${padTop + 4}" text-anchor="end" fill="#697790" font-size="12" font-family="Inter, sans-serif">${yMax.toFixed(1)}</text>
          <path d="${path}" fill="none" stroke="#3f73e6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
          ${markers}
        `;
      }
