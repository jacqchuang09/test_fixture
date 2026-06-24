/*
 * em.js - EM (electromechanical) test window.
 *
 * Owns the EM test modal and its analysis modal. Drives the multi-run EM
 * simulation, records live force readings into a table + graph, and renders
 * the analysis tabs (raw signals, pressure sensitivity, pressure curves,
 * variables of interest, tracker output).
 *
 * Structure:
 *   - Status + table: setEmStatus, setEmState, appendEmTableHeader,
 *     appendEmReading, drawEmForceGraph, appendEmStatus.
 *   - Run control: startEmTest, recordEmForceReading, completeCurrentEmRun,
 *     pauseEmTest, resetEmSimulation, setEmControlsLocked,
 *     resetRedoWorkflowAfterRun, previewForceOverTime.
 *   - Analysis + SVG plots: performEmAnalysis, emRawSignalsSvg,
 *     emPressureSensitivitySvg, emPressureCurveSvg, the per-run render and
 *     tab-toggle helpers, emVariablesOfInterest, emVariablesTable,
 *     emTrackerOutput, populateEmAnalysis.
 *
 * Reads shared.js globals (emReadings, emCurrentRun, emTotalRuns, timers) and
 * shared helpers (setStatePill, callApi, runAnalysisProgress, summaryStats...).
 */


      // redraw the em status box from the saved lines.
      function setEmStatus(lines) {
        emStatusLines = Array.isArray(lines) ? lines : [lines];
        emStatusEl.textContent = emStatusLines.join("\n");
        emStatusEl.scrollTop = emStatusEl.scrollHeight;
      }

      function setEmState(state, message = state, variant = "") {
        setStatePill(emStateEl, state, message === state ? "" : message, variant);
        // don't re-log an identical consecutive state (the poll may set the same
        // WAITING/RUNNING pill every tick); just refresh the pill.
        const line = `${state}: ${message}`;
        if (!(emStatusLines[emStatusLines.length - 1] || "").endsWith(line)) {
          emStatusLines.push(`[${stamp()}] ${line}`);
          setEmStatus(emStatusLines);
        }
      }

      function appendEmTableHeader() {
        emStatusLines.push("Run Number | Time (s) | Force (N)");
        setEmStatus(emStatusLines);
      }

      function appendEmReading(runNumber, timeSeconds, forceNewtons) {
        emStatusLines.push(`Run ${runNumber} | ${timeSeconds.toFixed(3)} s | ${forceNewtons.toFixed(3)} N`);
        setEmStatus(emStatusLines);
      }

      function drawEmForceGraph() {
        const graph = document.getElementById("emForceGraph");
        if (!graph) return;
        const width = 960;
        const height = 330;
        const padLeft = 92;
        const padBottom = 58;
        const padTop = 42;
        const padRight = 24;
        const availableRuns = [...new Set(emReadings.map((point) => point.run))].sort((a, b) => a - b);
        const selectedRun = availableRuns.includes(emCurrentRun) ? emCurrentRun : (availableRuns[availableRuns.length - 1] || emCurrentRun);
        const visibleReadings = emReadings.filter((point) => point.run === selectedRun);
        const data = visibleReadings.length ? visibleReadings : [{ run: selectedRun, time: 0, force: 0 }];
        const runNumbers = [...new Set(data.map((point) => point.run))].sort((a, b) => a - b);
        const colors = ["#3f73e6", "#3f8b42", "#e11955", "#8b5cf6", "#ed6c02", "#0891b2"];
        const maxTime = Math.max(5, ...data.map((point) => point.time));
        const maxForce = Math.max(5, ...data.map((point) => point.force));
        const yMin = 0;
        const yMax = Math.ceil(maxForce + 1);
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;
        const toX = (time) => padLeft + (time / maxTime) * plotWidth;
        const toY = (force) => height - padBottom - ((force - yMin) / (yMax - yMin)) * plotHeight;
        const axisY = height - padBottom;
        const xTicks = xAxisTicks(0, maxTime, toX, axisY, "s");
        const runPaths = runNumbers.map((runNumber, runIndex) => {
          const runData = data.filter((point) => point.run === runNumber);
          const path = runData.map((point, index) => {
            const command = index === 0 ? "M" : "L";
            return `${command}${toX(point.time).toFixed(2)},${toY(point.force).toFixed(2)}`;
          }).join(" ");
          const color = colors[runIndex % colors.length];
          // a dot at every sample (the load cell is read at 100 Hz).
          const markers = runData.length > 1
            ? runData.map((point) => `<circle cx="${toX(point.time).toFixed(2)}" cy="${toY(point.force).toFixed(2)}" r="2" fill="${color}"></circle>`).join("")
            : "";
          return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>${markers}`;
        }).join("");
        const legend = runNumbers.map((runNumber, runIndex) => {
          const x = padLeft + runIndex * 92;
          const color = colors[runIndex % colors.length];
          return `<circle cx="${x}" cy="34" r="5" fill="${color}"></circle><text x="${x + 10}" y="38" fill="#697790" font-size="13" font-family="Inter, sans-serif">Run ${runNumber}</text>`;
        }).join("");
        setGraphHoverPoints("emForceGraph", data.map((point) => ({
          x: toX(point.time),
          y: toY(point.force),
          label: `Run ${point.run}<br>Time: ${point.time.toFixed(3)} s<br>Force: ${point.force.toFixed(3)} N`,
        })));

        graph.innerHTML = `
          <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
          <path d="M${padLeft},${padTop} L${padLeft},${height - padBottom} L${width - padRight},${height - padBottom}" fill="none" stroke="#c7d1df" stroke-width="1"></path>
          ${xTicks}
          <text x="${padLeft}" y="18" fill="#697790" font-size="15" font-family="Inter, sans-serif">Force (N)</text>
          <text x="${width / 2 - 55}" y="${height - 12}" fill="#697790" font-size="15" font-family="Inter, sans-serif">Time (s)</text>
          <text x="${padLeft - 12}" y="${height - padBottom + 5}" text-anchor="end" fill="#697790" font-size="13" font-family="Inter, sans-serif">${yMin.toFixed(0)}</text>
          <text x="${padLeft - 12}" y="${padTop + 5}" text-anchor="end" fill="#697790" font-size="13" font-family="Inter, sans-serif">${yMax.toFixed(0)}</text>
          ${legend}
          ${runPaths}
        `;
      }

      function appendEmStatus(message) {
        emStatusLines.push(`[${stamp()}] ${message}`);
        setEmStatus(emStatusLines);
      }

      function resetEmSimulation() {
        clearInterval(emRunTimer);
        clearTimeout(emReturnHomeTimer);
        emRunTimer = null;
        emReturnHomeTimer = null;
        emCompletedRuns = 0;
        emTotalRuns = config().redo_run ? 1 : Number(config().runs || 3);
        emCurrentRun = config().redo_run ? Number(config().run_to_redo || 1) : 1;
        emReadings = [];
        emStatusLines = [];
        setEmControlsLocked(false);
        document.getElementById("emStartButton").disabled = false;
        document.getElementById("emPauseButton").disabled = true;
        document.getElementById("emAnalysisButton").disabled = true;
        drawEmForceGraph();
      }

      function setEmControlsLocked(isLocked) {
        ["emStartButton", "emPauseButton", "emAnalysisButton", "emTestCloseButton"].forEach((id) => {
          const element = document.getElementById(id);
          if (element) element.disabled = isLocked;
        });
      }

      function resetRedoWorkflowAfterRun() {
        if (document.getElementById("redoRun").dataset.lockedByExistingFolder !== "true") return;
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = "";
        saveFolderInput.dataset.existingTestAction = "";
        document.getElementById("redoRun").checked = false;
        document.getElementById("redoRun").dataset.lockedByExistingFolder = "";
        document.getElementById("runToRedo").value = "";
        document.getElementById("runToRedo").dataset.availableRuns = "";
        document.getElementById("testType").disabled = false;
        document.getElementById("testType").value = "EM";
        document.getElementById("runs").value = 3;
        updateTestConfigState();
        scheduleExistingTestCheck();
      }

      // start one real EM press on the backend (real FUTEK + Zaber on Windows, or
      // the coupled simulator on a machine with no rig), then poll for live force.
      async function startEmTest() {
        if (emRunTimer || emReturnHomeTimer) return;

        // Start Test hard gate: on a real rig, require a live Zaber connection
        // before any motion. Stays soft in simulation (no real load cell).
        if (!(await zaberStartGateOk())) return;

        // Redo mode: data is never overwritten - this creates a NEW run that
        // supersedes the chosen one. A reason is required (recorded in the report).
        const cfg = config();
        let redoOf = null;
        let redoReason = null;
        if (cfg.redo_run && cfg.run_to_redo) {
          redoReason = await promptReason(
            `You're redoing run ${cfg.run_to_redo}. This creates a new run that replaces it in the analysis (run ${cfg.run_to_redo} is kept but no longer used). Enter why:`,
            "Reason for redo");
          if (!redoReason) {
            setEmState("BETWEEN_RUNS_PAUSED", "redo cancelled - a reason is required to redo a run.");
            return;
          }
          redoOf = cfg.run_to_redo;
        }

        document.getElementById("emStartButton").disabled = true;
        document.getElementById("emPauseButton").disabled = false;
        document.getElementById("emAnalysisButton").disabled = true;
        document.getElementById("emTestCloseButton").disabled = true;

        emRunStartedAt = performance.now();
        // the actuator + load cell take a moment to initialize; show a clear wait
        // state (controls already locked above) until the run actually starts.
        setStatePill("emState", "WAITING TO START", "initializing actuator and load cell - please wait…");

        const result = await callApi("/api/start-run", { run_number: emCurrentRun, redo_of: redoOf, reason: redoReason });
        if (!result || !result.ok) {
          document.getElementById("emStartButton").disabled = false;
          document.getElementById("emPauseButton").disabled = true;
          document.getElementById("emTestCloseButton").disabled = false;
          setEmState("BETWEEN_RUNS_PAUSED", (result && result.message) || "could not start run.");
          return;
        }
        // a redo creates a NEW run - adopt the run number the backend actually
        // assigned so the collected readings are tagged correctly (e.g. redoing
        // run 2 records the data as run 4, not run 2).
        if (Number.isFinite(Number(result.run_number))) {
          emCurrentRun = Number(result.run_number);
        }
        // remember the NEW run number for a redo so completion can tell the operator
        // exactly what to name the capacitance file (a redo of run 2 saves as run 4).
        emRedoNewRun = redoOf ? emCurrentRun : null;
        // the poll flips WAITING TO START -> RUNNING once the actuator actually moves.
        // clear any prior readings for THIS run number (e.g. a repeat after a pause).
        emReadings = emReadings.filter((point) => point.run !== emCurrentRun);
        emRunTimer = setInterval(pollRunStatus, 100);
      }

      // poll the backend run for live force/position and react to run completion.
      async function pollRunStatus() {
        const status = await callApi("/api/run-status");
        if (!status || !status.ok) return;
        if (status.status === "waiting") {
          // command accepted but the actuator hasn't started moving yet (load-cell init).
          setStatePill("emState", "WAITING TO START", "initializing actuator and load cell - please wait…");
          return;
        }
        const elapsed = Number(status.elapsed || 0);
        const force = Number(status.force || 0);
        if (status.status === "running") {
          setStatePill("emState", "RUNNING", `run ${emCurrentRun} running.`);
        }
        if (status.status === "running" || status.status === "completed") {
          // rebuild this run's readings from the backend's dense 100 Hz trace so
          // the live force graph is smooth (not one point per poll).
          if (Array.isArray(status.trace) && status.trace.length) {
            emReadings = emReadings.filter((point) => point.run !== emCurrentRun);
            for (const point of status.trace) {
              emReadings.push({ run: emCurrentRun, time: point[0], force: point[1] });
            }
          } else {
            emReadings.push({ run: emCurrentRun, time: elapsed, force });
          }
          appendEmReading(emCurrentRun, elapsed, force);
          drawEmForceGraph();
        }
        if (status.status === "completed") {
          clearInterval(emRunTimer); emRunTimer = null;
          completeCurrentEmRun();
        } else if (status.status === "paused") {
          clearInterval(emRunTimer); emRunTimer = null;
          handleRunPaused(status.message);
        } else if (status.status === "stopped" || status.status === "error") {
          clearInterval(emRunTimer); emRunTimer = null;
          setEmControlsLocked(false);
          document.getElementById("emPauseButton").disabled = true;
          document.getElementById("emTestCloseButton").disabled = false;
          if (status.disconnect) {
            // no auto-reconnect: the operator moves the actuator back to home with the
            // Zaber Launcher, reconnects, then restarts. Leave Start enabled for that.
            document.getElementById("emStartButton").disabled = false;
            setEmState("DISCONNECTED", status.message || "Actuator connection lost.", "discarded");
            showDisconnectDialog(status.message);
          } else if (status.safety_stop) {
            // safety trip (force spike / ceiling / travel limit): the engine already
            // stopped and returned home. Pop a dialog; on Continue, restart THIS run
            // (same run number, fresh data collection).
            document.getElementById("emStartButton").disabled = false;
            setEmState("STOPPED - NOT SAVED", status.message || "Run stopped for safety.", "discarded");
            showSafetyStopDialog(status.message);   // no auto-restart - actuator homed; press Start to redo the run
          } else {
            // a manual stop: this run's data was not saved, so use the same amber
            // "discarded" language.
            document.getElementById("emStartButton").disabled = false;
            setEmState("STOPPED - NOT SAVED",
              `${status.message || "Run stopped."} This run's data was discarded - press Start to redo run ${emCurrentRun}.`,
              "discarded");
          }
        }
      }

      // restart the current run after a safety stop: same run number, fresh data,
      // no redo/supersession. The engine has already homed; this re-approaches.
      async function restartCurrentEmRun() {
        if (emRunTimer || emReturnHomeTimer) return;
        if (!(await zaberStartGateOk())) { document.getElementById("emStartButton").disabled = false; return; }
        document.getElementById("emStartButton").disabled = true;
        document.getElementById("emPauseButton").disabled = false;
        document.getElementById("emAnalysisButton").disabled = true;
        document.getElementById("emTestCloseButton").disabled = true;
        emRunStartedAt = performance.now();
        setEmState("RUNNING", `restarting run ${emCurrentRun} after a safety stop...`);
        const result = await callApi("/api/start-run", { run_number: emCurrentRun });
        if (!result || !result.ok) {
          document.getElementById("emStartButton").disabled = false;
          document.getElementById("emPauseButton").disabled = true;
          document.getElementById("emTestCloseButton").disabled = false;
          setEmState("STOPPED - NOT SAVED", (result && result.message) || "could not restart run.", "discarded");
          return;
        }
        if (Number.isFinite(Number(result.run_number))) emCurrentRun = Number(result.run_number);
        emReadings = emReadings.filter((point) => point.run !== emCurrentRun);
        emRunTimer = setInterval(pollRunStatus, 100);
      }

      function handleRunPaused(message) {
        setEmControlsLocked(false);
        document.getElementById("emStartButton").disabled = false;
        document.getElementById("emPauseButton").disabled = true;
        document.getElementById("emTestCloseButton").disabled = false;
        document.getElementById("emAnalysisButton").disabled = emCompletedRuns < emTotalRuns;
        // user pressed Pause mid-run: the backend discarded this run's partial data,
        // so it must be repeated. Amber pill makes "nothing was saved" unmistakable.
        setEmState("PAUSED - NOT SAVED",
          `Run ${emCurrentRun} paused by you. This run's data was discarded - press Start to redo run ${emCurrentRun}.`,
          "discarded");
      }

      function completeCurrentEmRun() {
        clearInterval(emRunTimer);
        emRunTimer = null;
        emCompletedRuns += 1;
        document.getElementById("emPauseButton").disabled = true;
        document.getElementById("emTestCloseButton").disabled = false;

        if (emCompletedRuns >= emTotalRuns) {
          document.getElementById("emStartButton").disabled = true;
          document.getElementById("emAnalysisButton").disabled = false;
          setEmState("COMPLETED", `all ${emTotalRuns} run(s) completed and saved. perform analysis is now available.`, "kept");
          resetRedoWorkflowAfterRun();
          // a redo saves under a NEW run number; tell the operator the exact CAP
          // filename to add (named for the new run, not the one they redid).
          if (emRedoNewRun) {
            const n = emRedoNewRun;
            emRedoNewRun = null;
            showErrorDialog(
              `This redo was saved as run ${n} (not the run you redid). Before running analysis, ` +
              `rename its capacitance file to exactly "Run ${n}.csv" and add it to the test folder's CAP folder.`,
              `Add the capacitance file for run ${n}`);
          }
          return;
        }

        // run finished normally: the backend already saved its data. This is an
        // automatic pause between runs, NOT a discard. Green pill + "saved" wording
        // so it is never confused with a user Pause (which discards the run).
        setEmState("RUN SAVED - PAUSED",
          `Run ${emCurrentRun} complete and saved. Auto-paused before run ${emCurrentRun + 1} - press Start when ready.`,
          "kept");
        emCurrentRun += 1;
        document.getElementById("emStartButton").disabled = false;
        drawEmForceGraph();
      }

      async function pauseEmTest() {
        // ask the backend to stop the press and return home; the poll loop sees
        // the 'paused' status and re-enables Start to repeat the run.
        document.getElementById("emPauseButton").disabled = true;
        setEmState("RETURNING_HOME", "actuator stopping and returning to home position...");
        await callApi("/api/pause");
      }

      // Closing the EM test window: blocked while a run is physically in progress,
      // and otherwise it tells the backend to stop/reset so the engine is never left
      // thinking a test is still running (which would block the next test).
      async function closeEmTestWindow() {
        if (emRunTimer || emReturnHomeTimer) {
          showErrorDialog(
            "A run is in progress. Pause the run before closing the test window.",
            "Test in progress");
          return;
        }
        stopReconnectWatch();
        await callApi("/api/stop", {});
        emTestModal.close();
      }

      async function performEmAnalysis() {
        appendEmStatus("starting em analysis...");
        document.getElementById("emAnalysisButton").disabled = true;
        const result = await runAnalysisProgress("Generating EM analysis outputs...", () => callApi("/api/perform-analysis"));
        document.getElementById("emAnalysisButton").disabled = false;
        // missing capacitance (or other failure): show the message and stop, rather
        // than opening an empty analysis window.
        if (!result || !result.ok) {
          const msg = (result && result.message) || "EM analysis could not run.";
          appendEmStatus(msg);
          showErrorDialog(msg, "Capacitance data needed");
          return;
        }
        populateEmAnalysis(result.message || "em analysis completed.", result.analysis || null);
        emAnalysisModal.showModal();
      }

      // TODO: replace with real per-channel capacitance readings once the CAP
      // sensor is wired up. Until then, EM analysis tabs synthesize channel
      // values from force data so they still render. The on-disk CAP files
      // written by the Python analyzer ARE the source of truth - this is a
      // browser-side preview only.
      function emChannelValue(point, channel) {
        // use the REAL per-channel capacitance the backend attached from the CAP
        // files when present; otherwise synthesize a preview value from force.
        if (point && Array.isArray(point.channels) && point.channels.length >= channel) {
          return Number(point.channels[channel - 1]) || 0;
        }
        const channelScale = 0.82 + channel * 0.055;
        const runOffset = (point.run - 1) * 0.18;
        const ripple = Math.sin(point.time * (0.9 + channel * 0.08)) * 0.22;
        return 18 + point.force * channelScale + runOffset + ripple;
      }

      function emAnalysisPlotSvg(readings, mode = "raw") {
        const width = 1040;
        const height = 340;
        const padLeft = 72;
        const padRight = 26;
        const padTop = 38;
        const padBottom = 54;
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;
        const startTime = Math.min(...readings.map((point) => point.time), 0);
        const maxTime = Math.max(5, ...readings.map((point) => point.time));
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const allValues = channels.flatMap((channel) => readings.map((point) => (
          mode === "pressure" ? emChannelValue(point, channel) / 8 : emChannelValue(point, channel)
        )));
        const yMin = Math.floor(Math.min(...allValues, 0));
        const yMax = Math.ceil(Math.max(...allValues, 5));
        const ySpan = Math.max(1, yMax - yMin);
        const toX = (time) => padLeft + ((time - startTime) / Math.max(1, maxTime - startTime)) * plotWidth;
        const toY = (value) => height - padBottom - ((value - yMin) / ySpan) * plotHeight;
        const xTicks = xAxisTicks(startTime, maxTime, toX, height - padBottom, "s");
        const colors = ["#3f73e6", "#3f8b42", "#e11955", "#8b5cf6", "#ed6c02", "#0891b2", "#4f46e5", "#64748b"];
        const paths = channels.map((channel, index) => {
          const pressureValues = readings.map((point) => emChannelValue(point, channel) / 8);
          const values = readings.map((point) => {
            if (mode === "pressure" || mode === "pressureDerivative") return emChannelValue(point, channel) / 8;
            return emChannelValue(point, channel);
          });
          const path = readings.map((point, pointIndex) => {
            const value = values[pointIndex];
            return `${pointIndex === 0 ? "M" : "L"}${toX(point.time).toFixed(2)},${toY(value).toFixed(2)}`;
          }).join(" ");
          const derivativePath = readings.slice(1).map((point, pointIndex) => {
            const previous = readings[pointIndex];
            const dt = Math.max(0.001, point.time - previous.time);
            const derivative = (pressureValues[pointIndex + 1] - pressureValues[pointIndex]) / dt;
            const scaledDerivative = yMin + Math.min(ySpan, Math.max(0, Math.abs(derivative) * 2.2));
            return `${pointIndex === 0 ? "M" : "L"}${toX(point.time).toFixed(2)},${toY(scaledDerivative).toFixed(2)}`;
          }).join(" ");
          const legendX = padLeft + index * 92;
          const stroke = mode === "pressureDerivative" ? "#3f73e6" : colors[index];
          return `
            <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="${mode === "pressureDerivative" ? "0.55" : "1"}"></path>
            ${mode === "pressureDerivative" ? `<path d="${derivativePath}" fill="none" stroke="#f28c28" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"></path>` : ""}
            <circle cx="${legendX}" cy="24" r="5" fill="${stroke}"></circle>
            <text x="${legendX + 10}" y="28" fill="#697790" font-size="12" font-family="Inter, sans-serif">CH ${channel}</text>
          `;
        }).join("");
        return `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="EM ${mode} analysis plot">
            <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
            <path d="M${padLeft},${padTop} L${padLeft},${height - padBottom} L${width - padRight},${height - padBottom}" fill="none" stroke="#c7d1df" stroke-width="1"></path>
            ${xTicks}
            <text x="${padLeft}" y="18" fill="#697790" font-size="14" font-family="Inter, sans-serif">${mode === "raw" ? "Capacitance / Raw Signal" : "Pressure Sensitivity"}</text>
            ${mode === "pressureDerivative" ? `<text x="${width - 238}" y="28" fill="#f28c28" font-size="13" font-family="Inter, sans-serif">orange = 1st derivative / inflection peak</text>` : ""}
            <text x="${width / 2 - 38}" y="${height - 10}" fill="#697790" font-size="14" font-family="Inter, sans-serif">Time (s)</text>
            <text x="${padLeft - 10}" y="${height - padBottom + 4}" text-anchor="end" fill="#697790" font-size="12" font-family="Inter, sans-serif">${yMin}</text>
            <text x="${padLeft - 10}" y="${padTop + 4}" text-anchor="end" fill="#697790" font-size="12" font-family="Inter, sans-serif">${yMax}</text>
            ${paths}
          </svg>
        `;
      }

      function emPressureKpa(point) {
        const surfaceArea = Math.max(1, Number.parseFloat(document.getElementById("surfaceArea").value || "325"));
        return (point.force / surfaceArea) * 1000;
      }

      // ---- real-data renderers (Emilio's plot logic) ----
      // These draw the actual computed curves returned by the python EM engine
      // (emPlotData) using the same structure as the matplotlib figures. They are
      // used by the analysis tabs whenever emPlotData is present; otherwise the
      // synthetic preview renderers below run instead.

      const EM_RUN_COLORS = ["#3f73e6", "#ff7a45", "#ffd43b", "#22c55e", "#8b5cf6", "#0891b2", "#e11955", "#94a3b8"];
      const EM_CH_COLORS = ["#67d7ff", "#8cf07e", "#67d7ff", "#8cf07e", "#67d7ff", "#8cf07e", "#67d7ff", "#8cf07e"];

      // build a URL to a generated matplotlib PNG served by the python backend.
      function emPlotImgUrl(path) {
        return `/plot-file?path=${encodeURIComponent(path)}`;
      }
      function emPngImg(path, alt) {
        return `<img class="em-analysis-png" src="${emPlotImgUrl(path)}" alt="${escapeHtml(alt || "analysis plot")}" loading="lazy" />`;
      }

      function emExtent(values, fallbackMin, fallbackMax) {
        const clean = values.filter((v) => v != null && Number.isFinite(v));
        if (!clean.length) return [fallbackMin, fallbackMax];
        let lo = Math.min(...clean);
        let hi = Math.max(...clean);
        if (lo === hi) { lo -= 1; hi += 1; }
        return [lo, hi];
      }

      function emPathFromPairs(pairs, toX, toY) {
        let started = false;
        const cmds = [];
        pairs.forEach(([x, y]) => {
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) { started = false; return; }
          cmds.push(`${started ? "L" : "M"}${toX(x).toFixed(2)},${toY(y).toFixed(2)}`);
          started = true;
        });
        return cmds.join(" ");
      }

      // Generic dark-theme panel grid. Each panel:
      //   { title, xlabel, ylabel, ylabelR, xRange, yRange, yRangeR,
      //     series:[{pairs,stroke,width,axis:'L'|'R',dash,opacity}],
      //     markers:[{x,y,axis,color,r,stroke}], legend:[{label,color}] }
      function emGridSvg(panels, { columns, panelWidth, panelHeight, ariaLabel }) {
        const rows = Math.ceil(panels.length / columns);
        const width = columns * panelWidth;
        const height = rows * panelHeight;
        const padL = 50;
        const padR = 48;
        const padT = 34;
        const padB = 42;

        const content = panels.map((panel, index) => {
          const col = index % columns;
          const row = Math.floor(index / columns);
          const x0 = col * panelWidth;
          const y0 = row * panelHeight;
          const plotW = panelWidth - padL - padR;
          const plotH = panelHeight - padT - padB;
          const [xmin, xmax] = panel.xRange;
          const [ymin, ymax] = panel.yRange;
          const xSpan = (xmax - xmin) || 1;
          const ySpan = (ymax - ymin) || 1;
          const toX = (x) => x0 + padL + ((x - xmin) / xSpan) * plotW;
          const toYL = (y) => y0 + panelHeight - padB - ((y - ymin) / ySpan) * plotH;
          let toYR = toYL;
          if (panel.yRangeR) {
            const [rmin, rmax] = panel.yRangeR;
            const rSpan = (rmax - rmin) || 1;
            toYR = (y) => y0 + panelHeight - padB - ((y - rmin) / rSpan) * plotH;
          }
          const toY = (axis) => (axis === "R" ? toYR : toYL);

          const seriesSvg = (panel.series || []).map((s) => {
            const d = emPathFromPairs(s.pairs, toX, toY(s.axis));
            if (!d) return "";
            return `<path d="${d}" fill="none" stroke="${s.stroke}" stroke-width="${s.width || 2}" opacity="${s.opacity == null ? 1 : s.opacity}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linecap="round" stroke-linejoin="round"></path>`;
          }).join("");

          const markersSvg = (panel.markers || []).map((m) => (
            `<circle cx="${toX(m.x).toFixed(2)}" cy="${toY(m.axis)(m.y).toFixed(2)}" r="${m.r || 5}" fill="${m.color}" stroke="${m.stroke || "#111827"}" stroke-width="1.5"></circle>`
          )).join("");

          const xTicks = [xmin, (xmin + xmax) / 2, xmax].map((t) => {
            const x = toX(t);
            const y = y0 + panelHeight - padB;
            return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 4}" stroke="#5b5b5b"></line><text x="${x}" y="${y + 16}" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="Inter, sans-serif">${(+t).toFixed(t >= 10 ? 0 : 1)}</text>`;
          }).join("");
          const yTicks = [ymin, (ymin + ymax) / 2, ymax].map((t) => {
            const y = toYL(t);
            return `<line x1="${x0 + padL - 4}" y1="${y}" x2="${x0 + padL}" y2="${y}" stroke="#5b5b5b"></line><text x="${x0 + padL - 7}" y="${y + 4}" text-anchor="end" fill="#67d7ff" font-size="10" font-family="Inter, sans-serif">${(+t).toFixed(2)}</text>`;
          }).join("");
          const yTicksR = panel.yRangeR ? [panel.yRangeR[0], (panel.yRangeR[0] + panel.yRangeR[1]) / 2, panel.yRangeR[1]].map((t) => {
            const y = toYR(t);
            return `<text x="${x0 + panelWidth - padR + 7}" y="${y + 4}" text-anchor="start" fill="#f28c28" font-size="10" font-family="Inter, sans-serif">${(+t).toFixed(2)}</text>`;
          }).join("") : "";

          const legendSvg = (panel.legend || []).map((item, li) => {
            const lx = x0 + panelWidth - padR - 84;
            const ly = y0 + padT + 6 + li * 14;
            return `<line x1="${lx}" y1="${ly}" x2="${lx + 20}" y2="${ly}" stroke="${item.color}" stroke-width="2.6"></line><text x="${lx + 25}" y="${ly + 4}" fill="#e2e8f0" font-size="10" font-family="Inter, sans-serif">${item.label}</text>`;
          }).join("");

          return `
            <rect x="${x0}" y="${y0}" width="${panelWidth}" height="${panelHeight}" fill="#272727"></rect>
            <path d="M${x0 + padL},${y0 + padT} L${x0 + padL},${y0 + panelHeight - padB} L${x0 + panelWidth - padR},${y0 + panelHeight - padB}" fill="none" stroke="#9aa3b2" stroke-width="1.1"></path>
            ${panel.yRangeR ? `<path d="M${x0 + panelWidth - padR},${y0 + padT} L${x0 + panelWidth - padR},${y0 + panelHeight - padB}" fill="none" stroke="#f28c28" stroke-width="1"></path>` : ""}
            <text x="${x0 + panelWidth / 2}" y="${y0 + 20}" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="800" font-family="Inter, sans-serif">${panel.title}</text>
            <text x="${x0 + 12}" y="${y0 + panelHeight / 2}" transform="rotate(-90 ${x0 + 12} ${y0 + panelHeight / 2})" text-anchor="middle" fill="#67d7ff" font-size="10" font-family="Inter, sans-serif">${panel.ylabel || ""}</text>
            ${panel.ylabelR ? `<text x="${x0 + panelWidth - 8}" y="${y0 + panelHeight / 2}" transform="rotate(90 ${x0 + panelWidth - 8} ${y0 + panelHeight / 2})" text-anchor="middle" fill="#f28c28" font-size="10" font-family="Inter, sans-serif">${panel.ylabelR}</text>` : ""}
            <text x="${x0 + panelWidth / 2}" y="${y0 + panelHeight - 7}" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="Inter, sans-serif">${panel.xlabel || ""}</text>
            ${xTicks}${yTicks}${yTicksR}
            ${seriesSvg}${markersSvg}${legendSvg}
          `;
        }).join("");

        return `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel || "EM analysis"}">
            <rect x="0" y="0" width="${width}" height="${height}" fill="#1f1f1f"></rect>
            ${content}
          </svg>
        `;
      }

      // Pressure Sensitivity tab, one run -> mirrors "PS curve all CHs number #N":
      // 2x4 grid, per channel CAP-vs-pressure (blue) + 1st derivative (orange) +
      // inflection markers.
      function emRealPressureSensitivitySvg(runData) {
        const pressure = runData.pressure;
        const panels = runData.channels.map((ch, j) => {
          const capPairs = pressure.map((p, k) => [p, ch.cap[k]]);
          const derivPairs = ch.deriv_x.map((p, k) => [p, ch.deriv[k]]);
          const xRange = emExtent(pressure, 0, 45);
          const yRange = emExtent(ch.cap, 0, 1);
          const yRangeR = [0, Math.max(0.0001, ...ch.deriv.filter((v) => v != null && Number.isFinite(v)))];
          const series = [
            { pairs: capPairs, stroke: "#67d7ff", width: 2.4, axis: "L" },
            { pairs: derivPairs, stroke: "#f28c28", width: 1.8, axis: "R" },
          ];
          const markers = [];
          if (ch.infl) {
            markers.push({ x: ch.infl.kpa, y: ch.infl.cap, axis: "L", color: "#ef4444", r: 6, stroke: "#ffffff" });
            markers.push({ x: ch.infl.kpa, y: ch.infl.ps, axis: "R", color: "#111827", r: 4, stroke: "#f28c28" });
          }
          const inflLabel = ch.infl ? ` | PS=${ch.infl.ps.toFixed(3)} @ ${ch.infl.kpa.toFixed(1)} kPa` : " | no inflection";
          return {
            title: `Run# ${runData.run} - CH ${j + 1}${inflLabel}`,
            xlabel: "Pressure (kPa)", ylabel: "Change in CAP (pF)", ylabelR: "1st deriv (pF/kPa)",
            xRange, yRange, yRangeR, series, markers,
          };
        });
        return emGridSvg(panels, { columns: 4, panelWidth: 300, panelHeight: 230, ariaLabel: `Pressure sensitivity run ${runData.run}` });
      }

      // Raw Signals tab, one run -> mirrors "Raw Signal_Run #N_CHk": per channel,
      // CAP (pF) vs time (blue) with synced pressure vs time (orange, right axis).
      function emRealRawSignalsSvg(runData) {
        const time = runData.raw.time;
        const pressure = runData.raw.pressure;
        const xRange = emExtent(time, 0, 1);
        const pRange = [0, Math.max(0.0001, ...pressure.filter((v) => v != null && Number.isFinite(v)))];
        const panels = runData.raw.cap.map((capSeries, j) => {
          const capPairs = time.map((t, k) => [t, capSeries[k]]);
          const pressurePairs = time.map((t, k) => [t, pressure[k]]);
          return {
            title: `Run ${runData.run} CH ${j + 1}`,
            xlabel: "Time (s)", ylabel: "Change in CAP (pF)", ylabelR: "Pressure (kPa)",
            xRange, yRange: emExtent(capSeries, 0, 1), yRangeR: pRange,
            series: [
              { pairs: capPairs, stroke: EM_CH_COLORS[j], width: 2.6, axis: "L" },
              { pairs: pressurePairs, stroke: "#f28c28", width: 1.6, axis: "R", dash: "8 6", opacity: 0.85 },
            ],
          };
        });
        return emGridSvg(panels, { columns: 4, panelWidth: 300, panelHeight: 230, ariaLabel: `Raw signals run ${runData.run}` });
      }

      // All Channels/Runs tab:
      //  - "channel": one panel per channel, all runs overlaid (PS curves all run per CH)
      //  - "run":     one panel per run, all channels overlaid (PS curves all ch per run)
      function emRealAllChannelsSvg(viewMode) {
        const runs = emPlotData.runs;
        const channelCount = emPlotData.channels;
        if (viewMode === "run") {
          const panels = runs.map((rd) => {
            const xRange = emExtent(rd.pressure, 0, 45);
            const allCap = rd.channels.flatMap((c) => c.cap);
            return {
              title: `Run ${rd.run}`,
              xlabel: "Pressure (kPa)", ylabel: "Change in CAP (pF)",
              xRange, yRange: emExtent(allCap, 0, 1),
              series: rd.channels.map((c, j) => ({ pairs: rd.pressure.map((p, k) => [p, c.cap[k]]), stroke: EM_RUN_COLORS[j % EM_RUN_COLORS.length], width: 2.2, axis: "L" })),
              legend: rd.channels.map((c, j) => ({ label: `CH ${j + 1}`, color: EM_RUN_COLORS[j % EM_RUN_COLORS.length] })),
            };
          });
          return emGridSvg(panels, { columns: Math.min(3, Math.max(1, runs.length)), panelWidth: 320, panelHeight: 250, ariaLabel: "PS curves all channels per run" });
        }
        const panels = Array.from({ length: channelCount }, (_, j) => {
          const allPressure = runs.flatMap((rd) => rd.pressure);
          const allCap = runs.flatMap((rd) => rd.channels[j].cap);
          return {
            title: `CH ${j + 1}`,
            xlabel: "Pressure (kPa)", ylabel: "Change in CAP (pF)",
            xRange: emExtent(allPressure, 0, 45), yRange: emExtent(allCap, 0, 1),
            series: runs.map((rd) => ({ pairs: rd.pressure.map((p, k) => [p, rd.channels[j].cap[k]]), stroke: EM_RUN_COLORS[(rd.run - 1) % EM_RUN_COLORS.length], width: 2.2, axis: "L" })),
            legend: runs.map((rd) => ({ label: `Run ${rd.run}`, color: EM_RUN_COLORS[(rd.run - 1) % EM_RUN_COLORS.length] })),
          };
        });
        return emGridSvg(panels, { columns: 4, panelWidth: 300, panelHeight: 230, ariaLabel: "PS curves all runs per channel" });
      }

      function emRawSignalsSvg(readings, runNumber = 1) {
        if (emPlotData) {
          const runData = emPlotData.runs.find((r) => r.run === runNumber);
          if (runData) return emRealRawSignalsSvg(runData);
        }
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const runReadings = readings.filter((point) => point.run === runNumber);
        const source = runReadings.length ? runReadings : readings;
        const panelWidth = 260;
        const panelHeight = 205;
        const columns = 4;
        const width = columns * panelWidth;
        const height = 2 * panelHeight;
        const padLeft = 44;
        const padRight = 38;
        const padTop = 32;
        const padBottom = 38;
        const maxPressure = Math.max(10, ...source.map((point) => emPressureKpa(point)));
        const maxForce = Math.max(1, ...source.map((point) => point.force));
        const orange = "#ffbd66";
        const channelColors = ["#84d6ff", "#8cf07e", "#84d6ff", "#8cf07e", "#84d6ff", "#8cf07e", "#84d6ff", "#8cf07e"];

        const panelContent = channels.map((channel, index) => {
          const col = index % columns;
          const row = Math.floor(index / columns);
          const x0 = col * panelWidth;
          const y0 = row * panelHeight;
          const plotWidth = panelWidth - padLeft - padRight;
          const plotHeight = panelHeight - padTop - padBottom;
          const toX = (pressure) => x0 + padLeft + (pressure / maxPressure) * plotWidth;
          const toCapY = (cap) => y0 + panelHeight - padBottom - (cap / 5) * plotHeight;
          const toForceY = (force) => y0 + panelHeight - padBottom - (force / maxForce) * plotHeight;
          const pressureValues = source.map((point) => emPressureKpa(point));
          const capValues = source.map((point) => Math.min(5, Math.max(0, (emChannelValue(point, channel) - 18) / 2.4)));
          const capPath = source.map((point, pointIndex) => {
            return `${pointIndex === 0 ? "M" : "L"}${toX(pressureValues[pointIndex]).toFixed(2)},${toCapY(capValues[pointIndex]).toFixed(2)}`;
          }).join(" ");
          const forcePath = source.map((point, pointIndex) => {
            return `${pointIndex === 0 ? "M" : "L"}${toX(pressureValues[pointIndex]).toFixed(2)},${toForceY(point.force).toFixed(2)}`;
          }).join(" ");
          const xTicks = [0, Math.round(maxPressure / 2), Math.round(maxPressure)].map((tick) => {
            const x = toX(tick);
            const y = y0 + panelHeight - padBottom;
            return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 4}" stroke="#e5e7eb"></line><text x="${x}" y="${y + 17}" text-anchor="middle" fill="#f8fafc" font-size="10" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          const yTicks = [0, 2.5, 5].map((tick) => {
            const y = toCapY(tick);
            return `<line x1="${x0 + padLeft - 4}" y1="${y}" x2="${x0 + padLeft}" y2="${y}" stroke="#e5e7eb"></line><text x="${x0 + padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#f8fafc" font-size="10" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          const forceTicks = [0, Math.round(maxForce / 2), Math.round(maxForce)].map((tick) => {
            const y = toForceY(tick);
            return `<text x="${x0 + panelWidth - 10}" y="${y + 4}" text-anchor="end" fill="${orange}" font-size="10" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          return `
            <rect x="${x0}" y="${y0}" width="${panelWidth}" height="${panelHeight}" fill="#272727"></rect>
            <path d="M${x0 + padLeft},${y0 + padTop} L${x0 + padLeft},${y0 + panelHeight - padBottom} L${x0 + panelWidth - padRight},${y0 + panelHeight - padBottom}" fill="none" stroke="#e5e7eb" stroke-width="1.2"></path>
            <path d="M${x0 + panelWidth - padRight},${y0 + padTop} L${x0 + panelWidth - padRight},${y0 + panelHeight - padBottom}" fill="none" stroke="${orange}" stroke-width="1"></path>
            <g opacity="0.18">
              <line x1="${x0 + padLeft}" y1="${toCapY(2.5)}" x2="${x0 + panelWidth - padRight}" y2="${toCapY(2.5)}" stroke="#f8fafc"></line>
              <line x1="${toX(maxPressure / 2)}" y1="${y0 + padTop}" x2="${toX(maxPressure / 2)}" y2="${y0 + panelHeight - padBottom}" stroke="#f8fafc"></line>
            </g>
            <text x="${x0 + panelWidth / 2}" y="${y0 + 22}" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="900" font-family="Inter, sans-serif">Run ${runNumber} CH ${channel}</text>
            <text x="${x0 + 13}" y="${y0 + panelHeight / 2}" transform="rotate(-90 ${x0 + 13} ${y0 + panelHeight / 2})" text-anchor="middle" fill="${channelColors[index]}" font-size="11" font-family="Inter, sans-serif">CAP (pF)</text>
            <text x="${x0 + panelWidth - 9}" y="${y0 + panelHeight / 2}" transform="rotate(90 ${x0 + panelWidth - 9} ${y0 + panelHeight / 2})" text-anchor="middle" fill="${orange}" font-size="11" font-family="Inter, sans-serif">Force (N)</text>
            <text x="${x0 + panelWidth / 2}" y="${y0 + panelHeight - 7}" text-anchor="middle" fill="#f8fafc" font-size="10" font-family="Inter, sans-serif">Pressure (kPa)</text>
            ${xTicks}
            ${yTicks}
            ${forceTicks}
            <path d="${capPath}" fill="none" stroke="${channelColors[index]}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="${forcePath}" fill="none" stroke="${orange}" stroke-width="2" stroke-dasharray="10 8" stroke-linecap="round" stroke-linejoin="round" opacity="0.88"></path>
          `;
        }).join("");

        return `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="EM raw signals for run ${runNumber}">
            <rect x="0" y="0" width="${width}" height="${height}" fill="#272727"></rect>
            ${panelContent}
          </svg>
        `;
      }

      // build the pressure sensitivity svg for one run.
      // blue is capacitance/pressure behavior and orange is the derivative curve.
      function emPressureSensitivitySvg(readings, runNumber = 1) {
        if (emPlotData) {
          const runData = emPlotData.runs.find((r) => r.run === runNumber);
          if (runData) return emRealPressureSensitivitySvg(runData);
        }
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const runReadings = readings.filter((point) => point.run === runNumber);
        const source = runReadings.length ? runReadings : readings;
        const panelWidth = 260;
        const panelHeight = 220;
        const columns = 4;
        const rows = 2;
        const width = columns * panelWidth;
        const height = rows * panelHeight;
        const padLeft = 44;
        const padRight = 38;
        const padTop = 34;
        const padBottom = 40;
        const maxPressure = Math.max(10, ...source.map((point) => emPressureKpa(point)));
        const blue = "#67d7ff";
        const orange = "#f28c28";

        const panelContent = channels.map((channel, index) => {
          const col = index % columns;
          const row = Math.floor(index / columns);
          const x0 = col * panelWidth;
          const y0 = row * panelHeight;
          const plotWidth = panelWidth - padLeft - padRight;
          const plotHeight = panelHeight - padTop - padBottom;
          const toX = (pressure) => x0 + padLeft + (pressure / maxPressure) * plotWidth;
          const toCapY = (cap) => y0 + panelHeight - padBottom - (cap / 5) * plotHeight;
          const toDerivY = (value) => y0 + panelHeight - padBottom - Math.min(1, Math.max(0, value)) * plotHeight;
          const pressureValues = source.map((point) => emPressureKpa(point));
          const capValues = source.map((point) => Math.min(5, Math.max(0, (emChannelValue(point, channel) - 18) / 2.4)));
          const derivativeValues = capValues.map((cap, capIndex) => {
            if (capIndex === 0) return 0;
            const deltaPressure = Math.max(0.001, pressureValues[capIndex] - pressureValues[capIndex - 1]);
            return Math.abs((cap - capValues[capIndex - 1]) / deltaPressure);
          });
          const maxDerivative = Math.max(...derivativeValues, 0.001);
          const peakIndex = Math.max(0, derivativeValues.indexOf(maxDerivative));
          const peakPressure = pressureValues[peakIndex] || 0;
          const peakCap = capValues[peakIndex] || 0;
          const peakSensitivity = derivativeValues[peakIndex] || 0;
          const peakX = toX(peakPressure).toFixed(2);
          const peakCapY = toCapY(peakCap).toFixed(2);
          const peakDerivativeY = toDerivY((peakSensitivity / maxDerivative) * 0.72).toFixed(2);
          const capPath = source.map((point, pointIndex) => {
            return `${pointIndex === 0 ? "M" : "L"}${toX(pressureValues[pointIndex]).toFixed(2)},${toCapY(capValues[pointIndex]).toFixed(2)}`;
          }).join(" ");
          const derivativePath = source.map((point, pointIndex) => {
            const scaled = derivativeValues[pointIndex] / maxDerivative;
            return `${pointIndex === 0 ? "M" : "L"}${toX(pressureValues[pointIndex]).toFixed(2)},${toDerivY(scaled * 0.72).toFixed(2)}`;
          }).join(" ");
          const xTicks = [0, Math.round(maxPressure / 2), Math.round(maxPressure)].map((tick) => {
            const x = toX(tick);
            const y = y0 + panelHeight - padBottom;
            return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 4}" stroke="#e5e7eb"></line><text x="${x}" y="${y + 18}" text-anchor="middle" fill="#f8fafc" font-size="10" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          const yTicks = [0, 2.5, 5].map((tick) => {
            const y = toCapY(tick);
            return `<line x1="${x0 + padLeft - 4}" y1="${y}" x2="${x0 + padLeft}" y2="${y}" stroke="#e5e7eb"></line><text x="${x0 + padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#f8fafc" font-size="10" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          const rightTicks = [0, 0.5, 1].map((tick) => {
            const y = toDerivY(tick);
            return `<text x="${x0 + panelWidth - 10}" y="${y + 4}" text-anchor="end" fill="${orange}" font-size="10" font-family="Inter, sans-serif">${tick.toFixed(1)}</text>`;
          }).join("");
          return `
            <rect x="${x0}" y="${y0}" width="${panelWidth}" height="${panelHeight}" fill="#272727"></rect>
            <path d="M${x0 + padLeft},${y0 + padTop} L${x0 + padLeft},${y0 + panelHeight - padBottom} L${x0 + panelWidth - padRight},${y0 + panelHeight - padBottom}" fill="none" stroke="#e5e7eb" stroke-width="1.2"></path>
            <path d="M${x0 + panelWidth - padRight},${y0 + padTop} L${x0 + panelWidth - padRight},${y0 + panelHeight - padBottom}" fill="none" stroke="${orange}" stroke-width="1"></path>
            <g opacity="0.18">
              <line x1="${x0 + padLeft}" y1="${toCapY(2.5)}" x2="${x0 + panelWidth - padRight}" y2="${toCapY(2.5)}" stroke="#f8fafc"></line>
              <line x1="${toX(maxPressure / 2)}" y1="${y0 + padTop}" x2="${toX(maxPressure / 2)}" y2="${y0 + panelHeight - padBottom}" stroke="#f8fafc"></line>
            </g>
            <text x="${x0 + panelWidth / 2}" y="${y0 + 22}" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="900" font-family="Inter, sans-serif">R${runNumber} CH${channel} | PS=${peakSensitivity.toFixed(3)} @ ${peakPressure.toFixed(1)} kPa</text>
            <text x="${x0 + 13}" y="${y0 + panelHeight / 2}" transform="rotate(-90 ${x0 + 13} ${y0 + panelHeight / 2})" text-anchor="middle" fill="${blue}" font-size="11" font-family="Inter, sans-serif">CAP (pF)</text>
            <text x="${x0 + panelWidth - 9}" y="${y0 + panelHeight / 2}" transform="rotate(90 ${x0 + panelWidth - 9} ${y0 + panelHeight / 2})" text-anchor="middle" fill="${orange}" font-size="11" font-family="Inter, sans-serif">dCAP/dkPa</text>
            <text x="${x0 + panelWidth / 2}" y="${y0 + panelHeight - 8}" text-anchor="middle" fill="#f8fafc" font-size="11" font-family="Inter, sans-serif">Pressure (kPa)</text>
            ${xTicks}
            ${yTicks}
            ${rightTicks}
            <path d="${capPath}" fill="none" stroke="${blue}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="${derivativePath}" fill="none" stroke="${orange}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="${peakX}" cy="${peakDerivativeY}" r="4" fill="#111827" stroke="${orange}" stroke-width="1.5"></circle>
            <path d="M${peakX},${peakCapY} l-6,-14 h12 z" fill="${orange}" opacity="0.9"></path>
          `;
        }).join("");

        return `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="EM pressure sensitivity curves for run ${runNumber}">
            <rect x="0" y="0" width="${width}" height="${height}" fill="#272727"></rect>
            ${panelContent}
          </svg>
        `;
      }

      function emPressureCurveSvg(readings, viewMode = "channel") {
        if (emPlotData) {
          return emRealAllChannelsSvg(viewMode);
        }
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const runs = [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        const panels = viewMode === "run" ? runs.map((run) => ({ type: "run", value: run })) : channels.map((channel) => ({ type: "channel", value: channel }));
        const panelWidth = 250;
        const panelHeight = 220;
        const columns = viewMode === "run" ? Math.min(3, Math.max(1, panels.length)) : 4;
        const rows = Math.ceil(panels.length / columns);
        const width = columns * panelWidth;
        const height = rows * panelHeight;
        const padLeft = 42;
        const padRight = 12;
        const padTop = 34;
        const padBottom = 40;
        const colors = ["#3f73e6", "#ff7a45", "#ffd43b", "#22c55e", "#8b5cf6", "#0891b2", "#e11955", "#94a3b8"];
        const maxPressure = Math.max(10, ...readings.map((point) => emPressureKpa(point)));

        const panelContent = panels.map((panel, panelIndex) => {
          const col = panelIndex % columns;
          const row = Math.floor(panelIndex / columns);
          const x0 = col * panelWidth;
          const y0 = row * panelHeight;
          const plotWidth = panelWidth - padLeft - padRight;
          const plotHeight = panelHeight - padTop - padBottom;
          const toX = (pressure) => x0 + padLeft + (pressure / maxPressure) * plotWidth;
          const toY = (cap) => y0 + panelHeight - padBottom - (cap / 5) * plotHeight;
          const lineGroups = panel.type === "channel"
            ? runs.map((run) => ({ label: `Run ${run}`, color: colors[(run - 1) % colors.length], points: readings.filter((point) => point.run === run), channel: panel.value }))
            : channels.map((channel) => ({ label: `CH ${channel}`, color: colors[(channel - 1) % colors.length], points: readings.filter((point) => point.run === panel.value), channel }));
          const paths = lineGroups.map((group) => {
            const path = group.points.map((point, pointIndex) => {
              const pressure = emPressureKpa(point);
              const cap = Math.min(5, Math.max(0, (emChannelValue(point, group.channel) - 18) / 2.4));
              return `${pointIndex === 0 ? "M" : "L"}${toX(pressure).toFixed(2)},${toY(cap).toFixed(2)}`;
            }).join(" ");
            return `<path d="${path}" fill="none" stroke="${group.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>`;
          }).join("");
          const legendItems = lineGroups.slice(0, panel.type === "channel" ? 3 : 8).map((group, index) => {
            const legendX = x0 + panelWidth - 86;
            const legendY = panel.type === "channel"
              ? y0 + panelHeight - 72 + index * 16
              : y0 + panelHeight - 136 + index * 15;
            return `<line x1="${legendX}" y1="${legendY}" x2="${legendX + 26}" y2="${legendY}" stroke="${group.color}" stroke-width="2.6"></line><text x="${legendX + 32}" y="${legendY + 4}" fill="#f8fafc" font-size="11" font-family="Inter, sans-serif">${group.label}</text>`;
          }).join("");
          const title = panel.type === "channel" ? `CH ${panel.value}` : `Run ${panel.value}`;
          const xTicks = [0, Math.round(maxPressure / 2), Math.round(maxPressure)].map((tick) => {
            const x = toX(tick);
            const y = y0 + panelHeight - padBottom;
            return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 4}" stroke="#d8dee8"></line><text x="${x}" y="${y + 18}" text-anchor="middle" fill="#f8fafc" font-size="11" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          const yTicks = [0, 2.5, 5].map((tick) => {
            const y = toY(tick);
            return `<line x1="${x0 + padLeft - 4}" y1="${y}" x2="${x0 + padLeft}" y2="${y}" stroke="#d8dee8"></line><text x="${x0 + padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#f8fafc" font-size="11" font-family="Inter, sans-serif">${tick}</text>`;
          }).join("");
          return `
            <rect x="${x0}" y="${y0}" width="${panelWidth}" height="${panelHeight}" fill="#272727"></rect>
            <path d="M${x0 + padLeft},${y0 + padTop} L${x0 + padLeft},${y0 + panelHeight - padBottom} L${x0 + panelWidth - padRight},${y0 + panelHeight - padBottom}" fill="none" stroke="#e5e7eb" stroke-width="1.2"></path>
            <g opacity="0.22">
              <line x1="${x0 + padLeft}" y1="${toY(2.5)}" x2="${x0 + panelWidth - padRight}" y2="${toY(2.5)}" stroke="#f8fafc"></line>
              <line x1="${toX(maxPressure / 2)}" y1="${y0 + padTop}" x2="${toX(maxPressure / 2)}" y2="${y0 + panelHeight - padBottom}" stroke="#f8fafc"></line>
            </g>
            <text x="${x0 + panelWidth / 2}" y="${y0 + 22}" text-anchor="middle" fill="#f8fafc" font-size="15" font-weight="800" font-family="Inter, sans-serif">${title}</text>
            <text x="${x0 + 12}" y="${y0 + panelHeight / 2}" transform="rotate(-90 ${x0 + 12} ${y0 + panelHeight / 2})" text-anchor="middle" fill="#f8fafc" font-size="12" font-family="Inter, sans-serif">CAP (pF)</text>
            <text x="${x0 + panelWidth / 2}" y="${y0 + panelHeight - 8}" text-anchor="middle" fill="#f8fafc" font-size="12" font-family="Inter, sans-serif">Pressure (kPa)</text>
            ${xTicks}
            ${yTicks}
            ${paths}
            ${legendItems}
          `;
        }).join("");

        return `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="EM all channels and runs ${viewMode} plot">
            <rect x="0" y="0" width="${width}" height="${height}" fill="#272727"></rect>
            ${panelContent}
          </svg>
        `;
      }

      // redraw the all ch/runs tab whenever the user switches between by-channel and by-run views.
      function renderEmAllChannelsRuns(readings = emAnalysisReadings.length ? emAnalysisReadings : (emReadings.length ? emReadings : [{ force: 0, time: 0, run: 1 }])) {
        const target = document.getElementById("emAllChRunsPlot");
        if (!target) return;
        document.getElementById("emByChannelButton")?.classList.toggle("active", emAllChRunsMode === "channel");
        document.getElementById("emByRunButton")?.classList.toggle("active", emAllChRunsMode === "run");
        if (emImages) {
          const path = emAllChRunsMode === "run" ? emImages.all_ch_per_run : emImages.all_run_per_ch;
          const label = emAllChRunsMode === "run" ? "PS curves - all channels per run" : "PS curves - all runs per channel";
          target.innerHTML = `<div class="em-analysis-png-wrap">${emPngImg(path, label)}</div>`;
          return;
        }
        target.innerHTML = emPressureCurveSvg(readings, emAllChRunsMode);
      }

      function setEmAllChannelsRunsMode(mode) {
        emAllChRunsMode = mode;
        renderEmAllChannelsRuns();
      }

      function renderEmRawSignals(readings = emAnalysisReadings.length ? emAnalysisReadings : (emReadings.length ? emReadings : [{ force: 0, time: 0, run: 1 }])) {
        const target = document.getElementById("emRawSignalsPlot");
        if (!target) return;
        const runs = [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        if (!runs.includes(emRawSignalRun)) emRawSignalRun = runs[0] || 1;
        runs.forEach((run) => {
          document.getElementById(`emRawRun${run}Button`)?.classList.toggle("active", emRawSignalRun === run);
        });
        if (emImages && emImages.raw_signal) {
          const imgs = emImages.raw_signal[String(emRawSignalRun)] || [];
          target.innerHTML = `<div class="em-analysis-png-grid">${imgs.map((p, i) => emPngImg(p, `Raw signal run ${emRawSignalRun} CH${i + 1}`)).join("")}</div>`;
          return;
        }
        target.innerHTML = emRawSignalsSvg(readings, emRawSignalRun);
      }

      function setEmRawSignalRun(runNumber) {
        emRawSignalRun = runNumber;
        renderEmRawSignals();
      }

      // redraw the pressure sensitivity tab for the currently selected run.
      function renderEmPressureSensitivity(readings = emAnalysisReadings.length ? emAnalysisReadings : (emReadings.length ? emReadings : [{ force: 0, time: 0, run: 1 }])) {
        const target = document.getElementById("emPressureSensitivityPlot");
        if (!target) return;
        const runs = [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        if (!runs.includes(emPressureSensitivityRun)) emPressureSensitivityRun = runs[0] || 1;
        runs.forEach((run) => {
          document.getElementById(`emPsRun${run}Button`)?.classList.toggle("active", emPressureSensitivityRun === run);
        });
        if (emImages && emImages.ps_curve) {
          const path = emImages.ps_curve[String(emPressureSensitivityRun)];
          if (path) {
            target.innerHTML = `<div class="em-analysis-png-wrap">${emPngImg(path, `PS curve all CHs run ${emPressureSensitivityRun}`)}</div>`;
            return;
          }
        }
        target.innerHTML = emPressureSensitivitySvg(readings, emPressureSensitivityRun);
      }

      function setEmPressureSensitivityRun(runNumber) {
        emPressureSensitivityRun = runNumber;
        renderEmPressureSensitivity();
      }

      function emVariablesOfInterest(readings) {
        const runs = [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const surfaceArea = Math.max(1, Number.parseFloat(document.getElementById("surfaceArea").value || "325"));
        const runMaxPs = [];
        const runMaxKpa = [];
        const runMaxCap = [];
        const inflectionPs = [];
        const inflectionForce = [];
        const channelMaxCaps = channels.map((channel) => {
          const capValues = readings.map((point) => emChannelValue(point, channel));
          return Math.max(...capValues);
        });

        runs.forEach((run) => {
          const runReadings = readings.filter((point) => point.run === run);
          const forceValues = runReadings.map((point) => point.force);
          const kPaValues = forceValues.map((force) => (force / surfaceArea) * 1000);
          runMaxKpa.push(Math.max(...kPaValues, 0));

          const channelMaxPsForRun = channels.map((channel) => {
            const capValues = runReadings.map((point) => emChannelValue(point, channel));
            const psValues = capValues.map((cap, index) => cap / Math.max(0.1, kPaValues[index] + 1));
            const derivativeValues = psValues.slice(1).map((value, index) => Math.abs(value - psValues[index]));
            const peakDerivativeIndex = Math.max(0, derivativeValues.indexOf(Math.max(...derivativeValues)));
            inflectionPs.push(psValues[peakDerivativeIndex] || 0);
            inflectionForce.push(forceValues[peakDerivativeIndex] || 0);
            return Math.max(...psValues, 0);
          });
          runMaxPs.push(Math.max(...channelMaxPsForRun, 0));
          runMaxCap.push(Math.max(...channels.flatMap((channel) => runReadings.map((point) => emChannelValue(point, channel))), 0));
        });

        const sortedCaps = channels.map((channel, index) => ({ channel, value: channelMaxCaps[index] })).sort((a, b) => b.value - a.value);
        const top6 = sortedCaps.slice(0, 6).map((item) => item.value);
        const top2 = sortedCaps.slice(0, 2).map((item) => item.value);
        const shortedChannels = sortedCaps.filter((item) => item.value > summaryStats(channelMaxCaps).average + summaryStats(channelMaxCaps).standardDeviation * 1.2).map((item) => `CH ${item.channel}`);

        const maxPsStats = summaryStats(runMaxPs);
        const psAtInflectionStats = summaryStats(inflectionPs);
        const maxKpaStats = summaryStats(runMaxKpa);
        const maxCapStats = summaryStats(runMaxCap);

        return {
          mean_max_ps: maxPsStats.average,
          std_max_ps: maxPsStats.standardDeviation,
          cov_max_ps: coefficientOfVariation(runMaxPs),
          avg_ps_at_inflection: psAtInflectionStats.average,
          mean_ps_at_inflection: psAtInflectionStats.average,
          std_ps_at_inflection: psAtInflectionStats.standardDeviation,
          cov_ps_at_inflection: coefficientOfVariation(inflectionPs),
          mean_max_kpa: maxKpaStats.average,
          std_max_kpa: maxKpaStats.standardDeviation,
          cov_max_kpa: coefficientOfVariation(runMaxKpa),
          mean_max_cap: maxCapStats.average,
          std_max_cap: maxCapStats.standardDeviation,
          cov_max_cap: coefficientOfVariation(runMaxCap),
          avg_force_at_inflection: summaryStats(inflectionForce).average,
          average_max_cap_across_chs: summaryStats(channelMaxCaps).average,
          avg_ch_var_6ch_mean: summaryStats(top6).average,
          avg_ch_var_6ch_cov: coefficientOfVariation(top6),
          avg_ch_var_2ch_mean: summaryStats(top2).average,
          avg_ch_var_2ch_cov: coefficientOfVariation(top2),
          avg_ch_var_allch_mean: summaryStats(channelMaxCaps).average,
          avg_ch_var_allch_cov: coefficientOfVariation(channelMaxCaps),
          shorted_ch: shortedChannels.length ? shortedChannels.join(", ") : "NONE",
        };
      }

      function emVariablesTable(readings) {
        const runs = [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const surfaceArea = Math.max(1, Number.parseFloat(document.getElementById("surfaceArea").value || "325"));
        // Prefer the REAL per-channel stats from the Python pipeline (computed from
        // the actual CAP files). Each backend block has mean/std/cov/min/max and cov
        // is already a percentage; map it to this table's {average, standardDeviation,
        // min, max} shape. Only synthesize when there is no real analysis.
        let channelStats;
        if (emBackendChannelStats) {
          const byCh = {};
          emBackendChannelStats.forEach((c) => { byCh[Number(c.channel)] = c; });
          const block = (b) => ({
            average: Number((b && b.mean) || 0),
            standardDeviation: Number((b && b.std) || 0),
            min: Number((b && b.min) || 0),
            max: Number((b && b.max) || 0),
          });
          channelStats = channels.map((channel) => {
            const c = byCh[channel] || {};
            return {
              psAtInflection: block(c.ps), covPsAtInflection: Number((c.ps && c.ps.cov) || 0),
              maxKpa: block(c.kpa), covMaxKpa: Number((c.kpa && c.kpa.cov) || 0),
              maxCap: block(c.cap), covMaxCap: Number((c.cap && c.cap.cov) || 0),
            };
          });
        } else {
          channelStats = channels.map((channel) => {
            const psAtInflection = [];
            const maxKpa = [];
            const maxCap = [];

            runs.forEach((run) => {
              const runReadings = readings.filter((point) => point.run === run);
              const forceValues = runReadings.map((point) => point.force);
              const kPaValues = forceValues.map((force) => (force / surfaceArea) * 1000);
              const capValues = runReadings.map((point) => emChannelValue(point, channel));
              const psValues = capValues.map((cap, index) => cap / Math.max(0.1, kPaValues[index] + 1));
              const derivativeValues = psValues.slice(1).map((value, index) => Math.abs(value - psValues[index]));
              const peakDerivativeIndex = Math.max(0, derivativeValues.indexOf(Math.max(...derivativeValues)));
              const maxCapValue = Math.max(...capValues, 0);
              const maxCapIndex = Math.max(0, capValues.indexOf(maxCapValue));

              psAtInflection.push(psValues[peakDerivativeIndex] || 0);
              maxKpa.push(kPaValues[maxCapIndex] || Math.max(...kPaValues, 0));
              maxCap.push(maxCapValue);
            });

            return {
              psAtInflection: summaryStats(psAtInflection),
              covPsAtInflection: coefficientOfVariation(psAtInflection),
              maxKpa: summaryStats(maxKpa),
              covMaxKpa: coefficientOfVariation(maxKpa),
              maxCap: summaryStats(maxCap),
              covMaxCap: coefficientOfVariation(maxCap),
            };
          });
        }
        const rows = [
          ["Mean PS at Inflection", (stats) => stats.psAtInflection.average.toFixed(3)],
          ["Std PS at Inflection", (stats) => stats.psAtInflection.standardDeviation.toFixed(3)],
          ["CoV PS at Inflection", (stats) => `${stats.covPsAtInflection.toFixed(2)}%`],
          ["Min PS at Inflection", (stats) => stats.psAtInflection.min.toFixed(3)],
          ["Max PS at Inflection", (stats) => stats.psAtInflection.max.toFixed(3)],
          ["Mean Max kPa", (stats) => `${stats.maxKpa.average.toFixed(3)} kPa`],
          ["Std Max kPa", (stats) => `${stats.maxKpa.standardDeviation.toFixed(3)} kPa`],
          ["CoV Max kPa", (stats) => `${stats.covMaxKpa.toFixed(2)}%`],
          ["Min Max kPa", (stats) => `${stats.maxKpa.min.toFixed(3)} kPa`],
          ["Max Max kPa", (stats) => `${stats.maxKpa.max.toFixed(3)} kPa`],
          ["Mean Max CAP", (stats) => `${stats.maxCap.average.toFixed(3)} pF`],
          ["Std Max CAP", (stats) => `${stats.maxCap.standardDeviation.toFixed(3)} pF`],
          ["CoV Max CAP", (stats) => `${stats.covMaxCap.toFixed(2)}%`],
          ["Min Max CAP", (stats) => `${stats.maxCap.min.toFixed(3)} pF`],
          ["Max Max CAP", (stats) => `${stats.maxCap.max.toFixed(3)} pF`],
        ];
        return `
          <div class="stats-table-wrap">
            <table class="stats-table">
              <thead>
                <tr>
                  <th>Summary Stat</th>
                  ${channels.map((channel) => `<th>CH ${channel}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${rows.map(([label, getter]) => `
                  <tr>
                    <td>${label}</td>
                    ${channelStats.map((stats) => `<td>${getter(stats)}</td>`).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      }

      // rebuild the report preview + copy text from the current editable fields.
      function renderEmReport() {
        const readings = emAnalysisReadings.length ? emAnalysisReadings : [{ run: 1, time: 0, force: 0 }];
        const tsv = emTrackerOutput(readings);
        const preview = document.getElementById("emReportPreview");
        const text = document.getElementById("emReportOutputText");
        if (preview) preview.innerHTML = coloredReportPreviewTable(tsv);
        if (text) text.value = tsv;
      }

      // preview table that color-codes the Shorted-CH and Test-Result cells
      // (green = None/Pass, red = CH#/Fail). Shared by EM and Shear reports.
      function coloredReportPreviewTable(tsvText) {
        const rows = tsvText.split("\n").map((line) => line.split("\t"));
        if (!rows.length) return "";
        const headerRows = rows.slice(0, -1);
        const valueRow = rows[rows.length - 1] || [];
        const colNames = headerRows[headerRows.length - 1] || [];
        const cellClass = (name, value) => {
          const v = (value || "").trim().toLowerCase();
          if ((name || "").indexOf("Shorted CH") === 0) return v === "none" ? "cell-pass" : "cell-fail";
          if ((name || "").indexOf("FPQC-S-00") === 0) return v === "pass" ? "cell-pass" : "cell-fail";
          return "";
        };
        return `
          <div class="report-preview-wrap">
            <table class="report-preview-table">
              <thead>
                ${headerRows.map((r) => `<tr>${r.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`).join("")}
              </thead>
              <tbody>
                <tr>${valueRow.map((c, i) => `<td class="${cellClass(colNames[i], c)}">${escapeHtml(c)}</td>`).join("")}</tr>
              </tbody>
            </table>
          </div>`;
      }

      // copy the data row, but first prompt to fill any blank required field
      // (with a "copy anyway" bypass).
      async function copyEmReportValues() {
        const required = [
          { id: "reportSite", label: "Site" },
          { id: "reportEcoBlox", label: "Eco Blox ID" },
          { id: "reportFixture", label: "EM Characterization Test Fixture" },
          { id: "reportSignoff", label: "Sign off" },
        ];
        const blanks = required.filter((field) => !(document.getElementById(field.id)?.value || "").trim());
        if (blanks.length) {
          const proceed = await promptConfirm(
            `These fields are still blank: ${blanks.map((b) => b.label).join(", ")}.\n\nFill them in above, or copy anyway?`,
            { title: "Some fields are blank", confirmLabel: "Copy anyway", cancelLabel: "Fill in" });
          if (!proceed) {
            const first = document.getElementById(blanks[0].id);
            if (first) first.focus();
            return;
          }
        }
        copyReportValues("emReportOutputText", "copyEmReportButton");
      }

      // linear interpolation of a cap-vs-pressure curve at a target pressure. xs is the
      // aligned pressure axis (kPa, ascending) and ys the matching cap values from the
      // Python pipeline; clamps to the curve's ends when the target is out of range.
      function emInterpAt(xs, ys, target) {
        const pairs = [];
        for (let i = 0; i < xs.length; i++) {
          if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
        }
        if (!pairs.length) return 0;
        pairs.sort((a, b) => a[0] - b[0]);
        if (target <= pairs[0][0]) return pairs[0][1];
        if (target >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
        for (let i = 1; i < pairs.length; i++) {
          if (pairs[i][0] >= target) {
            const [x0, y0] = pairs[i - 1];
            const [x1, y1] = pairs[i];
            const span = x1 - x0;
            const fraction = span ? (target - x0) / span : 0;
            return y0 + fraction * (y1 - y0);
          }
        }
        return pairs[pairs.length - 1][1];
      }

      function emTrackerOutput(readings) {
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const surfaceArea = Math.max(1, Number.parseFloat(document.getElementById("surfaceArea").value || "325"));
        const targetPressures = [5, 10, 15, 20, 25, 30, 35, 40, 45];
        // When the Python pipeline ran, use its aligned cap-vs-pressure curves and
        // inflection values (the same data the graphs draw) so the report matches the
        // plots exactly. The pipeline interpolates CAP and FUT to a common 200 Hz grid
        // and syncs them on the release peak, which the preview's nearest-timestamp
        // approximation can't do. Fall back to the preview readings when it didn't run.
        const usePipeline = emPlotData && Array.isArray(emPlotData.runs) && emPlotData.runs.length;
        const pipelineRuns = usePipeline ? emPlotData.runs : [];
        const runs = usePipeline
          ? pipelineRuns.map((runData) => runData.run)
          : [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        const channelMetrics = channels.map((channel) => {
          const psAtInflection = [];
          const kpaAtInflection = [];
          const maxCap = [];
          const capAtPressures = targetPressures.map(() => []);

          if (usePipeline) {
            // aligned path: read each run's pressure axis and this channel's cap curve
            // straight from the pipeline payload (emPlotData), and use the pipeline's
            // own inflection (P.S, pressure) instead of re-deriving it in the browser.
            pipelineRuns.forEach((runData) => {
              const channelData = (runData.channels || [])[channel - 1];
              if (!channelData) return;
              const pressure = runData.pressure || [];
              const capValues = (channelData.cap || []).filter((value) => Number.isFinite(value));
              const infl = channelData.infl;
              psAtInflection.push(infl ? infl.ps : 0);
              kpaAtInflection.push(infl ? infl.kpa : 0);
              maxCap.push(capValues.length ? Math.max(...capValues, 0) : 0);
              targetPressures.forEach((pressureValue, pressureIndex) => {
                capAtPressures[pressureIndex].push(emInterpAt(pressure, channelData.cap || [], pressureValue));
              });
            });
          } else {
            runs.forEach((run) => {
              const runReadings = readings.filter((point) => point.run === run);
              const kPaValues = runReadings.map((point) => (point.force / surfaceArea) * 1000);
              const capValues = runReadings.map((point) => emChannelValue(point, channel));
              const psValues = capValues.map((cap, index) => cap / Math.max(0.1, kPaValues[index] + 1));
              const derivativeValues = psValues.slice(1).map((value, index) => Math.abs(value - psValues[index]));
              const peakIndex = Math.max(0, derivativeValues.indexOf(Math.max(...derivativeValues)));
              psAtInflection.push(psValues[peakIndex] || 0);
              kpaAtInflection.push(kPaValues[peakIndex] || 0);
              maxCap.push(Math.max(...capValues, 0));
              targetPressures.forEach((pressure, pressureIndex) => {
                const nearestIndex = kPaValues.reduce((bestIndex, value, index) => {
                  return Math.abs(value - pressure) < Math.abs(kPaValues[bestIndex] - pressure) ? index : bestIndex;
                }, 0);
                capAtPressures[pressureIndex].push(capValues[nearestIndex] || 0);
              });
            });
          }

          return {
            ps: summaryStats(psAtInflection),
            psCov: coefficientOfVariation(psAtInflection),
            kpa: summaryStats(kpaAtInflection),
            kpaCov: coefficientOfVariation(kpaAtInflection),
            cap: summaryStats(maxCap),
            capCov: coefficientOfVariation(maxCap),
            capAtPressures: capAtPressures.map((values) => summaryStats(values)),
            capPressureCov: capAtPressures.map((values) => coefficientOfVariation(values)),
          };
        });
        const center = [2, 3, 4, 5];
        const outer = [0, 1, 6, 7];
        const avg = (items) => items.reduce((sum, value) => sum + value, 0) / Math.max(1, items.length);
        const avgCov = (metric, indexes) => `${avg(indexes.map((index) => channelMetrics[index][metric])).toFixed(2)}%`;
        const compressionShortThresholdPf = 1000000;
        const shorted = channels
          .map((channel) => ({
            channel,
            maxCap: Math.max(...readings.map((point) => emChannelValue(point, channel)), 0),
          }))
          .filter((item) => item.maxCap >= compressionShortThresholdPf)
          .map((item) => `CH${item.channel}`);
        const pressureIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        const runCounted = runs.length;
        const redoAttemptCount = config().redo_run ? 1 : 0;
        const runTested = runCounted + redoAttemptCount;
        const centerMeanByPressure = pressureIndexes.map((pressureIndex) => {
          return avg(center.map((channelIndex) => channelMetrics[channelIndex].capAtPressures[pressureIndex].average)).toFixed(3);
        });
        const centerCovByPressure = pressureIndexes.map((pressureIndex) => {
          return `${avg(center.map((channelIndex) => channelMetrics[channelIndex].capPressureCov[pressureIndex])).toFixed(2)}%`;
        });
        // editable user fields (filled in the Report Output tab); auto fields are computed.
        const fieldValue = (id) => (document.getElementById(id)?.value || "").trim();
        const site = fieldValue("reportSite");
        const ecoBlox = fieldValue("reportEcoBlox");
        const fixture = fieldValue("reportFixture");
        const signoff = fieldValue("reportSignoff");
        const shortedText = shorted.length ? shorted.join(", ") : "None";
        const testResult = shorted.length ? "Fail" : "Pass";
        const redoNotes = (emRedoInfo && emRedoInfo.reason_summary) ? emRedoInfo.reason_summary : "";

        const covHeaders = ["Avg Center 4 CHs COV", "Avg Outer 4 CHs COV", "Avg All CHs COV"];
        const pressureHeaders = [5, 10, 15, 20, 25, 30, 35, 40, 45].map((pressure) => `${pressure} kPa`);

        // Identification + Electromechanical Test columns.
        const baseHeaders = [
          "Sensor Lot Number", "Site", "Check Date", "Eco Blox ID",
          "EM Characterization Test Fixture", "Vena Vitals Wearable iOS App",
          "Shorted CH via Compression", "FPQC-S-002 Electromechanical Test Results", "Sign off",
        ];
        const baseValues = [
          config().sensor_id || "", site, isoDate(), ecoBlox, fixture, "SW0004",
          shortedText, testResult, signoff,
        ];

        const headerTop = [
          "Identification", "",
          "ELECTROMECHANICAL TEST", "", "", "", "", "", "",
          "ELECTROMECHANICAL METRICS (Taken over the average of all runs performed)", ...Array(21).fill(""),
          "Testing Tracker", "", "",
        ];
        const headerGroup = [
          ...Array(baseHeaders.length).fill(""),
          "P.S at Inflection (pF/kPa)", ...Array(10).fill(""),
          "Pressure at Inflection (kPa)", ...Array(10).fill(""),
          "", "", "",
        ];
        const header = [
          ...baseHeaders,
          ...channels.map((channel) => `CH${channel}`), ...covHeaders,
          ...channels.map((channel) => `CH${channel}`), ...covHeaders,
          "Run # Tested", "Run # Counted", "Notes",
        ];
        const row = [
          ...baseValues,
          ...channelMetrics.map((metrics) => metrics.ps.average.toFixed(3)),
          avgCov("psCov", center), avgCov("psCov", outer), avgCov("psCov", channels.map((_, index) => index)),
          ...channelMetrics.map((metrics) => metrics.kpa.average.toFixed(3)),
          avgCov("kpaCov", center), avgCov("kpaCov", outer), avgCov("kpaCov", channels.map((_, index) => index)),
          runTested, runCounted, redoNotes,
        ];
        return [headerTop.join("\t"), headerGroup.join("\t"), header.join("\t"), row.join("\t")].join("\n");
      }

      // fill the em analysis tabs after python finishes generating the analysis outputs.
      // if python did not return readings, it falls back to the data collected in the preview window.
      function populateEmAnalysis(message, analysis = null) {
        const backendReadings = analysis?.readings?.length ? analysis.readings.map((point) => ({
          run: Number(point.run || 1),
          time: Number(point.time || 0),
          force: Number(point.force || 0),
          // carry the real per-channel capacitance through to the stats/report.
          channels: Array.isArray(point.channels) ? point.channels : undefined,
        })) : [];
        // capture redo/supersession info (active runs + reasons) up front.
        emRedoInfo = (analysis && analysis.redo_info) ? analysis.redo_info : null;
        let readings = backendReadings.length ? backendReadings : (emReadings.length ? emReadings : [{ force: 0, time: 0, run: 1 }]);
        // never show superseded runs - display only the active runs.
        const activeRuns = emRedoInfo && Array.isArray(emRedoInfo.active_runs) ? emRedoInfo.active_runs.map(Number) : null;
        if (activeRuns && activeRuns.length) {
          const keep = new Set(activeRuns);
          const filtered = readings.filter((point) => keep.has(Number(point.run)));
          if (filtered.length) readings = filtered;
        }
        emAnalysisReadings = readings;
        // adopt the real computed curves when the python engine returned them.
        emPlotData = (analysis && analysis.em_plots && Array.isArray(analysis.em_plots.runs) && analysis.em_plots.runs.length)
          ? analysis.em_plots : null;
        // make a preview/synthesized fallback OBVIOUS instead of silently showing
        // fake-looking plots. engine === "real" means the actual pipeline ran.
        const emEngine = analysis && analysis.engine;
        const emReason = (analysis && analysis.engine_reason) || "unknown";
        if (emEngine === "preview") {
          console.warn(`[em analysis] PREVIEW (synthesized) plots shown - the real pipeline did NOT run. Reason: ${emReason}`);
        } else {
          console.log(`[em analysis] engine = ${emEngine || "?"} (real pipeline output)`);
        }
        const banner = document.getElementById("emEngineBanner");
        if (banner) {
          if (emEngine === "preview") {
            banner.className = "alert";
            banner.style.cssText = "background:#fff5f7;border:1px solid var(--red);color:#a32d2d;margin-bottom:12px;text-align:left;";
            banner.textContent = "These are PREVIEW (synthesized) plots, not real analysis - "
              + ((analysis && analysis.engine_reason) || "the real pipeline did not run on this data.");
          } else {
            banner.className = "hidden";
            banner.textContent = "";
          }
        }
        // adopt the real matplotlib PNG figures when present (preferred display).
        emImages = (analysis && analysis.em_images) ? analysis.em_images : null;
        // adopt the real per-channel stats (from the CAP files) for the Summary
        // Statistics table; null falls the table back to the synthesized preview.
        emBackendChannelStats = (analysis && Array.isArray(analysis.channel_stats) && analysis.channel_stats.length)
          ? analysis.channel_stats : null;
        // embed the interactive (zoom + click-to-comment) plots in the Interactive tab.
        renderInteractivePanel("em", analysis);
        const runs = [...new Set(readings.map((point) => point.run))].sort((a, b) => a - b);
        document.getElementById("em-rawSignals").innerHTML = `
          <div class="sub-toggle">
            ${runs.map((run) => `<button id="emRawRun${run}Button" onclick="setEmRawSignalRun(${run})">Run ${run}</button>`).join("")}
          </div>
          <div id="emRawSignalsPlot" class="analysis-plot-scroll"></div>
        `;
        document.getElementById("em-pressureSensitivity").innerHTML = `
          <div class="sub-toggle">
            ${runs.map((run) => `<button id="emPsRun${run}Button" onclick="setEmPressureSensitivityRun(${run})">Run ${run}</button>`).join("")}
          </div>
          <div id="emPressureSensitivityPlot" class="analysis-plot-scroll"></div>
        `;
        document.getElementById("em-allChannelsRuns").innerHTML = `
          <div class="sub-toggle">
            <button id="emByChannelButton" class="active" onclick="setEmAllChannelsRunsMode('channel')">By Channel (all runs)</button>
            <button id="emByRunButton" onclick="setEmAllChannelsRunsMode('run')">By Run (all channels)</button>
          </div>
          <div id="emAllChRunsPlot" class="analysis-plot-scroll"></div>
        `;
        emRawSignalRun = runs[0] || 1;
        renderEmRawSignals(readings);
        emPressureSensitivityRun = runs[0] || 1;
        renderEmPressureSensitivity(readings);
        emAllChRunsMode = "channel";
        renderEmAllChannelsRuns(readings);
        document.getElementById("em-summary").innerHTML = `
          ${runListHtml(emRedoInfo)}
          ${emVariablesTable(readings)}
        `;
        document.getElementById("em-reportOutput").innerHTML = `
          <div class="report-fields">
            <label class="report-field"><span>Site</span>
              <select id="reportSite" onchange="renderEmReport()">
                <option value="">Select site…</option>
                <option value="ULP">ULP</option>
                <option value="Roseman">Roseman</option>
                <option value="Roseman - ULP">Roseman - ULP</option>
                <option value="ULP - Roseman">ULP - Roseman</option>
              </select>
            </label>
            <label class="report-field"><span>Eco Blox ID</span>
              <input id="reportEcoBlox" placeholder="e.g. 240412_01" oninput="renderEmReport()" />
            </label>
            <label class="report-field"><span>EM Characterization Test Fixture</span>
              <select id="reportFixture" onchange="renderEmReport()">
                <option value="">Select fixture…</option>
                <option value="FXT0008-01">FXT0008-01</option>
                <option value="FXT0008-02">FXT0008-02</option>
              </select>
            </label>
            <label class="report-field"><span>Sign off</span>
              <input id="reportSignoff" placeholder="Initials" oninput="renderEmReport()" />
            </label>
          </div>
          <div class="copy-row">
            <button id="copyEmReportButton" onclick="copyEmReportValues()">Copy Values</button>
          </div>
          <div id="emReportPreview"></div>
          <textarea id="emReportOutputText" class="copy-source" readonly></textarea>
        `;
        renderEmReport();
        showAnalysisTab("em", "rawSignals");
      }
