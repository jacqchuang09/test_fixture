/*
 * fatigue.js — Fatigue (cyclical) test window.
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
        return Math.min(32, Math.max(-20, Number(value || 0)));
      }

      function cyclicalBounds() {
        const lowerInput = document.getElementById("cyclicalLowerForce");
        const upperInput = document.getElementById("cyclicalUpperForce");
        const lowerForce = clampCyclicalLowerForce(lowerInput.value);
        const upperForce = clampForce(upperInput.value);
        lowerInput.value = lowerForce;
        upperInput.value = upperForce;
        return { lowerForce, upperForce, isValid: upperForce > lowerForce };
      }

      function cyclicalForceValue(type, time, lowerForce, upperForce, frequency) {
        const low = clampCyclicalLowerForce(lowerForce);
        const high = clampForce(upperForce);
        const middle = (low + high) / 2;
        const amplitude = (high - low) / 2;
        const phase = (time * frequency) % 1;
        if (type === "Square") {
          return phase < 0.5 ? high : low;
        }
        return middle + amplitude * Math.sin(2 * Math.PI * frequency * time);
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
        drawWaveformSvg("cyclicalGraph", points, "time", "force", "Time (s)", "Force (N)", Math.min(0, lowForce), Math.max(1, highForce), duration);
        updateCyclicalEstimate();
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

      function startCyclicalTest() {
        if (cyclicalTimer || cyclicalReturnHomeTimer) return;
        const { isValid } = cyclicalBounds();
        if (!isValid) {
          setStatePill("cyclicalState", "ERROR", "upper force bound must be higher than lower force bound.");
          return;
        }
        cyclicalData = [];
        cyclicalStartedAt = performance.now();
        setCyclicalControlsLocked(true);
        document.getElementById("cyclicalPauseButton").disabled = false;
        setStatePill("cyclicalState", "RUNNING", "actuator cycling force bounds to simulate sensor lifespan.");
        cyclicalTimer = setInterval(recordCyclicalPoint, 100);
      }

      function recordCyclicalPoint() {
        const cfg = config();
        const elapsedSeconds = (performance.now() - cyclicalStartedAt) / 1000;
        const { lowerForce, upperForce, isValid } = cyclicalBounds();
        if (!isValid) {
          pauseCyclicalTest("ERROR: upper force bound must be higher than lower force bound.");
          return;
        }
        const frequency = Math.max(0.01, cfg.waveform_frequency);
        const force = cyclicalForceValue(cfg.waveform_type, elapsedSeconds, lowerForce, upperForce, frequency);
        cyclicalData.push({ time: elapsedSeconds, force });
        drawCyclicalPreview();
        if (elapsedSeconds >= cyclicalEstimatedSeconds()) {
          pauseCyclicalTest("COMPLETED: cyclical fatigue test completed.");
        }
      }

      function pauseCyclicalTest(message = "STOPPED: cyclical fatigue test stopped.") {
        clearInterval(cyclicalTimer);
        cyclicalTimer = null;
        setCyclicalControlsLocked(true);
        const [state, ...body] = message.split(":");
        setStatePill("cyclicalState", "RETURNING_HOME", "actuator stopping and returning to home position. controls locked.");
        cyclicalReturnHomeTimer = setTimeout(() => {
          cyclicalReturnHomeTimer = null;
          setCyclicalControlsLocked(false);
          document.getElementById("cyclicalStartButton").disabled = false;
          document.getElementById("cyclicalPauseButton").disabled = true;
          setStatePill("cyclicalState", state, body.join(":").trim());
        }, 5000);
      }
