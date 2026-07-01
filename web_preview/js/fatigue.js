/*
 * fatigue.js - Fatigue (cyclical) test window.
 *
 * Owns the cyclical fatigue modal: builds the target force waveform from the
 * user's bounds/frequency/cycle count, previews it, runs the cycle loop, and
 * records points as the test progresses.
 *
 * Structure:
 *   - Waveform math: clampCyclicalLowerForce, cyclicalBounds,
 *     cyclicalForceValue, cyclicalEstimatedSeconds, updateCyclicalEstimate.
 *   - Preview + run: drawCyclicalPreview, startCyclicalTest,
 *     recordCyclicalPoint, pauseCyclicalTest, resetCyclicalTest,
 *     setCyclicalControlsLocked.
 *
 * Reads shared.js globals (cyclicalData, cyclicalTimer, cyclicalStartedAt)
 * and the shared drawWaveformSvg / formatDuration helpers.
 */


      function clampCyclicalLowerForce(value) {
        return Math.min(32, Math.max(0, Number(value || 0)));
      }

      function cyclicalBounds() {
        // read + clamp for computing the preview only - do NOT write the values
        // back into the inputs here, or the live preview (which fires on every
        // keystroke) would erase a decimal point as you type it. The fields are
        // normalized on change/blur instead (normalizeNumberField in main.js).
        const lowerForce = clampCyclicalLowerForce(document.getElementById("cyclicalLowerForce").value);
        const upperForce = clampForce(document.getElementById("cyclicalUpperForce").value);
        return { lowerForce, upperForce, isValid: upperForce > lowerForce };
      }

      // Shape of one fatigue cycle, on a normalized phase 0..1, returned on a
      // 0..1 scale (0 = lower bound, 1 = upper bound). Kept in lockstep with the
      // backend target_force() in run_engine.py so the preview matches what the
      // actuator actually does. Every shape starts and ends near the lower bound.
      function cyclicalShape(type, phase) {
        switch (type) {
          case "Square":
            // hold at the upper bound for the first half, lower for the second.
            return phase < 0.5 ? 1 : 0;
          case "Triangle":
            // steady ramp up to the peak at mid-cycle, then a steady ramp down.
            return phase < 0.5 ? phase / 0.5 : (1 - phase) / 0.5;
          case "Sawtooth":
            // ramp up across the whole cycle, then a fast release back to lower.
            return phase;
          case "Blood Pressure": {
            // arterial pulse: sharp systolic upstroke and peak, a smaller dicrotic
            // wave after the notch, then a slow diastolic decay back to lower.
            const systolic = Math.exp(-Math.pow((phase - 0.18) / 0.085, 2));
            const dicrotic = 0.45 * Math.exp(-Math.pow((phase - 0.42) / 0.13, 2));
            return (systolic + dicrotic) / 1.015; // normalize so the peak hits 1
          }
          case "Sine":
          default:
            // smooth press/release: starts at lower, peaks at upper at mid-cycle.
            return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
        }
      }

      function cyclicalForceValue(type, time, lowerForce, upperForce, frequency) {
        const low = clampCyclicalLowerForce(lowerForce);
        const high = clampForce(upperForce);
        const phase = (time * frequency) % 1;
        return low + (high - low) * cyclicalShape(type, phase);
      }

      function cyclicalEstimatedSeconds() {
        const cfg = config();
        return cfg.cyclical_cycle_count / Math.max(0.01, cfg.waveform_frequency);
      }

      function updateCyclicalEstimate() {
        const estimate = document.getElementById("cyclicalEstimate");
        if (!estimate) return;
        estimate.textContent = `This test will take approximately ${formatDuration(cyclicalEstimatedSeconds())}.`;
      }

      function cyclicalGraphSettings() {
        return {
          seconds: Math.max(1, Number(document.getElementById("cyclicalSecondsToDisplay").value || 30)),
          cumulativeTime: document.getElementById("cyclicalCumulativeTime").checked,
        };
      }

      function updateCyclicalTimeControls() {
        const secondsInput = document.getElementById("cyclicalSecondsToDisplay");
        if (secondsInput) secondsInput.disabled = document.getElementById("cyclicalCumulativeTime").checked;
      }

      function drawCyclicalPreview() {
        const cfg = config();
        const waveformType = cfg.waveform_type;
        const { lowerForce, upperForce, isValid } = cyclicalBounds();
        const lowForce = Math.min(lowerForce, upperForce);
        const highForce = Math.max(lowerForce, upperForce);
        const frequency = Math.max(0.01, cfg.waveform_frequency);
        const period = 1 / frequency;
        const duration = cyclicalData.length ? Math.max(5, cyclicalData[cyclicalData.length - 1].time) : Math.max(5, period * 5);
        const points = cyclicalData.length ? cyclicalData : Array.from({ length: 180 }, (_, index) => {
          const time = (index / 179) * duration;
          return {
            time,
            force: cyclicalForceValue(waveformType, time, lowerForce, upperForce, frequency),
          };
        });
        if (!cyclicalTimer) {
          let message;
          if (!isValid) {
            message = "upper force bound must be higher than lower force bound.";
          } else {
            message = `${waveformType.toLowerCase()} fatigue cycle configured.`;
            if (highForce > ACTUATOR_PEAK_THRUST_N) {
              message += ` warning: ${highForce.toFixed(1)} N exceeds the actuator's ${ACTUATOR_PEAK_THRUST_N} N peak thrust and may not be reachable.`;
            }
          }
          setStatePill("cyclicalState", isValid ? "READY" : "ERROR", message);
        }
        // Default view: cumulative (whole waveform) or the last N seconds; scroll to zoom
        // on top. Bounds are the full generated span, so zoom/pan can't go past it.
        updateCyclicalTimeControls();
        const settings = cyclicalGraphSettings();
        const latest = points.length ? points[points.length - 1].time : duration;
        const fullXMax = Math.max(1, duration);
        const yLo = Math.min(0, lowForce), yHi = Math.max(1, highForce);
        const bounds = { xMin: 0, xMax: fullXMax, yMin: yLo, yMax: yHi };
        const defXMin = settings.cumulativeTime ? 0 : Math.max(0, latest - settings.seconds);
        const defXMax = settings.cumulativeTime ? fullXMax : Math.max(latest, defXMin + settings.seconds);
        const view = graphViewRange("cyclicalGraph", { xMin: defXMin, xMax: defXMax, yMin: yLo, yMax: yHi }, bounds);
        drawWaveformSvg("cyclicalGraph", points, "time", "force", "Time (s)", "Force (N)", view.yMin, view.yMax, view.xMax, view.xMin);
        registerZoomGraph("cyclicalGraph", drawCyclicalPreview, { left: 92, right: 24, top: 58, bottom: 52 });
        updateCyclicalEstimate();
      }

      // Close the Fatigue Testing Window. If a run is active, warn first (1.11.14):
      // Confirm stops the test (the backend returns the actuator to a safe position) and
      // closes; Cancel leaves the window open and the test running.
      async function closeCyclicalTestWindow() {
        if (cyclicalTimer || cyclicalReturnHomeTimer) {
          const ok = await promptConfirm(
            "A fatigue test is in progress. Closing will stop the test and return the actuator to a safe position. Continue?",
            { title: "Test in progress", confirmLabel: "Stop & Close", cancelLabel: "Cancel" });
          if (!ok) return;
          clearInterval(cyclicalTimer);
          clearTimeout(cyclicalReturnHomeTimer);
          cyclicalTimer = null;
          cyclicalReturnHomeTimer = null;
          await callApi("/api/stop", {});
        }
        stopReconnectWatch();
        resetGraphZoom("cyclicalGraph");   // clear any scroll-zoom so the next window opens normal
        resetGraphAxisSettings(
          { seconds: "cyclicalSecondsToDisplay", cumulative: "cyclicalCumulativeTime" },
          { seconds: 30, cumulative: true });
        cyclicalTestModal.close();
      }

      function setCyclicalControlsLocked(isLocked) {
        ["cyclicalStartButton", "waveformType", "cyclicalLowerForce", "cyclicalUpperForce", "waveformFrequency", "cyclicalCycleCount", "cyclicalTestCloseButton"].forEach((id) => {
          const element = document.getElementById(id);
          if (element) element.disabled = isLocked;
        });
        document.getElementById("cyclicalPauseButton").disabled = !isLocked;
      }

      function resetCyclicalTest() {
        clearInterval(cyclicalTimer);
        clearTimeout(cyclicalReturnHomeTimer);
        cyclicalTimer = null;
        cyclicalReturnHomeTimer = null;
        cyclicalStartedAt = null;
        cyclicalData = [];
        setCyclicalControlsLocked(false);
        document.getElementById("cyclicalStartButton").disabled = false;
        document.getElementById("cyclicalPauseButton").disabled = true;
        setStatePill("cyclicalState", "READY", "cyclical fatigue test ready.");
        updateCyclicalEstimate();
      }

      async function startCyclicalTest() {
        if (cyclicalTimer || cyclicalReturnHomeTimer) return;
        const { isValid } = cyclicalBounds();
        if (!isValid) {
          setStatePill("cyclicalState", "ERROR", "upper force bound must be higher than lower force bound.");
          return;
        }
        // Fatigue drives the real actuator - require a live Zaber on a real rig
        // (stays soft in simulation so dev/demo runs still work).
        if (!(await zaberStartGateOk())) return;
        cyclicalData = [];
        cyclicalStartedAt = performance.now();
        setCyclicalControlsLocked(true);
        document.getElementById("cyclicalPauseButton").disabled = false;
        // the actuator + load cell take a moment to initialize; show a clear wait
        // state (controls already locked) until the cycling actually starts.
        setStatePill("cyclicalState", "WAITING TO START", "initializing actuator and load cell - please wait…");
        const result = await callApi("/api/start-cyclical", config());
        if (!result || !result.ok) {
          setCyclicalControlsLocked(false);
          document.getElementById("cyclicalStartButton").disabled = false;
          document.getElementById("cyclicalPauseButton").disabled = true;
          setStatePill("cyclicalState", "ERROR", (result && result.message) || "could not start fatigue test.");
          return;
        }
        // the poll flips WAITING TO START -> RUNNING once the cycling actually starts.
        cyclicalTimer = setInterval(pollCyclicalStatus, 100);
      }

      // poll the backend fatigue run for live force/cycle and react to completion.
      async function pollCyclicalStatus() {
        const status = await callApi("/api/run-status");
        if (!status || !status.ok) return;
        if (status.status === "waiting") {
          setStatePill("cyclicalState", "WAITING TO START", "initializing actuator and load cell - please wait…");
          return;
        }
        const force = Number(status.force || 0);
        const cycle = Number(status.cycle || 0);
        const totalCycles = Number(status.total_cycles || 0);
        // rebuild the live waveform from the backend's dense 100 Hz window so the
        // trace is smooth (not one aliased point per poll). Times are normalized
        // so the window starts at 0 and scrolls as the run progresses.
        if (Array.isArray(status.trace) && status.trace.length) {
          const t0 = status.trace[0][0];
          cyclicalData = status.trace.map((point) => ({ time: point[0] - t0, force: point[1] }));
          drawCyclicalPreview();
        }
        if (status.status === "running") {
          setStatePill("cyclicalState", "RUNNING", `cycle ${cycle}${totalCycles ? ` / ${totalCycles}` : ""} - force ${force.toFixed(2)} N.`);
        }
        if (status.status === "completed" || status.status === "stopped" || status.status === "error") {
          clearInterval(cyclicalTimer);
          cyclicalTimer = null;
          finishCyclicalRun(status);
        }
      }

      function finishCyclicalRun(status) {
        setCyclicalControlsLocked(false);
        document.getElementById("cyclicalPauseButton").disabled = true;
        if (status.disconnect) {
          // no auto-reconnect: the operator fixes it with the Zaber Launcher (move back
          // to home), reconnects, then restarts. Leave Start enabled for that.
          document.getElementById("cyclicalStartButton").disabled = false;
          setStatePill("cyclicalState", "DISCONNECTED", status.message || "Actuator connection lost.", "discarded");
          showDisconnectDialog(status.message);
          return;
        }
        if (status.safety_stop) {
          // safety trip (force spike / ceiling / travel limit): the engine already
          // stopped and homed. Dialog, then restart the fatigue test on Continue.
          document.getElementById("cyclicalStartButton").disabled = false;
          setStatePill("cyclicalState", "STOPPED", status.message || "Fatigue test stopped for safety.");
          showSafetyStopDialog(status.message);   // no auto-restart - press Start to run again
          return;
        }
        document.getElementById("cyclicalStartButton").disabled = false;
        const stateTag = { completed: "COMPLETED", stopped: "STOPPED", error: "ERROR" }[status.status] || "READY";
        setStatePill("cyclicalState", stateTag, status.message || "fatigue test finished.");
      }

      async function pauseCyclicalTest() {
        // stop the real run; the backend halts the actuator, homes it, saves the
        // data, and reports 'stopped' on the next poll (which finishes the UI).
        document.getElementById("cyclicalPauseButton").disabled = true;
        setStatePill("cyclicalState", "RETURNING_HOME", "stopping… actuator returning to home position. controls locked.");
        await callApi("/api/stop", {});
      }
