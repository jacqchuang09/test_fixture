/*
 * manual.js - Manual test window.
 *
 * Owns the manual test modal and its analysis modal. Handles jog / drag /
 * home actuator moves, the live recorded-data log (time, force, capacitance),
 * and the manual analysis plots.
 *
 * Structure:
 *   - Move control: manualMove, manualTestMove, stageManualDragMove,
 *     confirmManualDragMove, manualTestHome,
 *     pauseManualMotion, isManualMoving, manualActuatorSpeed, nextManualTime.
 *   - Mode / state: manualControlMode, setManualControlMode,
 *     updateManualControlMode, setManualControlsLocked, setManualState.
 *   - Logging + graphs: recordManualMove, addManualPoint, manualGraphSettings,
 *     updateManualTimeControls, drawManualGraphs.
 *   - Analysis: performManualAnalysis, setManualAnalysisZoom,
 *     populateManualAnalysis, resetManualTest.
 *
 * Reads shared.js globals (manualData, manualPosition, manualMotionTimer)
 * and shared helpers (callApi, clampForce, drawMiniGraph...).
 */


      function setManualState(state, message) {
        setStatePill("manualState", state, message);
        manualStatusLines.push(`[${stamp()}] ${state}: ${message}`);
      }

      function resetManualTest() {
        if (manualMotionTimer) {
          clearInterval(manualMotionTimer);
          manualMotionTimer = null;
        }
        stopManualSampling();                  // no live readout until Start is pressed
        manualData = [];
        manualClockStart = performance.now();   // continuous clock for Force/Cap vs Time
        manualLiveForce = 0;
        manualPosition = 17;
        manualPendingPosition = 17;
        manualStatusLines = [];
        document.getElementById("manualDragPosition").value = 17;
        document.getElementById("manualDragReadout").textContent = "selected position: 17.0 mm. travel from baseline: 0.0 mm.";
        // Idle / armed: only Start and the setup inputs are usable. Start is the
        // connection checkpoint and what turns on the live force readout (startManualTest);
        // nothing samples, moves, or records until then, so the graph opens empty.
        setManualSessionActive(false);
        updateManualControlMode();
        setManualState("READY", "press Start to begin the live force readout.");
        drawManualGraphs();
      }

      // Toggle the manual window between armed (pre-Start) and active (post-Start).
      // Pre-Start: only Start and the setup inputs work - nothing can move or record.
      // Post-Start: motion + analysis are live and Start is disabled. Pause and Confirm
      // Drag stay gated on their own conditions (a running move / a staged drag), so
      // they are left disabled here.
      function setManualSessionActive(active) {
        manualStarted = active;
        document.getElementById("manualStartButton").disabled = active;
        ["manualReleaseButton", "manualCompressionButton", "manualHomeButton"].forEach((id) => {
          const element = document.getElementById(id);
          if (element) element.disabled = !active;
        });
        document.getElementById("manualPauseButton").disabled = true;
        document.getElementById("manualAnalysisButton").disabled = !active;
        document.getElementById("manualConfirmDragButton").disabled = true;
        const forceMode = manualControlMode() === "force";
        document.getElementById("manualDragPosition").disabled = !active || forceMode;
      }

      // Start is the connection checkpoint AND what turns on the live force readout.
      // On a real rig it requires a live Zaber (shows the reconnect/connect message on
      // failure); it stays soft in simulation. On pass it begins a fresh recorded trace
      // from t=0, starts sampling/plotting force, and unlocks the manual controls.
      async function startManualTest() {
        if (manualStarted) return;
        // Start is the connection checkpoint: a confirmed link clears the banner and
        // begins sampling; a lost link blocks and raises the banner.
        if (!(await zaberStartGateOk())) return;
        manualData = [];
        manualClockStart = performance.now();
        manualLiveForce = 0;
        setManualSessionActive(true);
        updateManualControlMode();
        setManualState("RECORDING", "live force readout started. manual controls ready.");
        startManualSampling();
      }

      // Continuous recording: while the manual window is open, sample force on a steady
      // ~10 Hz clock so Force/Cap vs Time keep advancing even when the actuator is idle.
      // During a move the move loop streams the live force into manualLiveForce; when
      // idle we read the load cell directly. One clock (manualClockStart) timestamps all
      // points so time never resets between moves.
      function startManualSampling() {
        stopManualSampling();
        manualSampleTimer = setInterval(async () => {
          if (!isManualMoving()) {
            const r = await callApi("/api/read-force", {});
            if (r && r.ok) {
              manualLiveForce = Number(r.force || 0);
              if (typeof r.position === "number") manualPosition = r.position;
            }
          }
          const t = (performance.now() - manualClockStart) / 1000;
          // Record load-cell force only. The manual window has no capacitance sensor,
          // so capacitance is left null (NOT a fabricated value) - the cap graphs show
          // an explicit empty state instead of plotting placeholder numbers.
          manualData.push({ time: t, force: manualLiveForce, capacitance: null });
          if (manualData.length > 36000) manualData.splice(0, manualData.length - 36000);  // ~1 hr cap
          drawManualGraphs();
        }, 100);
      }

      function stopManualSampling() {
        if (manualSampleTimer) { clearInterval(manualSampleTimer); manualSampleTimer = null; }
      }

      function manualActuatorSpeed() {
        return Math.min(2, Math.max(0.01, Number(document.getElementById("manualActuatorSpeed").value || 1)));
      }

      function manualControlMode() {
        return document.getElementById("manualControlMode")?.value || "distance";
      }

      function isManualMoving() {
        return Boolean(manualMotionTimer);
      }

      // Close the Manual Testing Window. If the actuator is moving, warn first (1.9.12):
      // Confirm stops motion (the backend returns the actuator home) and closes; Cancel
      // leaves the window open and the move running.
      async function closeManualTestWindow() {
        if (isManualMoving()) {
          const ok = await promptConfirm(
            "The actuator is moving. Closing will stop motion and return it home. Continue?",
            { title: "Actuator moving", confirmLabel: "Stop & Close", cancelLabel: "Cancel" });
          if (!ok) return;
          await callApi("/api/stop", {});
        }
        stopManualSampling();                  // stop the background force poll on close
        resetGraphZoom("manualForceTimeGraph");   // clear any scroll-zoom so the next window opens normal
        // Restore the graph axis controls to defaults so the next manual window opens normal.
        resetGraphAxisSettings(
          { seconds: "manualSecondsToDisplay", yMin: "manualYAxisMin", yLimit: "manualYAxisLimit", showMarkers: "manualShowMarkers", cumulative: "manualCumulativeTime" },
          { seconds: 30, yMin: 0, yLimit: 50, showMarkers: true, cumulative: true });
        manualTestModal.close();
      }

      function setManualControlsLocked(isLocked) {
        // NOTE: the graph-display controls (Last Seconds, Y-Axis Min/Limit, Show Markers,
        // Cumulative Time) are deliberately NOT in this list - they only change how the
        // live graph is drawn, never the actuator or the test, so they stay editable
        // during a move. The continuous sampler redraws every ~100 ms, so a change to any
        // of them takes effect on the next frame even mid-move. Only controls that command
        // motion (or would queue a conflicting command) are locked while moving.
        [
          "manualTestCloseButton",
          "manualControlMode",
          "manualDistanceModeButton",
          "manualForceModeButton",
          "manualIncrementDistance",
          "manualTargetForce",
          "manualActuatorSpeed",
          "manualReleaseButton",
          "manualCompressionButton",
          "manualHomeButton",
          "manualDragPosition",
          "manualConfirmDragButton",
          "manualAnalysisButton",
        ].forEach((id) => {
          const element = document.getElementById(id);
          if (element) element.disabled = isLocked;
        });
        document.getElementById("manualPauseButton").disabled = !isLocked;
        if (!isLocked) {
          document.getElementById("manualAnalysisButton").disabled = manualData.length <= 1;
          updateManualTimeControls();
          updateManualControlMode();
        }
      }

      function pauseManualMotion() {
        // stop the live poll loop and tell the backend to halt the stepped move
        // (its loop checks STATE.stop_requested between steps).
        if (manualMotionTimer) {
          clearInterval(manualMotionTimer);
          manualMotionTimer = null;
        }
        callApi("/api/stop");
        setManualControlsLocked(false);
        setManualState("PAUSED", "manual actuator movement stopped. controls unlocked.");
      }

      function setManualControlMode(mode) {
        const controlMode = document.getElementById("manualControlMode");
        controlMode.value = mode;
        updateManualControlMode();
      }

      function updateManualControlMode() {
        const isForceMode = manualControlMode() === "force";
        const locked = isManualMoving();
        document.getElementById("manualPrimaryControlLabel").textContent = isForceMode ? "Target Force" : "Increment Distance";
        // the primary-control info icon is shared between modes - swap its tooltip so
        // Target Force gets its own description instead of the Increment Distance text.
        const primaryTip = document.querySelector("#manualPrimaryControlField .sensor-help");
        if (primaryTip) primaryTip.dataset.tooltip = isForceMode
          ? "Target compression force in Newtons for force-controlled manual testing. Maximum allowed force is 32 N."
          : "Distance used for each Move Up or Move Down click. Move Down adds distance from the actuator baseline; Move Up subtracts it.";
        document.getElementById("manualIncrementField").classList.toggle("hidden", isForceMode);
        document.getElementById("manualTargetForceField").classList.toggle("hidden", !isForceMode);
        document.getElementById("manualControlStack").classList.toggle("force-mode", isForceMode);
        document.getElementById("manualDistanceModeButton").classList.toggle("active", !isForceMode);
        document.getElementById("manualForceModeButton").classList.toggle("active", isForceMode);
        document.getElementById("manualReleaseButton").textContent = isForceMode ? "↑ Decompress" : "↑ MOVE UP";
        document.getElementById("manualCompressionButton").textContent = isForceMode ? "↓ Start Compression" : "↓ MOVE DOWN";
        document.getElementById("manualHomeButton").textContent = isForceMode ? "↻ Home" : "↻ HOME";
        document.getElementById("manualDragCard").classList.toggle("disabled", isForceMode);
        document.getElementById("manualDragPosition").disabled = isForceMode || locked || !manualStarted;
        document.getElementById("manualConfirmDragButton").disabled = isForceMode || locked || !manualStarted || Math.abs(manualPendingPosition - manualPosition) < 0.001;
        if (isForceMode) {
          document.getElementById("manualDragReadout").textContent = "drag position control disabled while force control is selected.";
        } else {
          document.getElementById("manualDragReadout").textContent = `selected position: ${manualPendingPosition.toFixed(1)} mm. travel from baseline: ${(manualPendingPosition - 17).toFixed(1)} mm.`;
        }
        if (!locked) {
          setManualState("READY", isForceMode ? "force control selected. Compress drives down to the target force; Decompress drives up to it." : "distance control selected. move buttons use increment distance.");
        }
      }

      function nextManualTime(distance) {
        const latestTime = manualData.length ? manualData[manualData.length - 1].time : 0;
        return latestTime + Math.abs(distance) / manualActuatorSpeed();
      }

      async function recordManualMove(distance, description) {
        const target = manualPosition + distance;
        if (target < ACTUATOR_MIN_MM || target > ACTUATOR_MAX_MM) {
          setManualState("READY", `move blocked - position would reach ${target.toFixed(2)} mm, outside actuator travel ${ACTUATOR_MIN_MM}-${ACTUATOR_MAX_MM} mm.`);
          return;
        }
        if (isManualMoving()) return;
        // Per-press connection checkpoint: re-confirm the live Zaber before every
        // manual move, the same gate Begin Test and each EM run use. On a real rig a
        // dropped connection blocks the move with the reconnect message + banner.
        if (!(await zaberStartGateOk())) return;
        // Lock all controls for the whole move and poll the backend for live
        // force/position - it streams real readings into the run status as it steps
        // the actuator, so the graphs update live (no faked values, no fixed timer).
        setManualControlsLocked(true);
        document.getElementById("manualConfirmDragButton").disabled = true;
        // No up-front wait pill: the manual window keeps the load cell open, so a move
        // starts immediately and the pill would just blink. The poll below shows WAITING
        // TO START only if the backend reports it is still initializing.
        const t0 = performance.now();
        let moveDone = false;    // stop a late status poll from re-showing MOVING after the move ends
        let lastStatus = "";
        console.log(`[manual move] START "${description}"  distance=${distance.toFixed(3)} mm  (force mode drives until the load cell reads the target)`);
        manualMotionTimer = setInterval(async () => {
          if (moveDone) return;
          const status = await callApi("/api/run-status");
          if (moveDone) return;
          if (!status || !status.ok) return;
          if (status.status !== lastStatus) {
            console.log(`[manual move] status -> ${status.status}  force=${Number(status.force || 0).toFixed(2)} N  pos=${Number(status.position || 0).toFixed(2)} mm  simulated=${status.simulated}`);
            lastStatus = status.status;
          }
          if (status.status === "waiting") {
            setManualState("WAITING TO START", "initializing load cell - please wait…");
            return;
          }
          const force = Number(status.force || 0);
          manualLiveForce = force;   // the continuous sampler records the graph point
          if (typeof status.position === "number") {
            manualPosition = status.position;
            manualPendingPosition = manualPosition;
            document.getElementById("manualDragPosition").value = manualPosition.toFixed(2);
            document.getElementById("manualDragReadout").textContent = `position: ${manualPosition.toFixed(1)} mm. travel from baseline: ${(manualPosition - 17).toFixed(1)} mm.`;
          }
          const motion = status.simulated ? "simulated motion" : "actuator moving";
          setManualState("MOVING", `${description}. ${motion}: ${force.toFixed(2)} N at ${manualPosition.toFixed(2)} mm.`);
        }, 100);

        const result = await moveApiWithTimeout({ distance, speed: manualActuatorSpeed() }, null);
        moveDone = true;
        console.log(`[manual move] /api/move returned after ${Math.round(performance.now() - t0)} ms`, result);

        if (manualMotionTimer) { clearInterval(manualMotionTimer); manualMotionTimer = null; }
        if (result && typeof result.position === "number") {
          manualPosition = result.position;
          manualPendingPosition = manualPosition;
          document.getElementById("manualDragPosition").value = manualPosition.toFixed(2);
          document.getElementById("manualDragReadout").textContent = `position: ${manualPosition.toFixed(1)} mm. travel from baseline: ${(manualPosition - 17).toFixed(1)} mm.`;
        }
        setManualControlsLocked(false);
        document.getElementById("manualAnalysisButton").disabled = manualData.length <= 1;
        if (result && result.stopped_for_safety) {
          setManualState("PAUSED", result.message || "Force limit reached. Manual move stopped for safety.");
          return;
        }
        if (!result || result.ok === false || result.disconnect) {
          if (result && result.disconnect) handleDisconnect(result);
          setManualState("ERROR", (result && result.message) || "Manual move failed.");
          return;
        }
        const sim = result.simulated ? " (simulated)" : "";
        setManualState("READY", `move complete${sim}. position ${manualPosition.toFixed(2)} mm.`);
      }

      // Force-feedback move: drive the actuator at the actuator speed until the load
      // cell reads the target force (down = compress to target, up = release toward 0).
      // The backend runs the feedback loop and streams live force; this locks the
      // controls and polls /api/run-status the same way the distance move does.
      async function recordManualForceMove(targetForce, direction, description) {
        if (isManualMoving()) return;
        // Per-press connection checkpoint, same as the distance move above.
        if (!(await zaberStartGateOk())) return;
        setManualControlsLocked(true);
        document.getElementById("manualConfirmDragButton").disabled = true;
        // No up-front wait pill (see the distance move above): the poll shows WAITING TO
        // START only if the backend is still initializing.
        const t0 = performance.now();
        let moveDone = false;
        let lastStatus = "";
        console.log(`[manual force] START "${description}"  target=${targetForce.toFixed(2)} N  dir=${direction}`);
        manualMotionTimer = setInterval(async () => {
          if (moveDone) return;
          const status = await callApi("/api/run-status");
          if (moveDone) return;
          if (!status || !status.ok) return;
          if (status.status !== lastStatus) {
            console.log(`[manual force] status -> ${status.status}  force=${Number(status.force || 0).toFixed(2)} N  pos=${Number(status.position || 0).toFixed(2)} mm  simulated=${status.simulated}`);
            lastStatus = status.status;
          }
          if (status.status === "waiting") {
            setManualState("WAITING TO START", "initializing load cell - please wait…");
            return;
          }
          const force = Number(status.force || 0);
          manualLiveForce = force;   // the continuous sampler records the graph point
          if (typeof status.position === "number") {
            manualPosition = status.position;
            manualPendingPosition = manualPosition;
            document.getElementById("manualDragPosition").value = manualPosition.toFixed(2);
            document.getElementById("manualDragReadout").textContent = `position: ${manualPosition.toFixed(1)} mm. travel from baseline: ${(manualPosition - 17).toFixed(1)} mm.`;
          }
          const motion = status.simulated ? "simulated motion" : "actuator moving";
          setManualState("MOVING", `${description}. ${motion}: ${force.toFixed(2)} N at ${manualPosition.toFixed(2)} mm.`);
        }, 100);

        // force search can take longer than a fixed jog, so allow more time than the
        // default; the backend has its own 120 s safety deadline.
        const result = await moveApiWithTimeout(
          { target_force: targetForce, direction, speed: manualActuatorSpeed() }, null, 130000, "/api/move-to-force");
        moveDone = true;
        console.log(`[manual force] /api/move-to-force returned after ${Math.round(performance.now() - t0)} ms`, result);
        if (manualMotionTimer) { clearInterval(manualMotionTimer); manualMotionTimer = null; }
        if (result && typeof result.position === "number") {
          manualPosition = result.position;
          manualPendingPosition = manualPosition;
          document.getElementById("manualDragPosition").value = manualPosition.toFixed(2);
          document.getElementById("manualDragReadout").textContent = `position: ${manualPosition.toFixed(1)} mm. travel from baseline: ${(manualPosition - 17).toFixed(1)} mm.`;
        }
        setManualControlsLocked(false);
        document.getElementById("manualAnalysisButton").disabled = manualData.length <= 1;
        if (result && result.stopped_for_safety) {
          setManualState("PAUSED", result.message || "Force limit reached. Manual move stopped for safety.");
          return;
        }
        if (!result || result.ok === false || result.disconnect) {
          if (result && result.disconnect) handleDisconnect(result);
          setManualState("ERROR", (result && result.message) || "Manual force move failed.");
          return;
        }
        const sim = result.simulated ? " (simulated)" : "";
        setManualState("READY", `${result.message || (description + " complete")}${sim}`);
      }

      function manualTestMove(direction) {
        if (isManualMoving()) return;
        if (manualControlMode() === "force") {
          const targetForceInput = document.getElementById("manualTargetForce");
          const targetForce = clampForce(targetForceInput.value);
          targetForceInput.value = targetForce;
          if (direction === "down") {
            recordManualForceMove(targetForce, "down", `compress to ${targetForce.toFixed(2)} N`);
          } else {
            // decompress releases UP until the load cell first reads the target force.
            recordManualForceMove(targetForce, "up", `decompress to ${targetForce.toFixed(2)} N`);
          }
          return;
        }
        const incrementInput = document.getElementById("manualIncrementDistance");
        const increment = Number(incrementInput.value || 0.1);
        if (!Number.isFinite(increment) || increment < 0.01 || increment > 12) {
          setManualState("READY", "increment distance must be between 0.01 mm and 12 mm.");
          incrementInput.value = Math.min(12, Math.max(0.01, increment || 0.1));
          return;
        }
        const signedDistance = direction === "down" ? increment : -increment;
        recordManualMove(signedDistance, `manual move ${direction}`);
      }

      function stageManualDragMove() {
        if (!manualStarted || manualControlMode() === "force" || isManualMoving()) return;
        manualPendingPosition = Number(document.getElementById("manualDragPosition").value || 17);
        const delta = manualPendingPosition - manualPosition;
        document.getElementById("manualDragReadout").textContent = `selected position: ${manualPendingPosition.toFixed(1)} mm. travel from baseline: ${(manualPendingPosition - 17).toFixed(1)} mm. pending move: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} mm.`;
        document.getElementById("manualConfirmDragButton").disabled = Math.abs(delta) < 0.001;
        setManualState("READY", `drag move staged to ${manualPendingPosition.toFixed(1)} mm. press Confirm Drag Move to apply.`);
      }

      function confirmManualDragMove() {
        if (manualControlMode() === "force" || isManualMoving()) return;
        const distance = manualPendingPosition - manualPosition;
        if (Math.abs(distance) < 0.001) {
          document.getElementById("manualConfirmDragButton").disabled = true;
          return;
        }
        recordManualMove(distance, "confirmed drag move");
      }

      function manualTestHome() {
        if (isManualMoving()) return;
        const homeDistance = 17 - manualPosition;
        if (Math.abs(homeDistance) < 0.001) {
          setManualState("READY", "already at home position (17 mm).");
          return;
        }
        // route home through the same streamed, force-monitored, locked move so it
        // updates the graphs live and locks the controls while it travels.
        recordManualMove(homeDistance, "returning actuator to home");
      }

      function addManualPoint(force, time) {
        // no capacitance sensor in the manual window - leave it null (see startManualSampling).
        manualData.push({ time, force, capacitance: null });
      }

      // Empty-state for the capacitance graphs: the manual window records force only,
      // so the two cap graphs render a centered "no data" note instead of a fake line.
      function drawManualCapPlaceholder(svgId) {
        const graph = document.getElementById(svgId);
        if (!graph) return;
        const viewBox = graph.viewBox?.baseVal;
        const width = viewBox?.width || 420;
        const height = viewBox?.height || 260;
        graph.innerHTML = `
          <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
          <text x="${width / 2}" y="${height / 2 - 6}" text-anchor="middle" fill="#9aa6b8" font-size="14" font-family="Inter, sans-serif">No capacitance data</text>
          <text x="${width / 2}" y="${height / 2 + 14}" text-anchor="middle" fill="#b4bdcc" font-size="11" font-family="Inter, sans-serif">manual window records force only</text>
        `;
        if (typeof setGraphHoverPoints === "function") setGraphHoverPoints(svgId, []);
      }

      function manualGraphSettings() {
        const yMin = Number(document.getElementById("manualYAxisMin").value || 0);
        const yLimit = Number(document.getElementById("manualYAxisLimit").value || 50);
        return {
          seconds: Math.max(1, Number(document.getElementById("manualSecondsToDisplay").value || 30)),
          yMin,
          yLimit: Math.max(yMin + 1, yLimit),
          showMarkers: document.getElementById("manualShowMarkers").checked,
          cumulativeTime: document.getElementById("manualCumulativeTime").checked,
        };
      }

      function updateManualTimeControls() {
        document.getElementById("manualSecondsToDisplay").disabled = document.getElementById("manualCumulativeTime").checked;
      }

      function drawManualGraphs() {
        updateManualTimeControls();
        const settings = manualGraphSettings();
        // live manual graphs autoscale: force axes start at 0-5 N and grow, and
        // capacitance axes track a sensible band around the data as it comes in.
        settings.autoScale = true;
        const latest = manualData.length ? manualData[manualData.length - 1].time : 0;
        const startTime = settings.cumulativeTime ? 0 : Math.max(0, latest - settings.seconds);
        let visible = manualData.filter((point) => point.time >= startTime);
        // before any data exists, seed a reasonable starting view (force ~0-5 N) so the
        // empty Force vs Time graph opens sensibly.
        if (!visible.length) visible = [{ time: 0, force: 0 }];
        // Force vs Time is the only live graph - the manual window records load-cell
        // force continuously from the moment it opens. There is no capacitance sensor,
        // so the two capacitance graphs show an explicit empty state, never fake data.
        // Register it as zoomable BEFORE drawing so drawMiniGraph routes its range through
        // the scroll-zoom view; scroll the wheel over it to zoom, double-click to reset.
        registerZoomGraph("manualForceTimeGraph", drawManualGraphs, { left: 58, right: 18, top: 34, bottom: 42 });
        drawMiniGraph("manualForceTimeGraph", visible, "time", "force", "Time (s)", "Force (N)", settings);
        drawManualCapPlaceholder("manualCapForceGraph");
        drawManualCapPlaceholder("manualCapTimeGraph");
      }

      async function performManualAnalysis() {
        // Guard against being invoked without valid data: the button is gated
        // (disabled when manualData.length <= 1), but show a clear message rather
        // than opening an empty analysis window if it is ever called regardless.
        if (manualData.length <= 1) {
          setManualState("READY", "No manual test data available to analyze");
          showErrorDialog("No manual test data available to analyze", "No data to analyze");
          return;
        }
        // Perform Analysis is the end of the recording boundary: stop the live readout
        // and re-arm Start so the next session begins cleanly. The frozen trace below
        // is what gets analyzed.
        stopManualSampling();
        setManualSessionActive(false);
        document.getElementById("manualAnalysisButton").disabled = true;
        const result = await runAnalysisProgress("Generating manual analysis outputs...", () => callApi("/api/perform-analysis", {
          manual_readings: manualData,
        }));
        document.getElementById("manualAnalysisButton").disabled = false;
        if (!result.ok) return;
        setManualState("ANALYSIS", result.message || "manual analysis generated from the current preview data.");
        manualImages = (result.analysis && result.analysis.manual_images) ? result.analysis.manual_images : null;
        renderInteractivePanel("manual", result.analysis || null);
        manualAnalysisZoom = 1;
        populateManualAnalysis();
        manualAnalysisModal.showModal();
      }

      function setManualAnalysisZoom(zoom) {
        manualAnalysisZoom = Math.min(12, Math.max(1, zoom));
        const activePanel = document.querySelector('[id^="manual-"].tab-panel.active');
        populateManualAnalysis(activePanel ? activePanel.id.replace("manual-", "") : "capForce");
      }

      function populateManualAnalysis(activeTab = "capForce") {
        // when the real matplotlib engine ran, show its PNG figures instead.
        if (manualImages) {
          document.getElementById("manual-capForce").innerHTML =
            `<div class="em-analysis-png-wrap">${emPngImg(manualImages.cap_vs_force, "Capacitance vs Force")}</div>`;
          document.getElementById("manual-forceTime").innerHTML =
            `<div class="em-analysis-png-wrap">${emPngImg(manualImages.force_vs_time, "Force vs Time")}</div>`;
          document.getElementById("manual-capTime").innerHTML =
            `<div class="em-analysis-png-wrap">${emPngImg(manualImages.cap_vs_time, "Capacitance vs Time")}</div>`;
          showAnalysisTab("manual", activeTab);
          return;
        }
        // Manual data exists but none of it parses into finite numeric readings:
        // show the same per-tab "could not be read" notice rather than empty graphs.
        const parsedReadings = manualData.filter((point) => Number.isFinite(Number(point.time)) && Number.isFinite(Number(point.force)));
        if (manualData.length && !parsedReadings.length) {
          const unreadable = `<p class="analysis-unavailable">Manual test data could not be read; results may be incomplete</p>`;
          document.getElementById("manual-capForce").innerHTML = unreadable;
          document.getElementById("manual-forceTime").innerHTML = unreadable;
          document.getElementById("manual-capTime").innerHTML = unreadable;
          showAnalysisTab("manual", activeTab);
          return;
        }
        document.getElementById("manual-capForce").innerHTML = `
          <div class="graph-wrap manual-graph"><svg id="manualAnalysisCapForceGraph" viewBox="0 0 980 560" role="img" aria-label="Manual analysis capacitance versus force graph"></svg></div>
        `;
        document.getElementById("manual-forceTime").innerHTML = `
          <div class="graph-wrap manual-graph"><svg id="manualAnalysisForceTimeGraph" viewBox="0 0 980 560" role="img" aria-label="Manual analysis force versus time graph"></svg></div>
        `;
        document.getElementById("manual-capTime").innerHTML = `
          <div class="graph-wrap manual-graph"><svg id="manualAnalysisCapTimeGraph" viewBox="0 0 980 560" role="img" aria-label="Manual analysis capacitance versus time graph"></svg></div>
        `;
        const settings = { ...manualGraphSettings(), showMarkers: true, cumulativeTime: true, autoY: true };
        const latest = manualData.length ? manualData[manualData.length - 1].time : 0;
        const first = manualData.length ? manualData[0].time : 0;
        const fullSpan = Math.max(0.1, latest - first);
        const visibleSpan = fullSpan / manualAnalysisZoom;
        const startTime = Math.max(first, latest - visibleSpan);
        const visible = manualData.filter((point) => point.time >= startTime);
        // Force vs Time is the only real manual measurement; the capacitance tabs show
        // the same empty state as the live window (no capacitance sensor here).
        drawMiniGraph("manualAnalysisForceTimeGraph", visible, "time", "force", "Time (s)", "Force (N)", settings);
        drawManualCapPlaceholder("manualAnalysisCapForceGraph");
        drawManualCapPlaceholder("manualAnalysisCapTimeGraph");
        showAnalysisTab("manual", activeTab);
      }

      async function manualMove(distance) {
        if (calibrationMoveInFlight) {
          console.warn("[calibration jog] ignored a click - a move is already in flight");
          return;
        }
        const target = currentPosition + distance;
        if (target < ACTUATOR_MIN_MM || target > ACTUATOR_MAX_MM) {
          addCalibrationUpdate(`ERROR: move blocked - position would reach ${target.toFixed(2)} mm, outside actuator travel ${ACTUATOR_MIN_MM}-${ACTUATOR_MAX_MM} mm.`);
          return;
        }
        calibrationMoveInFlight = true;
        // moveDone guards against a late status poll re-locking the controls AFTER the
        // move has finished: setInterval fires an async callback that awaits /api/run-
        // status, so a poll already in flight when the move ends would otherwise call
        // setCalibrationControlsLocked(true, ...) after we unlocked - leaving the window
        // stuck on "MOVING" with everything disabled. This was the intermittent bug.
        let moveDone = false;
        const startedAt = performance.now();
        console.log(`[calibration jog] START distance=${distance.toFixed(3)} mm  from ${currentPosition.toFixed(2)} -> ${target.toFixed(2)} mm`);
        // lock the whole calibration window while the stage travels (queueing more
        // commands would flood the Zaber). No up-front wait pill - the poll shows WAITING
        // TO START only if the load cell is still initializing, then MOVING during travel.
        setCalibrationControlsLocked(true);
        addCalibrationUpdate(`moving ${distance < 0 ? "up" : "down"} by ${Math.abs(distance).toFixed(2)} mm…`);
        let lastStatus = "";
        const pollTimer = setInterval(async () => {
          if (moveDone) return;                       // move finished - stop touching the UI
          const status = await callApi("/api/run-status");
          if (moveDone) return;                       // it finished while this poll was in flight - do NOT re-lock
          if (!status || !status.ok) return;
          if (status.status !== lastStatus) {
            console.log(`[calibration jog] status -> ${status.status}  pos=${Number(status.position || 0).toFixed(2)} mm  force=${Number(status.force || 0).toFixed(2)} N`);
            lastStatus = status.status;
          }
          if (typeof status.position === "number") setPositionReadout(status.position);
          if (status.status === "waiting") {
            setCalibrationControlsLocked(true, "WAITING TO START", "initializing load cell - please wait…", "discarded");
          } else {
            setCalibrationControlsLocked(true, "MOVING",
              `actuator moving - ${Number(status.force || 0).toFixed(2)} N at ${Number(status.position || 0).toFixed(2)} mm`, "discarded");
          }
        }, 100);
        let disconnected = false;
        try {
          const result = await moveApiWithTimeout({ distance }, `Manual control: Moving stage ${distance > 0 ? "DOWN" : "UP"}`);
          console.log(`[calibration jog] /api/move returned after ${Math.round(performance.now() - startedAt)} ms`, result);
          // update the readout once the stage has finished moving.
          if (result && result.timeout) {
            addCalibrationUpdate("WARNING: move timed out - controls unlocked. Check the actuator.");
          } else if (result && result.disconnect) {
            disconnected = true;
            addCalibrationUpdate(result.message || "Actuator connection lost. Check the cable before continuing.");
            handleDisconnect(result);
          } else if (result && result.stopped_for_safety) {
            if (typeof result.position === "number") setPositionReadout(result.position);
            addCalibrationUpdate(result.message || "Force limit reached. Move stopped for safety.");
          } else if (result && typeof result.position === "number") {
            setPositionReadout(result.position);
            addCalibrationUpdate(`move complete. position ${result.position.toFixed(2)} mm.`);
          }
        } finally {
          // mark done BEFORE clearing the timer so any in-flight poll bails out, then
          // ALWAYS unlock so the controls can never get stuck showing "moving".
          moveDone = true;
          clearInterval(pollTimer);
          calibrationMoveInFlight = false;
          if (disconnected) {
            setCalibrationControlsLocked(false, "DISCONNECTED", "actuator disconnected - use the Zaber Launcher.", "discarded");
          } else {
            setCalibrationControlsLocked(false, "READY", "actuator idle. controls ready.", "kept");
          }
          console.log(`[calibration jog] DONE (disconnected=${disconnected}) - controls unlocked`);
        }
      }
