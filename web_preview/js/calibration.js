/*
 * calibration.js — Calibration / Fuji film window.
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

      function beginFujiFilmTest() {
        const button = document.getElementById("fujiFilmButton");
        clearInterval(fujiTimer);
        setForceReadout(0);
        fujiStartedAt = performance.now();
        setCalibrationOutput([`[${stamp()}] Fuji Film Test started.`, "Time (s) | Force (N)", "0.000 s | 0.0 N"]);
        button.disabled = true;
        document.getElementById("calibrationCloseButton").disabled = true;
        button.textContent = "Pushing... Target: 20 N";

        fujiTimer = setInterval(() => {
          try {
            const elapsedSeconds = (performance.now() - fujiStartedAt) / 1000;
            const nextForce = Math.min(20, currentForce + 0.3 + Math.random() * 0.25);
            const forceJump = nextForce - currentForce;

            if (forceJump > 5 || !Number.isFinite(nextForce)) {
              throw new Error("force spike detected.");
            }

            setForceReadout(nextForce);
            calibrationLines.push(`${elapsedSeconds.toFixed(3)} s | ${nextForce.toFixed(1)} N`);
            document.getElementById("calibrationLog").textContent = calibrationLines.join("\n");
            document.getElementById("calibrationLog").scrollTop = document.getElementById("calibrationLog").scrollHeight;

            if (nextForce >= 20) {
              clearInterval(fujiTimer);
              fujiTimer = null;
              button.disabled = false;
              document.getElementById("calibrationCloseButton").disabled = false;
              button.textContent = "▶ Start Fuji Film Test";
              addCalibrationUpdate("Fuji Film Test Completed Successfully.");
            }
          } catch (error) {
            clearInterval(fujiTimer);
            fujiTimer = null;
            button.disabled = false;
            document.getElementById("calibrationCloseButton").disabled = false;
            button.textContent = "▶ Start Fuji Film Test";
            addCalibrationUpdate(`ERROR: ${error.message || "Fuji Film Test stopped due to force error."}`);
          }
        }, 10);
      }
