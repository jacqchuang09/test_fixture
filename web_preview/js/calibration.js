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

      // Lock every calibration control while the Zaber is busy (a jog, a home, or
      // the Fuji press), and show a wait pill, so the operator can't queue commands
      // and flood the stage. Pass isLocked=false to re-enable and show the idle pill.
      function setCalibrationControlsLocked(isLocked, state, message, variant = "") {
        [
          "calibrationMoveUpButton",
          "calibrationMoveDownButton",
          "calibrationHomeButton",
          "incrementDistance",
          "extrusionDistance",
          "fujiFilmButton",
          "calibrationCloseButton",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.disabled = isLocked;
        });
        // Pause is the opposite of the rest (enabled only WHILE busy, like the EM
        // pause) so the operator can stop a jog or the Fuji press at any time.
        const pauseBtn = document.getElementById("calibrationPauseButton");
        if (pauseBtn) pauseBtn.disabled = !isLocked;
        // when unlocking, the Fuji button only re-enables if a valid extrusion
        // distance is still set (it gates the test - see updateFujiButtonState).
        if (!isLocked) updateFujiButtonState();
        if (state) setStatePill("calibrationState", state, message || "", variant);
      }

      // a valid extrusion distance is between 0.5 and 15 mm. Returns the number or
      // null. The 15 mm ceiling matches the backend's FUJI_EXTRUSION_MAX_MM clamp.
      function validExtrusion(value) {
        const n = Number(value);
        return (value !== "" && value != null && Number.isFinite(n) && n >= 0.5 && n <= 15) ? n : null;
      }

      // the last distance actually used to START a Fuji Film test (remembered across
      // sessions), shown grayed out as the field's placeholder so the operator can
      // reuse it. Returns the number or null if none has been used yet.
      function lastUsedExtrusionDistance() {
        try {
          return validExtrusion(localStorage.getItem("zaberLastExtrusionDistance"));
        } catch (error) {
          return null;
        }
      }

      // the distance the test will use: whatever is typed if valid, otherwise the
      // last-used value shown as the gray placeholder. Null means nothing valid yet.
      function effectiveExtrusionDistance() {
        const input = document.getElementById("extrusionDistance");
        if (input && input.value !== "") return validExtrusion(input.value);
        return lastUsedExtrusionDistance();
      }

      // show the last-used distance as the grayed-out placeholder (or a prompt if none).
      function refreshExtrusionPlaceholder() {
        const input = document.getElementById("extrusionDistance");
        if (!input) return;
        const last = lastUsedExtrusionDistance();
        input.placeholder = last != null ? String(last) : "set a distance to enable the test";
      }

      // The Fuji Film Start button is enabled only when there is a distance to use -
      // either typed in the field or remembered from the last test (the gray
      // placeholder). Called on every keystroke and whenever the controls unlock.
      // While a press or jog is running (Pause enabled), it stays disabled regardless.
      function updateFujiButtonState() {
        const button = document.getElementById("fujiFilmButton");
        if (!button) return;
        const pauseBtn = document.getElementById("calibrationPauseButton");
        const busy = pauseBtn && !pauseBtn.disabled;
        button.disabled = busy || effectiveExtrusionDistance() == null;
      }

      // Pause a running jog or Fuji press. Unlike the EM pause, this does NOT home
      // the actuator - it stops it in place and leaves it where it is.
      function pauseCalibration() {
        document.getElementById("calibrationPauseButton").disabled = true;
        callApi("/api/stop");
        addCalibrationUpdate("paused - actuator stopped and held in place.");
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
        // the extrusion field is left blank; the last-used distance shows grayed out
        // as its placeholder (and is used as the default if Start is pressed blank).
        refreshExtrusionPlaceholder();
        updateFujiButtonState();
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
        if (fujiTimer || calibrationMoveInFlight) return;
        // the test needs an extrusion distance - how far the actuator drives toward
        // the sensor before pressing to 20 N and retracting. Use whatever is typed,
        // or fall back to the last-used value shown as the gray placeholder.
        const extrusion = effectiveExtrusionDistance();
        if (extrusion == null) {
          addCalibrationUpdate("ERROR: set an extrusion distance between 0.5 mm and 15 mm before starting the Fuji Film Test.");
          document.getElementById("extrusionDistance")?.focus();
          return;
        }
        // remember it as the last-used distance, shown grayed out next time.
        try {
          localStorage.setItem("zaberLastExtrusionDistance", String(extrusion));
        } catch (error) {
          // storage only remembers the last-used distance locally.
        }
        refreshExtrusionPlaceholder();
        // Fuji film drives the actuator + load cell to a 20 N target. Require a
        // live Zaber on a real rig (soft in simulation).
        if (!(await zaberStartGateOk())) return;
        setForceReadout(0);
        setCalibrationOutput([`[${stamp()}] Fuji Film Test started.`, "Time (s) | Force (N)", "0.000 s | 0.0 N"]);
        // lock ALL calibration controls while the press runs - jogging mid-press
        // would flood the stage with commands.
        setCalibrationControlsLocked(true, "WAITING TO START", "initializing load cell - please wait…", "discarded");
        button.textContent = "Pushing... Target: 20 N";

        const finish = (text) => {
          if (fujiTimer) { clearInterval(fujiTimer); fujiTimer = null; }
          setCalibrationControlsLocked(false, "READY", "calibration controls ready.", "kept");
          button.textContent = "▶ Start Fuji Film Test";
          if (text) addCalibrationUpdate(text);
        };

        const surfaceArea = `${document.getElementById("surfaceArea")?.value || 325}mm2`;
        const result = await callApi("/api/fuji-film", { surface_area: surfaceArea, extrusion_distance: extrusion });
        if (!result || !result.ok) {
          finish(`ERROR: ${(result && result.message) || "could not start Fuji Film Test."}`);
          return;
        }

        // poll the backend press for live force/time and react to completion.
        fujiTimer = setInterval(async () => {
          const status = await callApi("/api/run-status");
          if (!status || !status.ok) return;
          if (status.status === "waiting") {
            setCalibrationControlsLocked(true, "WAITING TO START", "initializing load cell - please wait…", "discarded");
            return;
          }
          const force = Number(status.force || 0);
          const elapsed = Number(status.elapsed || 0);
          if (status.status === "running") {
            setCalibrationControlsLocked(true, "FUJI PRESS", `pressing to 20 N - ${force.toFixed(1)} N`, "discarded");
          }
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
              // no auto-reconnect: fix it with the Zaber Launcher (move back to home),
              // reconnect, then start again. finish() already unlocked the controls.
              setStatePill("calibrationState", "DISCONNECTED", "actuator disconnected - use the Zaber Launcher.", "discarded");
              addCalibrationUpdate("Actuator connection lost during the Fuji Film test.");
              showDisconnectDialog(status.message);
            } else if (status.safety_stop) {
              // safety trip: the engine already stopped and homed. Dialog, then
              // restart the Fuji Film test on Continue.
              addCalibrationUpdate(status.message || "Fuji Film Test stopped for safety.");
              showSafetyStopDialog(status.message);   // no auto-restart - actuator homed; press Start to run again
            }
          }
        }, 100);
      }
