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
        manualData = [];
        manualPosition = 17;
        manualPendingPosition = 17;
        manualStatusLines = [];
        document.getElementById("manualDragPosition").value = 17;
        document.getElementById("manualDragReadout").textContent = "selected position: 17.0 mm. travel from baseline: 0.0 mm.";
        document.getElementById("manualConfirmDragButton").disabled = true;
        document.getElementById("manualPauseButton").disabled = true;
        document.getElementById("manualAnalysisButton").disabled = true;
        setManualControlsLocked(false);
        updateManualControlMode();
        setManualState("READY", "manual controls ready. baseline position is 17 mm.");
        addManualPoint(0, 0);
        drawManualGraphs();
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

      function setManualControlsLocked(isLocked) {
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
          "manualSecondsToDisplay",
          "manualYAxisMin",
          "manualYAxisLimit",
          "manualShowMarkers",
          "manualCumulativeTime",
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
        document.getElementById("manualIncrementField").classList.toggle("hidden", isForceMode);
        document.getElementById("manualTargetForceField").classList.toggle("hidden", !isForceMode);
        document.getElementById("manualControlStack").classList.toggle("force-mode", isForceMode);
        document.getElementById("manualDistanceModeButton").classList.toggle("active", !isForceMode);
        document.getElementById("manualForceModeButton").classList.toggle("active", isForceMode);
        document.getElementById("manualReleaseButton").textContent = isForceMode ? "↑ Decompress" : "↑ MOVE UP";
        document.getElementById("manualCompressionButton").textContent = isForceMode ? "↓ Start Compression" : "↓ MOVE DOWN";
        document.getElementById("manualHomeButton").textContent = isForceMode ? "↻ Home" : "↻ HOME";
        document.getElementById("manualDragCard").classList.toggle("disabled", isForceMode);
        document.getElementById("manualDragPosition").disabled = isForceMode || locked;
        document.getElementById("manualConfirmDragButton").disabled = isForceMode || locked || Math.abs(manualPendingPosition - manualPosition) < 0.001;
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
        // Lock all controls for the whole move and poll the backend for live
        // force/position - it streams real readings into the run status as it steps
        // the actuator, so the graphs update live (no faked values, no fixed timer).
        setManualControlsLocked(true);
        document.getElementById("manualConfirmDragButton").disabled = true;
        setManualState("WAITING TO START", "initializing load cell - please wait…");
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
          if (typeof status.position === "number") {
            manualPosition = status.position;
            manualPendingPosition = manualPosition;
            document.getElementById("manualDragPosition").value = manualPosition.toFixed(2);
            document.getElementById("manualDragReadout").textContent = `position: ${manualPosition.toFixed(1)} mm. travel from baseline: ${(manualPosition - 17).toFixed(1)} mm.`;
          }
          const time = (performance.now() - t0) / 1000;
          manualData.push({ time, force, capacitance: 12 + force * 0.32 });
          drawManualGraphs();
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
          setManualState("ERROR", (result && result.message) || "Manual move failed.");
          return;
        }
        const mode = result.simulated ? "simulated" : "real";
        setManualState("READY", `move complete (${mode}). position ${manualPosition.toFixed(2)} mm.`);
      }

      // Force-feedback move: drive the actuator at the actuator speed until the load
      // cell reads the target force (down = compress to target, up = release toward 0).
      // The backend runs the feedback loop and streams live force; this locks the
      // controls and polls /api/run-status the same way the distance move does.
      async function recordManualForceMove(targetForce, direction, description) {
        if (isManualMoving()) return;
        setManualControlsLocked(true);
        document.getElementById("manualConfirmDragButton").disabled = true;
        setManualState("WAITING TO START", "initializing load cell - please wait…");
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
          if (typeof status.position === "number") {
            manualPosition = status.position;
            manualPendingPosition = manualPosition;
            document.getElementById("manualDragPosition").value = manualPosition.toFixed(2);
            document.getElementById("manualDragReadout").textContent = `position: ${manualPosition.toFixed(1)} mm. travel from baseline: ${(manualPosition - 17).toFixed(1)} mm.`;
          }
          const time = (performance.now() - t0) / 1000;
          manualData.push({ time, force, capacitance: 12 + force * 0.32 });
          drawManualGraphs();
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
          if (result && result.disconnect) showDisconnectDialog(result.message);
          setManualState("ERROR", (result && result.message) || "Manual force move failed.");
          return;
        }
        const mode = result.simulated ? "simulated" : "real";
        setManualState("READY", `${result.message || (description + " complete")} (${mode})`);
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
            recordManualForceMove(targetForce, "up", `decompress to ${targetForce.toFixed(2)} N`);
          }
          return;
        }
        const incrementInput = document.getElementById("manualIncrementDistance");
        const increment = Number(incrementInput.value || 0.1);
        if (!Number.isFinite(increment) || increment < 0.01 || increment > 15) {
          setManualState("READY", "increment distance must be between 0.01 mm and 15 mm.");
          incrementInput.value = Math.min(15, Math.max(0.01, increment || 0.1));
          return;
        }
        const signedDistance = direction === "down" ? increment : -increment;
        recordManualMove(signedDistance, `manual move ${direction}`);
      }

      function stageManualDragMove() {
        if (manualControlMode() === "force" || isManualMoving()) return;
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
        manualData.push({ time, force, capacitance: 12 + force * 0.32 });
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
        // before any data exists, seed a reasonable starting view (force ~0-5 N,
        // capacitance around its resting value) so the empty graphs open sensibly.
        if (!visible.length) visible = [{ time: 0, force: 0, capacitance: 12 }];
        drawMiniGraph("manualCapForceGraph", visible, "force", "capacitance", "Force (N)", "Capacitance", settings);
        drawMiniGraph("manualForceTimeGraph", visible, "time", "force", "Time (s)", "Force (N)", settings);
        drawMiniGraph("manualCapTimeGraph", visible, "time", "capacitance", "Time (s)", "Capacitance", settings);
      }

      async function performManualAnalysis() {
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
        drawMiniGraph("manualAnalysisCapForceGraph", visible, "force", "capacitance", "Force (N)", "Capacitance", settings);
        drawMiniGraph("manualAnalysisForceTimeGraph", visible, "time", "force", "Time (s)", "Force (N)", settings);
        drawMiniGraph("manualAnalysisCapTimeGraph", visible, "time", "capacitance", "Time (s)", "Capacitance", settings);
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
        // commands would flood the Zaber), and show WAITING TO START while the load
        // cell initializes, then MOVING during the continuous travel.
        setCalibrationControlsLocked(true, "WAITING TO START", "initializing load cell - please wait…", "discarded");
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
            addCalibrationUpdate(result.message || "Actuator connection lost during the move.");
            showDisconnectDialog(result.message);
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
