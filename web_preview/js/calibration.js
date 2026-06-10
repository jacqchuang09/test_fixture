/*
 * calibration.js - Calibration / Fuji film window.
 *
 * Owns the calibration modal: incremental jog moves, the Fuji film
 * pressure-paper test, and the calibration status log.
 *
 * Structure:
 *   - Log: addCalibrationUpdate, setCalibrationOutput.
 *   - Moves / setup: calibrationMove, saveCalibrationIncrement,
 *     initializeCalibrationSettings.
 *   - Fuji film: beginFujiFilmTest.
 *
 * Reads shared.js globals/helpers; the shared homeAxis lives in main.js.
 */


      function addCalibrationUpdate(message) {
        const log = document.getElementById("calibrationLog");
        calibrationLines.push(`[${stamp()}] ${message}`);
        log.textContent = calibrationLines.join("\n");
        log.scrollTop = log.scrollHeight;
      }

      function setCalibrationOutput(lines) {
        const log = document.getElementById("calibrationLog");
        calibrationLines = Array.isArray(lines) ? lines : [lines];
        log.textContent = calibrationLines.join("\n");
        log.scrollTop = log.scrollHeight;
      }

      function saveCalibrationIncrement() {
        const value = document.getElementById("incrementDistance").value;
        if (!value) return;
        try {
          localStorage.setItem("zaberLastCalibrationIncrement", value);
        } catch (error) {
          // browser storage only remembers the last increment locally.
        }
      }

      function initializeCalibrationSettings() {
        try {
          const lastIncrement = localStorage.getItem("zaberLastCalibrationIncrement");
          if (lastIncrement) document.getElementById("incrementDistance").value = lastIncrement;
        } catch (error) {
          // keep the built-in default when storage is unavailable.
        }
      }

      // up subtracts distance, down adds distance.
      function calibrationMove(direction) {
        saveCalibrationIncrement();
        const input = document.getElementById("incrementDistance");
        const increment = Number(input.value || 0.1);
        if (!Number.isFinite(increment)) {
          addCalibrationUpdate("ERROR: increment distance must be a valid number.");
          return;
        }
        if (increment < 0.1 || increment > 15) {
          addCalibrationUpdate("ERROR: increment distance must be between 0.1 mm and 15 mm.");
          input.value = Math.min(15, Math.max(0.1, increment || 0.1));
          saveCalibrationIncrement();
          return;
        }
        const signedDistance = direction === "down" ? increment : -increment;
        manualMove(signedDistance);
      }

      async function beginFujiFilmTest() {
        const button = document.getElementById("fujiFilmButton");
        if (fujiTimer) return;
        // Fuji film drives the actuator + load cell to a 20 N target. Require a
        // live Zaber on a real rig (soft in simulation).
        if (!(await zaberStartGateOk())) return;
        setForceReadout(0);
        setCalibrationOutput([`[${stamp()}] Fuji Film Test started.`, "Time (s) | Force (N)", "0.000 s | 0.0 N"]);
        button.disabled = true;
        document.getElementById("calibrationCloseButton").disabled = true;
        button.textContent = "Pushing... Target: 20 N";

        const finish = (text) => {
          if (fujiTimer) { clearInterval(fujiTimer); fujiTimer = null; }
          button.disabled = false;
          document.getElementById("calibrationCloseButton").disabled = false;
          button.textContent = "▶ Start Fuji Film Test";
          if (text) addCalibrationUpdate(text);
        };

        const surfaceArea = `${document.getElementById("surfaceArea")?.value || 325}mm2`;
        const result = await callApi("/api/fuji-film", { surface_area: surfaceArea });
        if (!result || !result.ok) {
          finish(`ERROR: ${(result && result.message) || "could not start Fuji Film Test."}`);
          return;
        }

        // poll the backend press for live force/time and react to completion.
        fujiTimer = setInterval(async () => {
          const status = await callApi("/api/run-status");
          if (!status || !status.ok) return;
          const force = Number(status.force || 0);
          const elapsed = Number(status.elapsed || 0);
          if (status.status === "running" || status.status === "completed") {
            setForceReadout(force);
            calibrationLines.push(`${elapsed.toFixed(3)} s | ${force.toFixed(1)} N`);
            const log = document.getElementById("calibrationLog");
            log.textContent = calibrationLines.join("\n");
            log.scrollTop = log.scrollHeight;
          }
          if (status.status === "completed") {
            finish(status.message || "Fuji Film Test Completed Successfully.");
          } else if (status.status === "error" || status.status === "stopped") {
            finish(status.message || "Fuji Film Test stopped.");
            if (status.disconnect) {
              // hard-block the Start button until the actuator reconnects; watch live.
              const button = document.getElementById("fujiFilmButton");
              button.disabled = true;
              addCalibrationUpdate("Actuator connection lost. Reconnect the Zaber to continue.");
              startReconnectWatch(() => {
                button.disabled = false;
                addCalibrationUpdate("Zaber reconnected and re-homed. You can continue.");
              });
            } else if (status.safety_stop) {
              // safety trip: the engine already stopped and homed. Dialog, then
              // restart the Fuji Film test on Continue.
              addCalibrationUpdate(status.message || "Fuji Film Test stopped for safety.");
              showSafetyStopDialog(status.message, () => beginFujiFilmTest());
            }
          }
        }, 100);
      }
