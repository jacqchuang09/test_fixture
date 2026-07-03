/*
 * main.js - setup screen, navigation, and startup wiring.
 *
 * Loaded LAST. It contains the first (basic settings) screen logic and the
 * launchers for every test window, then ends with all DOM event-listener
 * registration and the startup calls. Because it loads after every other
 * js/ file, those listeners and startup calls can safely reference functions
 * defined anywhere in the bundle.
 *
 * Structure:
 *   - Save folder / test folder: testTypeFolderCode, currentTestDateFolder,
 *     currentComputedTestFolder, updateFolderInfoTag, browseFolder,
 *     cleanedBaseSaveFolder, clearResolvedTestFolder.
 *   - Existing-test conflict workflow: scheduleExistingTestCheck,
 *     checkExistingTestQuietly, chooseExistingTestAction,
 *     promptExistingTestChoice, cancelExistingTestWorkflow,
 *     handleExistingTestChoice, resolveTestFolderBeforeVerify.
 *   - Sensor ID builder: activeSensorId, isValidSensorId, segmentValue,
 *     generatedSensorId, sensorBuilderError, updateSensorIdPreview,
 *     updateSensorIdMode, initializeSensorIdBuilder, normalizeSensorSegment,
 *     moveToNextSensorSegment.
 *   - Config + verify + begin: config, updateTestConfigState,
 *     invalidateBasicSettings, verifySettings, beginNeedsFolderResolution,
 *     beginTest.
 *   - Window launchers: openEmTest, openShearTest, openManualTest,
 *     openCyclicalTest, openCalibration, homeAxis.
 *   - Event wiring + startup: the addEventListener registrations and the
 *     initialize / update startup calls at the bottom (run last).
 *
 * Reads shared.js globals/helpers and calls into every window's module.
 */


      function testTypeFolderCode(testType) {
        return { EM: "EM", Shear: "Shear", Manual: "Manual", Fatigue: "Fatigue" }[testType] || testType;
      }

      function currentTestDateFolder() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const year = String(now.getFullYear()).slice(-2);
        const surfaceArea = `${document.getElementById("surfaceArea")?.value || "325"}mm2`;
        return `${month} ${day} ${year}_${surfaceArea}_${testTypeFolderCode(document.getElementById("testType")?.value || "EM")}`;
      }

      function currentComputedTestFolder() {
        const cfg = config();
        if (!cfg.save_folder || !cfg.sensor_id) return "";
        return `${cfg.save_folder.replace(/\/+$/, "")}/${cfg.sensor_id}/${currentTestDateFolder()}`;
      }

      function updateFolderInfoTag() {
        if (messageTargetEl().classList.contains("error")) return;
        const folder = currentComputedTestFolder();
        setMainMessage(folder ? `Folder path: ${folder}` : "", folder ? "info" : "");
      }

      function scheduleExistingTestCheck() {
        if (!settingsVerified || document.getElementById("testConfig").classList.contains("hidden")) return;
        clearResolvedTestFolder(true);
        if (document.getElementById("testType").value === "Fatigue") {
          updateFolderInfoTag();
          return;
        }
        if (liveExistingCheckTimer) clearTimeout(liveExistingCheckTimer);
        liveExistingCheckTimer = setTimeout(checkExistingTestQuietly, 250);
      }

      async function checkExistingTestQuietly() {
        const cfg = config();
        if (!cfg.save_folder || !cfg.sensor_id || !cfg.test_type || !cfg.surface_area) {
          updateFolderInfoTag();
          return;
        }
        const sequence = ++liveExistingCheckSeq;
        const result = await callApi("/api/check-existing", { selected_test_folder: "", existing_test_action: "" });
        if (sequence !== liveExistingCheckSeq || !result.ok) return;
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.liveExistingFolder = result.exists ? result.folder : "";
        saveFolderInput.dataset.liveVersionedFolder = result.versioned_folder || "";
        saveFolderInput.dataset.liveAvailableRuns = Array.isArray(result.available_runs) ? result.available_runs.join(",") : "";
        saveFolderInput.dataset.liveIsEmTest = result.is_em_test ? "true" : "false";
        saveFolderInput.dataset.liveExistingMessage = result.message || "";
        const folder = result.folder || currentComputedTestFolder();
        if (result.exists) {
          setMainMessage(`Existing test folder found: ${folder}`, "info");
        } else {
          setMainMessage(`Folder path: ${folder}`, "info");
        }
      }

      function activeSensorId() {
        return document.getElementById("useCustomSensorId").checked
          ? document.getElementById("customSensorId").value.trim()
          : document.getElementById("sensorId").value.trim();
      }

      function cleanedBaseSaveFolder(pathValue) {
        const rawPath = String(pathValue || "").trim().replace(/[/\\]+$/, "");
        if (!rawPath) return rawPath;
        const parts = rawPath.split(/[/\\]/).filter((part, index) => index === 0 || part !== "");
        const testFolderIndex = parts.findIndex((part) => /^\d{2} \d{2} \d{2}_.+_(EM|EB|Shear|Manual|Fatigue)(?:_\d+)?$/i.test(part));
        if (testFolderIndex > 0) {
          return parts.slice(0, Math.max(1, testFolderIndex - 1)).join("/") || "/";
        }
        const generatedFolderIndex = parts.findIndex((part) => /^\d{6}B\d{2}S\d{2}(A|B|AB|BA)(?:_\d+)?$/i.test(part));
        if (generatedFolderIndex > 0) {
          return parts.slice(0, generatedFolderIndex).join("/") || "/";
        }
        return rawPath;
      }

      function config() {
        const runToRedoInput = document.getElementById("runToRedo");
        const runToRedoValue = runToRedoInput.value;
        const runToRedo = runToRedoValue === "" ? null : Number(runToRedoValue);
        const saveFolderInput = document.getElementById("saveFolder");
        const isRedoAction = saveFolderInput.dataset.existingTestAction === "redo";
        const redoRun = document.getElementById("redoRun").checked || isRedoAction || (!runToRedoInput.disabled && runToRedoValue !== "");
        const baseSaveFolder = cleanedBaseSaveFolder(saveFolderInput.dataset.baseSaveFolder || saveFolderInput.value);
        saveFolderInput.dataset.baseSaveFolder = baseSaveFolder;
        if (!saveFolderInput.dataset.selectedTestFolder && saveFolderInput.value !== baseSaveFolder) {
          saveFolderInput.value = baseSaveFolder;
        }
        const testType = document.getElementById("testType").value;
        const singleDatasetTest = ["Shear", "Manual", "Fatigue"].includes(testType);
        return {
          save_folder: baseSaveFolder,
          base_save_folder: baseSaveFolder,
          selected_test_folder: saveFolderInput.dataset.selectedTestFolder || "",
          existing_test_action: saveFolderInput.dataset.existingTestAction || "",
          sensor_id: activeSensorId(),
          sensor_type: document.getElementById("sensorType").value,
          test_type: testType,
          runs: redoRun ? 1 : (singleDatasetTest ? 1 : Math.min(MAX_EM_RUNS, Math.max(1, Math.floor(Number(document.getElementById("runs").value || 3)) || 3))),
          comport: document.getElementById("comport").value || "",
          redo_run: redoRun,
          run_to_redo: redoRun ? runToRedo : null,
          surface_area: `${document.getElementById("surfaceArea").value}mm2`,
          waveform_type: document.getElementById("waveformType")?.value || "Sine",
          cyclical_lower_force: clampCyclicalLowerForce(document.getElementById("cyclicalLowerForce")?.value || 1),
          cyclical_upper_force: clampForce(document.getElementById("cyclicalUpperForce")?.value || 20),
          waveform_frequency: Number(document.getElementById("waveformFrequency")?.value || 1),
          cyclical_cycle_count: Math.max(1, Number(document.getElementById("cyclicalCycleCount")?.value || 28800)),
        };
      }

      // populate the Run-to-Redo dropdown with ONLY the active (redoable) runs.
      // A run already superseded by a redo never appears here.
      function setRunToRedoOptions(runs) {
        const sel = document.getElementById("runToRedo");
        if (!sel) return;
        const runsArr = (runs || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
        sel.dataset.availableRuns = runsArr.join(",");
        sel.innerHTML = `<option value="">Select run…</option>` +
          runsArr.map((n) => `<option value="${n}">Run ${n}</option>`).join("");
        sel.value = "";
      }

      // Start Test gate: require a live Zaber on a real rig; stay soft in simulation
      // (no real load-cell driver) so dev/demo runs still work. Returns true if the
      // run may proceed, false if it was hard-blocked.
      async function zaberStartGateOk() {
        const status = await callApi("/api/connection-check", {});
        if (!status) return true;                  // backend hiccup - don't hard-block
        if (status.connected === true) return true;
        if (status.connection_lost === true) {     // real rig lost its actuator: hard block
          showErrorDialog(
            "The actuator connection was lost. Reconnect the Zaber (re-select the COM port) " +
            "and wait for it to confirm before starting the test.",
            "Reconnect the Zaber first");
          return false;
        }
        if (status.simulation === true) {          // simulation machine: soft
          setMainMessage("No Zaber connected - running in simulation mode.", "");
          return true;
        }
        showErrorDialog(
          "No Zaber is connected. Select the COM port and make sure it connects before starting the test.",
          "Connect a Zaber first");
        return false;
      }

      // keep the run fields in the right state for em, shear, and redo mode.
      function updateTestConfigState() {
        const testTypeInput = document.getElementById("testType");
        const redoRunInput = document.getElementById("redoRun");
        const isRedoLocked = redoRunInput.dataset.lockedByExistingFolder === "true";
        if (isRedoLocked) {
          testTypeInput.value = "EM";
          redoRunInput.checked = true;
        }
        const testType = testTypeInput.value;
        const isShear = testType === "Shear";
        const isManual = testType === "Manual";
        const isCyclical = testType === "Fatigue";
        if (isShear || isManual || isCyclical) {
          redoRunInput.checked = false;
          redoRunInput.dataset.lockedByExistingFolder = "";
        }
        const redoRun = redoRunInput.checked;
        const runsInput = document.getElementById("runs");
        const runToRedoInput = document.getElementById("runToRedo");
        const comportInput = document.getElementById("comport");
        const surfaceAreaInput = document.getElementById("surfaceArea");

        if (redoRun) {
          runsInput.value = 1;
        } else {
          runToRedoInput.value = "";
          if (isShear || isManual || isCyclical) {
            runsInput.value = "";
          } else if (!runsInput.value || runsInput.value === "1") {
            runsInput.value = 3;
          }
        }
        if (isShear && surfaceAreaInput.dataset.autoDefault !== "shear") {
          surfaceAreaInput.value = "50.27";
          surfaceAreaInput.dataset.autoDefault = "shear";
        } else if (!isShear && surfaceAreaInput.dataset.autoDefault === "shear") {
          surfaceAreaInput.value = "325";
          surfaceAreaInput.dataset.autoDefault = "standard";
        }
        runsInput.disabled = isShear || isManual || isCyclical || redoRun;
        redoRunInput.disabled = isShear || isManual || isCyclical || isRedoLocked;
        runToRedoInput.disabled = !redoRun || isShear || isManual || isCyclical;
        comportInput.disabled = isShear;
        testTypeInput.disabled = isRedoLocked;

        if (isShear) {
          setMainMessage("shear test disables redo a run, run count, and zaber com port.");
        } else if (isManual) {
          setMainMessage("manual test disables run count and redo fields. zaber com port stays enabled.");
        } else if (isCyclical) {
          setMainMessage("fatigue test cycles force bounds to simulate sensor lifespan.");
        } else if (redoRun) {
          setMainMessage("redo mode will repeat only the selected run.");
        } else {
          setMainMessage("");
        }
      }

      async function browseFolder() {
        try {
          const response = await fetch(apiUrl("/api/browse-folder"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config()),
          });
          const result = await response.json();
          if (result.ok && result.message) {
            const saveFolderInput = document.getElementById("saveFolder");
            const baseSaveFolder = cleanedBaseSaveFolder(result.message);
            saveFolderInput.value = baseSaveFolder;
            saveFolderInput.dataset.baseSaveFolder = baseSaveFolder;
            saveFolderInput.dataset.selectedTestFolder = "";
            saveFolderInput.dataset.existingTestAction = "";
            invalidateBasicSettings();
            updateFolderInfoTag();
          } else {
            setMainMessage(result.message || "folder selection cancelled.", "error");
          }
        } catch (error) {
          setMainMessage(`could not open folder picker: ${error.message}`, "error");
        }
      }

      // analyze a folder of already-saved run files directly - no test run, no
      // hardware, no input stream. Pick a test folder that contains FUT/ and CAP/
      // (e.g. the bundled sample_data/03 09 26_325mm2_EM), then run the real EM
      // analysis on it and open the results with the matplotlib figures.
      async function analyzeSavedDataFolder() {
        let folder;
        try {
          const response = await fetch(apiUrl("/api/browse-folder"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config()),
          });
          const result = await response.json();
          if (!(result.ok && result.message)) {
            setMainMessage(result.message || "folder selection cancelled.", "error");
            return;
          }
          folder = result.message;
        } catch (error) {
          setMainMessage(`could not open folder picker: ${error.message}`, "error");
          return;
        }

        // The folder must follow the analysis-output pattern:
        //   {MM DD YY}_{SurfaceArea}mm2_{TestType}   (TestType = EM | Shear |
        //   Manual | Fatigue, optional _1/_2/... version suffix).
        // Validate up front so a wrong pick shows a pop-up immediately - no loading.
        // split on BOTH separators - the Windows folder picker returns backslash
        // paths (C:\Users\...\03 09 26_325mm2_EM), Mac returns forward slashes.
        const folderName = (folder.split(/[/\\]/).filter(Boolean).pop() || "");
        // accept any surface-area string (EM uses "325mm2", Shear/Manual may use a
        // bare value like "50.27") - match the same pattern cleanedBaseSaveFolder uses.
        if (!/^\d{2} \d{2} \d{2}_.+_(EM|EB|Shear|Manual|Fatigue)(?:_\d+)?$/i.test(folderName)) {
          showErrorDialog(
            `"${escapeHtml(folderName)}" isn't a valid analysis folder.\n\n` +
            `<strong>Expected:</strong>   MM DD YY_&lt;area&gt;_&lt;TestType&gt;\n` +
            `<strong>Example:</strong>    03 09 26_325mm2_EM\n\n` +
            `TestType must be EM, Shear, Manual, or Fatigue.`,
            "Cannot analyze this folder",
            true
          );
          return;
        }

        // detect the test type + surface area from the folder name, then analyze.
        const detected = detectTestTypeFromFolder(folder);
        const surfaceArea = surfaceAreaFromFolder(folder);
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = folder;
        saveFolderInput.dataset.existingTestAction = "";
        if (document.getElementById("testType")) document.getElementById("testType").value = detected;
        await analyzeFolderAs(folder, detected, surfaceArea);
        // clear the override so a later live test rebuilds its own folder path.
        saveFolderInput.dataset.selectedTestFolder = "";
      }

      // infer the test type from a saved test-folder name (…_EM / _Shear / _Manual / _Fatigue).
      function detectTestTypeFromFolder(folder) {
        const name = (folder.split(/[/\\]/).filter(Boolean).pop() || "");
        const match = name.match(/_(EM|EB|Shear|Manual|Fatigue)(?:_\d+)?$/i);
        if (!match) return "EM";
        const key = match[1].toLowerCase();
        if (key === "shear") return "Shear";
        if (key === "manual") return "Manual";
        if (key === "fatigue") return "Fatigue";
        return "EM";
      }

      function surfaceAreaFromFolder(folder) {
        const name = (folder.split(/[/\\]/).filter(Boolean).pop() || "");
        const match = name.match(/_([\d.]+)mm2/i);
        return match ? `${match[1]}mm2` : null;
      }

      // run the analysis on an existing folder and open the matching results window.
      async function analyzeFolderAs(folder, testType, surfaceArea) {
        // analyze_existing: use the folder as-is, never fabricate data; the
        // backend returns ok:false with a message if it isn't a valid test folder.
        const payload = { selected_test_folder: folder, test_type: testType, analyze_existing: true };
        if (surfaceArea) payload.surface_area = surfaceArea;
        setMainMessage(`Analyzing saved ${testType} data in ${folder} …`);
        const result = await runAnalysisProgress("Analyzing saved data…", () => callApi("/api/perform-analysis", payload));
        if (!result.ok) {
          showErrorDialog(result.message || "Analysis failed.", "Cannot analyze this folder");
          return;
        }
        setMainMessage(result.message || "Analysis complete.");
        const analysis = result.analysis || null;
        if (testType === "Fatigue") {
          populateFatigueAnalysis(analysis);
          fatigueAnalysisModal.showModal();
        } else if (testType === "Shear") {
          populateShearAnalysis(analysis);
          shearAnalysisModal.showModal();
        } else if (testType === "Manual") {
          manualImages = (analysis && analysis.manual_images) ? analysis.manual_images : null;
          renderInteractivePanel("manual", analysis);
          manualData = [];
          manualAnalysisZoom = 1;
          populateManualAnalysis();
          manualAnalysisModal.showModal();
        } else {
          // EM (and anything else falls back to the EM pipeline/window).
          populateEmAnalysis(result.message || "EM analysis complete.", analysis);
          emAnalysisModal.showModal();
        }
      }

      function invalidateBasicSettings() {
        if (!settingsVerified) return;
        settingsVerified = false;
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = "";
        saveFolderInput.dataset.existingTestAction = "";
        const redoRunInput = document.getElementById("redoRun");
        redoRunInput.dataset.lockedByExistingFolder = "";
        redoRunInput.disabled = false;
        document.getElementById("testType").disabled = false;
        document.getElementById("testConfig").classList.add("hidden");
        setMainMessage("Basic settings changed. Please click Verify again", "error");
      }

      function clearResolvedTestFolder(resetRedo = false) {
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = "";
        saveFolderInput.dataset.existingTestAction = "";
        const redoRunInput = document.getElementById("redoRun");
        const runToRedoInput = document.getElementById("runToRedo");
        if (resetRedo) {
          redoRunInput.checked = false;
          redoRunInput.dataset.lockedByExistingFolder = "";
          setRunToRedoOptions([]);
          document.getElementById("testType").disabled = false;
        } else if (redoRunInput.dataset.lockedByExistingFolder !== "true") {
          setRunToRedoOptions([]);
        }
        updateFolderInfoTag();
      }

      function isValidSensorId(sensorId) {
        return /^\d{6}B\d{2}S\d{2}(A|B|AB|BA)$/i.test(sensorId.trim());
      }

      function segmentValue(id) {
        return document.getElementById(id).value.trim();
      }

      function generatedSensorId() {
        const year = segmentValue("sensorYear");
        const month = segmentValue("sensorMonth");
        const day = segmentValue("sensorDay");
        const batch = segmentValue("sensorBatch");
        const sensor = segmentValue("sensorNumber");
        const location = segmentValue("sensorLocation").toUpperCase();
        return `${year}${month}${day}B${batch}S${sensor}${location}`;
      }

      function sensorBuilderError() {
        const year = segmentValue("sensorYear");
        const month = segmentValue("sensorMonth");
        const day = segmentValue("sensorDay");
        const batch = segmentValue("sensorBatch");
        const sensor = segmentValue("sensorNumber");
        const location = segmentValue("sensorLocation").toUpperCase();

        // Incomplete (any segment left blank) gets one generic message; only a segment
        // that is filled in but malformed gets its specific message (per story 1.1.7).
        if (!year || !month || !day || !batch || !sensor || !location) {
          return "Complete all Sensor ID segments before continuing";
        }
        if (!/^\d{2}$/.test(year)) return "Sensor ID year must be exactly 2 digits";
        if (!/^\d{2}$/.test(month)) return "Sensor ID month must be exactly 2 digits";
        if (!/^\d{2}$/.test(day)) return "Sensor ID day must be exactly 2 digits";
        if (!/^\d{2}$/.test(batch)) return "Sensor ID batch number must be exactly 2 numeric digits";
        if (!/^\d{2}$/.test(sensor)) return "Sensor ID sensor number must be exactly 2 numeric digits";
        if (!/^(A|B|AB|BA)$/.test(location)) return "Sensor ID location must be A, B, AB, or BA";
        return "";
      }

      function updateSensorIdPreview() {
        const generated = generatedSensorId();
        const preview = document.getElementById("sensorIdPreview");
        const previewWrap = preview.closest(".sensor-preview");
        const isComplete = !sensorBuilderError();
        preview.textContent = isComplete ? generated : "complete all segments";
        previewWrap.classList.toggle("complete", isComplete);
        if (!document.getElementById("useCustomSensorId").checked) {
          document.getElementById("sensorId").value = isComplete ? generated : "";
        }
      }

      function updateSensorIdMode() {
        const useCustom = document.getElementById("useCustomSensorId").checked;
        const customInput = document.getElementById("customSensorId");
        document.querySelector(".sensor-builder").classList.toggle("hidden", useCustom);
        document.getElementById("customSensorIdField").classList.toggle("hidden", !useCustom);
        customInput.disabled = !useCustom;
        ["sensorYear", "sensorMonth", "sensorDay", "sensorBatch", "sensorNumber", "sensorLocation"].forEach((id) => {
          document.getElementById(id).disabled = useCustom;
        });
        if (useCustom) {
          window.setTimeout(() => {
            customInput.focus();
            customInput.select();
          }, 0);
        } else {
          updateSensorIdPreview();
        }
        invalidateBasicSettings();
      }

      // set up the sensor id builder with placeholder examples and auto-advance behavior.
      function initializeSensorIdBuilder() {
        const today = new Date();
        const placeholders = {
          year: String(today.getFullYear()).slice(-2),
          month: String(today.getMonth() + 1).padStart(2, "0"),
          day: String(today.getDate()).padStart(2, "0"),
          batch: "01",
          sensor: "01",
          location: "B",
        };
        try {
          const lastSensorId = localStorage.getItem("zaberLastSensorId") || "";
          const generatedMatch = lastSensorId.match(/^(\d{2})(\d{2})(\d{2})B(\d{2})S(\d{2})(A|B|AB|BA)$/i);
          if (generatedMatch) {
            placeholders.year = generatedMatch[1];
            placeholders.month = generatedMatch[2];
            placeholders.day = generatedMatch[3];
            placeholders.batch = generatedMatch[4];
            placeholders.sensor = generatedMatch[5];
            placeholders.location = generatedMatch[6].toUpperCase();
          } else if (lastSensorId) {
            document.getElementById("customSensorId").placeholder = lastSensorId;
          }
        } catch (error) {
          // browser storage only provides gray examples here.
        }
        document.getElementById("sensorYear").placeholder = placeholders.year;
        document.getElementById("sensorMonth").placeholder = placeholders.month;
        document.getElementById("sensorDay").placeholder = placeholders.day;
        document.getElementById("sensorBatch").placeholder = placeholders.batch;
        document.getElementById("sensorNumber").placeholder = placeholders.sensor;
        document.getElementById("sensorLocation").placeholder = placeholders.location;
        document.getElementById("sensorYear").value = "";
        document.getElementById("sensorMonth").value = "";
        document.getElementById("sensorDay").value = "";
        document.getElementById("sensorBatch").value = "";
        document.getElementById("sensorNumber").value = "";
        document.getElementById("sensorLocation").value = "";
        document.getElementById("useCustomSensorId").checked = false;
        document.getElementById("customSensorId").value = "";
        updateSensorIdPreview();
      }

      function normalizeSensorSegment(event) {
        const input = event.target;
        if (["sensorYear", "sensorMonth", "sensorDay", "sensorBatch", "sensorNumber"].includes(input.id)) {
          input.value = input.value.replace(/\D/g, "").slice(0, 2);
        } else if (input.id === "sensorLocation") {
          input.value = input.value.toUpperCase().replace(/[^AB]/g, "").slice(0, 2);
        }
        updateSensorIdPreview();
        invalidateBasicSettings();
        updateFolderInfoTag();
        moveToNextSensorSegment(input);
      }

      function moveToNextSensorSegment(input) {
        const order = ["sensorYear", "sensorMonth", "sensorDay", "sensorBatch", "sensorNumber", "sensorLocation"];
        const maxLength = 2;
        if (input.value.length < maxLength) return;
        const next = document.getElementById(order[order.indexOf(input.id) + 1]);
        if (next && !next.disabled) {
          next.focus();
          next.select();
        }
      }

      function chooseExistingTestAction(action) {
        if (existingTestChoiceResolver) {
          existingTestChoiceResolver(action);
          existingTestChoiceResolver = null;
        }
        existingTestModal.close();
      }

      function promptExistingTestChoice(conflict) {
        existingTestMessageEl.textContent = conflict.message || `A test folder already exists for this Sensor ID: ${conflict.folder}. Choose how you want to continue.`;
        const redoButton = document.getElementById("existingRedoButton");
        redoButton.disabled = !conflict.is_em_test;
        redoButton.title = conflict.is_em_test ? "" : "Redo a specific run is only available for EM Test folders.";
        return new Promise((resolve) => {
          existingTestChoiceResolver = resolve;
          existingTestModal.showModal();
        });
      }

      function cancelExistingTestWorkflow() {
        settingsVerified = false;
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = "";
        saveFolderInput.dataset.existingTestAction = "";
        const testConfig = document.getElementById("testConfig");
        testConfig.classList.add("hidden");
        const redoRunInput = document.getElementById("redoRun");
        redoRunInput.checked = false;
        redoRunInput.disabled = false;
        redoRunInput.dataset.lockedByExistingFolder = "";
        setRunToRedoOptions([]);
        document.getElementById("testType").disabled = false;
        testConfig.querySelectorAll("input, select, button").forEach((element) => {
          if (element.id !== "beginButton") element.blur();
        });
        setMainMessage("verification cancelled. no test folder changes were made.", "error");
      }

      async function handleExistingTestChoice(conflict) {
        const choice = await promptExistingTestChoice(conflict);
        const saveFolderInput = document.getElementById("saveFolder");
        const redoRunInput = document.getElementById("redoRun");
        const runToRedoInput = document.getElementById("runToRedo");

        if (choice === "version") {
          saveFolderInput.dataset.selectedTestFolder = conflict.versioned_folder;
          saveFolderInput.dataset.existingTestAction = "version";
          redoRunInput.checked = false;
          redoRunInput.dataset.lockedByExistingFolder = "";
          document.getElementById("testType").disabled = false;
          setRunToRedoOptions([]);
          updateTestConfigState();
          setMainMessage(`new versioned test folder selected: ${conflict.versioned_folder}`, "ok");
          return true;
        }

        if (choice === "redo") {
          if (!conflict.is_em_test) {
            setMainMessage("redo a specific run is only available for EM Test folders.", "error");
            return false;
          }
          document.getElementById("testType").value = "EM";
          const availableRuns = Array.isArray(conflict.available_runs) ? conflict.available_runs.map(Number) : [];
          if (!availableRuns.length) {
            setMainMessage("redo a run is only available for EM tests with saved run files. no existing runs were found.", "error");
            return false;
          }
          saveFolderInput.dataset.selectedTestFolder = conflict.folder;
          saveFolderInput.dataset.existingTestAction = "redo";
          redoRunInput.checked = true;
          redoRunInput.dataset.lockedByExistingFolder = "true";
          setRunToRedoOptions(availableRuns);
          updateTestConfigState();
          setMainMessage(`redo a run will be checked by default. Existing runs: ${availableRuns.join(", ")}.`, "ok");
          return true;
        }

        // (overwrite removed - data is never overwritten; redo creates a new run.)

        cancelExistingTestWorkflow();
        return false;
      }

      async function resolveTestFolderBeforeVerify() {
        const saveFolderInput = document.getElementById("saveFolder");
        saveFolderInput.dataset.selectedTestFolder = "";
        saveFolderInput.dataset.existingTestAction = "";
        const conflict = await callApi("/api/check-existing", { selected_test_folder: "", existing_test_action: "" });
        if (!conflict.ok) return false;
        if (!conflict.exists) {
          saveFolderInput.dataset.selectedTestFolder = conflict.folder;
          saveFolderInput.dataset.existingTestAction = "new";
          return true;
        }
        return handleExistingTestChoice(conflict);
      }

      // check the first form before showing test settings.
      async function verifySettings() {
        const cfg = config();
        const useCustomSensorId = document.getElementById("useCustomSensorId").checked;
        if (!cfg.save_folder) {
          setMainMessage("Fill in Save Folder before continuing", "error");
          return;
        }
        if (!cfg.sensor_type) {
          setMainMessage("Fill in Sensor Type", "error");
          return;
        }
        if (useCustomSensorId && !cfg.sensor_id) {
          setMainMessage("Enter a custom sensor ID", "error");
          return;
        }
        if (!useCustomSensorId) {
          const builderError = sensorBuilderError();
          if (builderError) {
            setMainMessage(builderError, "error");
            return;
          }
        }
        if (!useCustomSensorId && !isValidSensorId(cfg.sensor_id)) {
          setMainMessage("Sensor ID must use the format YYMMDDB##S##A/B/AB/BA, for example 250506B01S01B", "error");
          return;
        }
        const result = await callApi("/api/verify");
        settingsVerified = result.ok;
        if (settingsVerified) {
          try {
            localStorage.setItem("zaberLastSensorId", cfg.sensor_id);
          } catch (error) {
            // browser storage is only used to prefill the next session.
          }
          const saveFolderInput = document.getElementById("saveFolder");
          const baseSaveFolder = cleanedBaseSaveFolder(saveFolderInput.dataset.baseSaveFolder || saveFolderInput.value);
          saveFolderInput.value = baseSaveFolder;
          saveFolderInput.dataset.baseSaveFolder = baseSaveFolder;
          saveFolderInput.dataset.selectedTestFolder = "";
          saveFolderInput.dataset.existingTestAction = "";
          document.getElementById("testConfig").classList.remove("hidden");
          const redoRunInput = document.getElementById("redoRun");
          if (saveFolderInput.dataset.existingTestAction !== "redo") {
            redoRunInput.checked = false;
            redoRunInput.dataset.lockedByExistingFolder = "";
            setRunToRedoOptions([]);
            document.getElementById("runs").value = 3;
            document.getElementById("testType").disabled = false;
          }
          updateTestConfigState();
          scheduleExistingTestCheck();
          const runToRedoInput = document.getElementById("runToRedo");
          if (document.getElementById("redoRun").checked && !runToRedoInput.value) {
            const availableRuns = runToRedoInput.dataset.availableRuns || "";
            setMainMessage(
              availableRuns
                ? `redo a run will be checked by default. Existing runs: ${availableRuns.replaceAll(",", ", ")}.`
                : "redo a run will be checked by default.",
              "ok"
            );
          } else {
            setMainMessage(result.message || "settings verified.", "ok");
          }
          setEmState("READY", "settings verified. waiting for test to begin.");
        }
      }

      function beginNeedsFolderResolution(cfg) {
        if (cfg.test_type === "Fatigue") return false;
        return !["version", "overwrite", "redo"].includes(cfg.existing_test_action);
      }

      async function beginTest() {
        let cfg = config();
        if (!settingsVerified) {
          setMainMessage("verify settings before beginning the test.", "error");
          return;
        }
        if (beginNeedsFolderResolution(cfg)) {
          const folderReady = await resolveTestFolderBeforeVerify();
          if (!folderReady) return;
          cfg = config();
        } else if (cfg.selected_test_folder && cfg.redo_run) {
          document.getElementById("redoRun").checked = true;
          document.getElementById("redoRun").dataset.lockedByExistingFolder = "true";
          document.getElementById("testType").value = "EM";
          updateTestConfigState();
          cfg = config();
        }
        if (cfg.redo_run && (!Number.isInteger(cfg.run_to_redo) || cfg.run_to_redo < 1)) {
          setMainMessage("Select a run to redo before continuing", "error");
          return;
        }
        if (cfg.redo_run) {
          const availableRuns = (document.getElementById("runToRedo").dataset.availableRuns || "")
            .split(",")
            .filter(Boolean)
            .map(Number);
          if (!availableRuns.length) {
            setMainMessage("no saved run files were found in this test folder, so there is no run to redo.", "error");
            return;
          }
          if (!availableRuns.includes(cfg.run_to_redo)) {
            setMainMessage(`run ${cfg.run_to_redo} does not exist in this test folder. Existing runs: ${availableRuns.join(", ")}.`, "error");
            return;
          }
        }
        // surface area is used in the folder name and the pressure calculation,
        // so it must be a positive number for every test type.
        const surfaceAreaRaw = (document.getElementById("surfaceArea").value || "").trim();
        const surfaceAreaValue = Number(surfaceAreaRaw);
        if (!surfaceAreaRaw) {
          setMainMessage("Fill in Surface Area before continuing", "error");
          return;
        }
        if (!Number.isFinite(surfaceAreaValue) || surfaceAreaValue <= 0) {
          setMainMessage("Surface Area must be a positive number", "error");
          return;
        }
        // EM runs each a full press cycle; require a whole number from 1 to
        // MAX_EM_RUNS so a typo (e.g. 100) can't kick off an enormous test. Redo
        // mode and single-dataset tests (Shear/Manual/Fatigue) always use 1 run.
        if (cfg.test_type === "EM" && !cfg.redo_run) {
          const runsRaw = (document.getElementById("runs").value || "").trim();
          const runsValue = Number(runsRaw);
          if (!runsRaw) {
            setMainMessage("Fill in Number of Runs before continuing", "error");
            return;
          }
          if (!Number.isFinite(runsValue) || !Number.isInteger(runsValue) || runsValue < 1) {
            setMainMessage("Number of Runs must be a positive whole number", "error");
            return;
          }
          if (runsValue > MAX_EM_RUNS) {
            setMainMessage(`Number of runs can be at most ${MAX_EM_RUNS}.`, "error");
            return;
          }
        }
        if (cfg.test_type === "EM" || cfg.test_type === "Manual" || cfg.test_type === "Fatigue") {
          // A COM port must be selected to run a Zaber-driven test.
          if (!cfg.comport) {
            setMainMessage("Fill in Zaber COM Port before continuing", "error");
            return;
          }
          // Verify the Zaber is actually reachable before opening the test window.
          // The gate's connection-check now probes the LIVE connection (a position
          // read) and only reopens the port if there is no live one - so a port that
          // is genuinely connected is never falsely reported as disconnected, and a
          // real disconnect is still caught even though it was "verified" when the
          // port was selected. Hard-block on a real rig; stay soft in simulation.
          if (!(await zaberStartGateOk())) return;
        }
        let startResult = { ok: true, message: `Folder path: ${currentComputedTestFolder()}` };
        if (cfg.test_type !== "Fatigue") {
          startResult = await callApi("/api/start-test");
          if (!startResult.ok) return;
          const saveFolderInput = document.getElementById("saveFolder");
          if (startResult.test_folder) {
            saveFolderInput.dataset.selectedTestFolder = startResult.test_folder;
          }
        }
        try {
          localStorage.setItem("zaberLastSensorId", cfg.sensor_id);
        } catch (error) {
          // browser storage is only used to prefill the next session.
        }
        setMainMessage(startResult.message || "", "ok");
        if (cfg.test_type === "Shear") {
          openShearTest();
        } else if (cfg.test_type === "Manual") {
          openManualTest();
        } else if (cfg.test_type === "Fatigue") {
          openCyclicalTest();
        } else {
          openEmTest();
        }
      }

      function openEmTest() {
        emTestModal.showModal();
        resetEmSimulation();
        setEmState("IDLE", "em testing window opened.");
        setEmState("READY", "click start to begin run 1.");
        appendEmTableHeader();
        drawEmForceGraph();
      }

      function openShearTest() {
        shearTestModal.showModal();
        resetShearGraph();
        drawShearGraph();
      }

      function openManualTest() {
        manualTestModal.showModal();
        resetManualTest();
      }

      function openCyclicalTest() {
        cyclicalTestModal.showModal();
        resetCyclicalTest();
        drawCyclicalPreview();
      }

      async function openCalibration() {
        // Open Calibration is gated like START: the window only opens if the Zaber
        // initializes. On a sim-only machine it opens with a simulation notice; on
        // a real rig with no connection it stays closed (no point opening a window
        // whose every control needs hardware).
        const status = await callApi("/api/connection-check", {});
        if (status && status.connected !== true && status.simulation !== true) {
          showErrorDialog(
            `Could not connect to the Zaber actuator on ${document.getElementById("comport").value || "the selected COM port"}. Check the connection and try again.`,
            "Connect a Zaber first");
          return;
        }
        initializeCalibrationSettings();
        setPositionReadout(17);
        calibrationModal.showModal();
        // window-specific notice belongs in the calibration window itself.
        if (status && status.simulation === true && status.connected !== true) {
          addCalibrationUpdate("No Zaber connected - calibration running in simulation mode.");
        }
      }

      async function homeAxis() {
        if (calibrationMoveInFlight) return;
        setForceReadout(0);
        addCalibrationUpdate("returning to home position…");
        calibrationMoveInFlight = true;
        setCalibrationControlsLocked(true, "HOMING", "actuator returning to home - please wait", "discarded");
        try {
          const result = await callApi("/api/home", {}, "Manual control: Returning to HOME position");
          // update the readout only once the stage has reached home.
          setPositionReadout(result && typeof result.position === "number" ? result.position : 17);
          addCalibrationUpdate("at home position.");
        } finally {
          calibrationMoveInFlight = false;
          setCalibrationControlsLocked(false, "READY", "actuator idle. controls ready.", "kept");
        }
      }

      // ask python for the live serial ports and rebuild the COM port dropdown,
      // mirroring emilio's comport combobox. then connect to the selected one.
      async function refreshComPorts() {
        const select = document.getElementById("comport");
        if (!select) return;
        const previous = select.value;
        const result = await callApi("/api/list-ports");
        const ports = (result && result.ports) || [];
        select.innerHTML = "";
        // placeholder first: the user must actively pick a port (no default).
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select COM port";
        select.appendChild(placeholder);
        ports.forEach((port) => {
          const option = document.createElement("option");
          option.value = port;
          option.textContent = port;
          select.appendChild(option);
        });
        // keep a prior real selection if it still exists; otherwise show placeholder.
        select.value = (previous && ports.includes(previous)) ? previous : "";
        updateComPortPlaceholder();
        updateFolderInfoTag();
        // do NOT auto-connect on load - only connect once the user picks a port.
      }

      // gray out the dropdown while it shows the "Select COM port" placeholder.
      function updateComPortPlaceholder() {
        const select = document.getElementById("comport");
        if (select) select.classList.toggle("comport-placeholder", !select.value);
      }

      // open the serial connection for the selected port (like emilio's
      // trace_comport). the backend falls back to a simulated stage if nothing
      // answers, so this never blocks the gui.
      async function connectComPort(announce = false) {
        const select = document.getElementById("comport");
        if (!select || !select.value) return;
        const result = await callApi("/api/connect", { comport: select.value });
        if (!result) return;
        // selecting a port connects immediately and surfaces the result right
        // here (with the specific failure reason from ZaberCLI.last_error), so the
        // user gets feedback on the config page instead of waiting until START.
        if (result.connected === false) {
          setMainMessage(result.message || `Couldn't connect to a Zaber on ${select.value}. Try a different COM port.`, "error");
        } else if (result.connected === true) {
          setMainMessage(result.message || `Connected to Zaber on ${select.value}.`, "");
        } else if (announce && result.message) {
          setMainMessage(result.message, result.ok ? "" : "error");
        }
      }

      // ---- event wiring + startup (runs last) ----

      // if the tab/window closes mid-test, tell python to stop the motor.
      // sendBeacon is the only request type guaranteed to fire during unload.
      window.addEventListener("beforeunload", () => {
        const testActive = Boolean(emRunTimer || shearTimer || cyclicalTimer || manualMotionTimer);
        if (!testActive) return;
        try {
          const body = new Blob([JSON.stringify({})], { type: "application/json" });
          navigator.sendBeacon(apiUrl("/api/stop"), body);
        } catch (error) {
          // best effort - nothing else we can do during unload.
        }
      });

      document.getElementById("testType").addEventListener("change", () => {
        clearResolvedTestFolder(true);
        updateTestConfigState();
        scheduleExistingTestCheck();
      });
      document.getElementById("surfaceArea").addEventListener("input", scheduleExistingTestCheck);
      document.getElementById("surfaceArea").addEventListener("change", scheduleExistingTestCheck);
      document.getElementById("comport").addEventListener("change", () => {
        updateComPortPlaceholder();
        updateFolderInfoTag();
        connectComPort(true);
      });
      document.getElementById("incrementDistance").addEventListener("input", saveCalibrationIncrement);
      document.getElementById("incrementDistance").addEventListener("change", saveCalibrationIncrement);
      existingTestModal.addEventListener("cancel", (event) => {
        event.preventDefault();
      });
      emTestModal.addEventListener("cancel", (event) => {
        // route ESC through the guarded close so a paused test can't be closed raw
        // (which would orphan the backend run and block the next test).
        event.preventDefault();
        closeEmTestWindow();
      });
      calibrationModal.addEventListener("cancel", (event) => {
        if (fujiTimer) event.preventDefault();
      });
      cyclicalTestModal.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeCyclicalTestWindow();
      });
      shearTestModal.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeShearTestWindow();
      });
      document.getElementById("redoRun").addEventListener("change", () => {
        const redoRunInput = document.getElementById("redoRun");
        if (redoRunInput.dataset.lockedByExistingFolder === "true") {
          redoRunInput.checked = true;
        }
        updateTestConfigState();
      });
      document.getElementById("useCustomSensorId").addEventListener("change", updateSensorIdMode);
      document.getElementById("customSensorId").addEventListener("input", () => {
        invalidateBasicSettings();
        updateFolderInfoTag();
      });
      ["sensorYear", "sensorMonth", "sensorDay", "sensorBatch", "sensorNumber", "sensorLocation"].forEach((id) => {
        document.getElementById(id).addEventListener("input", normalizeSensorSegment);
        document.getElementById(id).addEventListener("change", normalizeSensorSegment);
        document.getElementById(id).addEventListener("focus", (event) => event.target.select());
      });
      document.getElementById("manualTargetForce").addEventListener("input", () => {
        const value = Number(document.getElementById("manualTargetForce").value || 0);
        if (value > ACTUATOR_PEAK_THRUST_N) {
          setManualState("READY", `warning: ${value.toFixed(1)} N exceeds the actuator's ${ACTUATOR_PEAK_THRUST_N} N peak thrust and may not be reachable.`);
        }
      });
      // Snap EVERY numeric field that declares min/max limits into range (and to its step
      // precision) on commit/blur - allowing free typing first, then correcting on commit.
      // Reads each field's own min/max/step, so all limited inputs (force bounds, speed,
      // increment, extrusion, surface area, graph axes, cycle count, ...) snap uniformly
      // and pick up limit changes automatically.
      //
      // When a value was OUT OF RANGE (not just rounded), show a message naming that
      // field's actual limit, in that field's own window. Two listeners on the same
      // event: a CAPTURE listener clamps the value first (so each field's own change
      // handler sees the corrected value) and records whether a limit was hit; a BUBBLE
      // listener then shows the limit message AFTER the field's own handler ran, so the
      // message is not immediately overwritten by that handler's status text.
      const SNAP_LIMIT_MSG = {
        runs:                ["main", "Number of Runs must be a whole number of at least 1."],
        surfaceArea:         ["main", "Surface Area must be a positive number."],
        incrementDistance:   ["calibration", "Increment Distance must be between 0.1 and 12 mm."],
        extrusionDistance:   ["calibration", "Extrusion Distance must be between 0.5 and 12 mm."],
        manualIncrementDistance: ["manual", "Increment Distance must be between 0.1 and 12 mm."],
        manualActuatorSpeed: ["manual", "Actuator Speed can be up to 2 mm/s."],
        manualTargetForce:   ["manual", "Target Force can be up to 32 N."],
        cyclicalLowerForce:  ["fatigue", "Lower Force Bound must be a whole number of at least 1 N."],
        cyclicalUpperForce:  ["fatigue", "Upper Force Bound cannot exceed 32 N."],
        waveformFrequency:   ["fatigue", "Frequency must be between 0.1 and 1 Hz."],
        cyclicalCycleCount:  ["fatigue", "Number of Cycles must be a whole number of at least 1."],
      };
      function showSnapLimitMessage(id) {
        const entry = SNAP_LIMIT_MSG[id];
        if (!entry) return;
        let [where, msg] = entry;
        if (id === "waveformFrequency") {   // the max is waveform-dependent (1 Hz square, 5 Hz else)
          const mx = document.getElementById("waveformFrequency").getAttribute("max") || "5";
          msg = `Frequency must be between 0.1 and ${mx} Hz.`;
        }
        if (where === "main") setMainMessage(msg, "error");
        else if (where === "calibration") addCalibrationUpdate(msg);
        else if (where === "manual") setManualState("READY", msg);
        else if (where === "fatigue") setStatePill("cyclicalState", "ERROR", msg);
      }
      ["change", "focusout"].forEach((evt) => {
        document.addEventListener(evt, (e) => { e.target.__snapHit = snapNumberInput(e.target); }, true);
        document.addEventListener(evt, (e) => {
          if (e.target && e.target.__snapHit) { e.target.__snapHit = false; showSnapLimitMessage(e.target.id); }
        }, false);
      });
      ["waveformType", "cyclicalLowerForce", "cyclicalUpperForce", "waveformFrequency", "cyclicalCycleCount"].forEach((id) => {
        document.getElementById(id).addEventListener("input", () => {
          updateTestConfigState();
          if (cyclicalTestModal.open) drawCyclicalPreview();
        });
        document.getElementById(id).addEventListener("change", () => {
          updateTestConfigState();
          if (cyclicalTestModal.open) drawCyclicalPreview();
        });
      });
      // Frequency limits are waveform-dependent: a square wave only holds its flats up to
      // ~0.25 Hz so it is capped at 1 Hz (default 0.25); sine and the others track fine and
      // keep the full 0.1 to 5 Hz range (default 1). Picking a waveform sets both the max and
      // a sensible default; the operator can still change the value afterward.
      document.getElementById("waveformType").addEventListener("change", () => {
        const isSquare = document.getElementById("waveformType").value.toLowerCase().startsWith("square");
        const freq = document.getElementById("waveformFrequency");
        freq.max = isSquare ? "1" : "5";
        freq.value = isSquare ? "0.25" : "1";
        if (cyclicalTestModal.open) drawCyclicalPreview();
      });
      ["sensorType"].forEach((id) => {
        document.getElementById(id).addEventListener("input", invalidateBasicSettings);
        document.getElementById(id).addEventListener("change", invalidateBasicSettings);
      });
      // Save Folder: when the user edits the path by typing, sync the stored base
      // folder to what they typed. config() reverts the field to dataset.baseSaveFolder
      // whenever they differ, so without this sync anything typed after a Browse
      // selection (which sets baseSaveFolder) would be wiped on the next config() call.
      ["input", "change"].forEach((evt) => {
        document.getElementById("saveFolder").addEventListener(evt, () => {
          const saveFolderInput = document.getElementById("saveFolder");
          saveFolderInput.dataset.baseSaveFolder = saveFolderInput.value;
          saveFolderInput.dataset.selectedTestFolder = "";
          saveFolderInput.dataset.existingTestAction = "";
          invalidateBasicSettings();
        });
      });
      document.getElementById("runToRedo").addEventListener("change", () => {
        const value = document.getElementById("runToRedo").value;
        if (!value) {
          setMainMessage("pick which run to redo.", "ok");
        } else {
          setMainMessage(`redo mode will create a new run that supersedes run ${value}.`);
        }
      });

      ["secondsToDisplay", "yAxisMin", "yAxisLimit", "showMarkers", "cumulativeTime"].forEach((id) => {
        document.getElementById(id).addEventListener("input", drawShearGraph);
        document.getElementById(id).addEventListener("change", drawShearGraph);
      });

      ["manualSecondsToDisplay", "manualYAxisMin", "manualYAxisLimit", "manualShowMarkers", "manualCumulativeTime"].forEach((id) => {
        document.getElementById(id).addEventListener("input", drawManualGraphs);
        document.getElementById(id).addEventListener("change", drawManualGraphs);
      });
      document.getElementById("manualControlMode").addEventListener("change", updateManualControlMode);
      manualTestModal.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeManualTestWindow();
      });

      // On the Windows rig, default the save folder to the operator's Downloads.
      // The value baked into index.html is only the Mac dev default; this runs at
      // load (before the user types anything), so it never clobbers a typed path.
      function applyDefaultSaveFolder() {
        const el = document.getElementById("saveFolder");
        if (!el) return;
        const isWindows = /Win/i.test(navigator.platform || navigator.userAgent || "");
        if (isWindows) el.value = "C:\\Users\\eng\\Downloads\\";
      }

      // startup calls. these set defaults, draw empty graphs, and prepare field validation.
      applyDefaultSaveFolder();
      initializeSensorIdBuilder();
      initializeCalibrationSettings();
      updateSensorIdMode();
      updateManualControlMode();
      updateTestConfigState();
      updateFolderInfoTag();
      setEmStatus([`[${stamp()}] IDLE: system initialized.`, `[${stamp()}] READY: waiting for test to begin.`, "Run Number | Time (s) | Force (N)"]);
      refreshComPorts();
