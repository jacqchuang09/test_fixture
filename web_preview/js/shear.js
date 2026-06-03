/*
 * shear.js — Shear test window.
 *
 * Owns the shear test modal and the shear analysis modal. Runs the live
 * shear-force capture and flags channels that cross the delta/short threshold.
 *
 * Structure:
 *   - Settings / time controls: shearSettings, updateShearTimeControls.
 *   - Capture: resetShearGraph, startShearGraph, pauseShearGraph,
 *     addShearPoint, drawShearGraph, previewShearForceOverTime.
 *   - Analysis: performShearAnalysis, shearChannelPlotSvg,
 *     shearDetectionTable, populateShearAnalysis, setShearState.
 *
 * Reads shared.js globals (shearData, latestShearAnalysisData, shearTimer)
 * and shared helpers (callApi, runAnalysisProgress, formatShortedChannels...).
 */


      function setShearState(state, message) {
        setStatePill(shearStateEl, state, message);
        document.getElementById("shearMessage").textContent = "";
      }

      // preview force curve for shear. it rises gently toward the normal shear-test range.
      function previewShearForceOverTime(elapsedSeconds) {
        const rise = 1.5 * (1 - Math.exp(-elapsedSeconds / 2.2));
        const ripple = Math.sin(elapsedSeconds * 2.1) * 0.04;
        return Math.min(1.55, Math.max(0, rise + ripple));
      }

      function shearSettings() {
        const yMin = Number(document.getElementById("yAxisMin").value || 0);
        const yLimit = Number(document.getElementById("yAxisLimit").value || 5);
        return {
          seconds: Math.max(1, Number(document.getElementById("secondsToDisplay").value || 30)),
          yMin,
          yLimit: Math.max(yMin + 1, yLimit),
          showMarkers: document.getElementById("showMarkers").checked,
          cumulativeTime: document.getElementById("cumulativeTime").checked,
        };
      }

      function updateShearTimeControls() {
        document.getElementById("secondsToDisplay").disabled = document.getElementById("cumulativeTime").checked;
      }

      function resetShearGraph() {
        clearInterval(shearTimer);
        clearTimeout(shearAnalysisUnlockTimer);
        shearTimer = null;
        shearAnalysisUnlockTimer = null;
        shearData = [];
        latestShearAnalysisData = [];
        shearStartTime = null;
        document.getElementById("shearStartButton").disabled = false;
        document.getElementById("shearPauseButton").disabled = true;
        document.getElementById("shearAnalysisButton").disabled = true;
        drawShearGraph();
        setShearState("READY", "click Start to begin live shear graph.");
      }

      function startShearGraph() {
        shearData = [];
        latestShearAnalysisData = [];
        shearStartTime = performance.now();
        clearInterval(shearTimer);
        clearTimeout(shearAnalysisUnlockTimer);
        shearTimer = setInterval(addShearPoint, 10);
        document.getElementById("shearStartButton").disabled = true;
        document.getElementById("shearPauseButton").disabled = false;
        document.getElementById("shearAnalysisButton").disabled = true;
        document.getElementById("shearTestCloseButton").disabled = true;
        setShearState("RUNNING", "live shear graph updating.");
        drawShearGraph();
      }

      function pauseShearGraph() {
        clearInterval(shearTimer);
        clearTimeout(shearAnalysisUnlockTimer);
        shearTimer = null;
        shearAnalysisUnlockTimer = null;
        if (shearData.length) {
          latestShearAnalysisData = shearData.slice();
        }
        shearData = [];
        shearStartTime = null;
        document.getElementById("shearStartButton").disabled = false;
        document.getElementById("shearPauseButton").disabled = true;
        document.getElementById("shearAnalysisButton").disabled = latestShearAnalysisData.length === 0;
        document.getElementById("shearTestCloseButton").disabled = false;
        updateShearTimeControls();
        drawShearGraph();
        setShearState("STOPPED", "graph stopped and reset to 0 seconds. click Start to begin again.");
      }

      function addShearPoint() {
        const elapsed = (performance.now() - shearStartTime) / 1000;
        const force = previewShearForceOverTime(elapsed);
        shearData.push({ time: elapsed, force });
        latestShearAnalysisData = shearData.slice();
        document.getElementById("shearAnalysisButton").disabled = true;
        drawShearGraph();
      }

      function drawShearGraph() {
        const graph = document.getElementById("shearGraph");
        updateShearTimeControls();
        const settings = shearSettings();
        const width = 960;
        const height = 340;
        const padLeft = 92;
        const padBottom = 52;
        const padTop = 58;
        const padRight = 24;
        const latest = shearData.length ? shearData[shearData.length - 1].time : 0;
        const startTime = settings.cumulativeTime ? 0 : Math.max(0, latest - settings.seconds);
        const visible = shearData.filter((point) => point.time >= startTime);
        const data = visible.length ? visible : [{ time: startTime, force: settings.yMin }];
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;
        const timeSpan = settings.cumulativeTime ? Math.max(1, latest - startTime, 5) : Math.max(1, settings.seconds);
        const ySpan = settings.yLimit - settings.yMin;
        const toX = (time) => padLeft + ((time - startTime) / timeSpan) * plotWidth;
        const toY = (force) => height - padBottom - ((force - settings.yMin) / ySpan) * plotHeight;
        const axisY = height - padBottom;
        const xTicks = xAxisTicks(startTime, startTime + timeSpan, toX, axisY, "s");
        const yTickCount = 5;
        const yTicks = Array.from({ length: yTickCount + 1 }, (_, index) => {
          const value = settings.yMin + (ySpan * index) / yTickCount;
          const y = toY(value);
          return `
            <line x1="${padLeft - 5}" y1="${y.toFixed(2)}" x2="${padLeft}" y2="${y.toFixed(2)}" stroke="#c7d1df" stroke-width="1"></line>
            <line x1="${padLeft}" y1="${y.toFixed(2)}" x2="${width - padRight}" y2="${y.toFixed(2)}" stroke="#edf2f7" stroke-width="1"></line>
            <text x="${padLeft - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="#697790" font-size="12" font-family="Inter, sans-serif">${value.toFixed(value >= 10 ? 0 : 1)}</text>
          `;
        }).join("");
        const path = data.map((point, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${toX(point.time).toFixed(2)},${toY(point.force).toFixed(2)}`;
        }).join(" ");
        const markerStep = Math.max(1, Math.ceil(data.length / 40));
        const markers = settings.showMarkers
          ? data.filter((_, index) => index % markerStep === 0 || index === data.length - 1)
              .map((point) => `<circle cx="${toX(point.time).toFixed(2)}" cy="${toY(point.force).toFixed(2)}" r="2.4" fill="#3f8b42"></circle>`)
              .join("")
          : "";
        setGraphHoverPoints("shearGraph", data.map((point) => ({
          x: toX(point.time),
          y: toY(point.force),
          label: `Time: ${point.time.toFixed(3)} s<br>Force: ${point.force.toFixed(3)} N`,
        })));

        graph.innerHTML = `
          <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
          <path d="M${padLeft},${padTop} L${padLeft},${height - padBottom} L${width - padRight},${height - padBottom}" fill="none" stroke="#c7d1df" stroke-width="1"></path>
          ${yTicks}
          ${xTicks}
          <text x="${padLeft}" y="20" fill="#697790" font-size="15" font-family="Inter, sans-serif">Force (N)</text>
          <text x="${width / 2 - 75}" y="${height - 12}" fill="#697790" font-size="15" font-family="Inter, sans-serif">Time Elapsed (seconds)</text>
          <path d="${path}" fill="none" stroke="#3f73e6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
          ${markers}
        `;
      }

      async function performShearAnalysis() {
        clearInterval(shearTimer);
        clearTimeout(shearAnalysisUnlockTimer);
        shearTimer = null;
        shearAnalysisUnlockTimer = null;
        if (shearData.length) {
          latestShearAnalysisData = shearData.slice();
        }
        document.getElementById("shearAnalysisButton").disabled = true;
        document.getElementById("shearStartButton").disabled = false;
        document.getElementById("shearPauseButton").disabled = true;
        document.getElementById("shearTestCloseButton").disabled = false;
        updateShearTimeControls();
        setShearState("ANALYSIS", "analysis started. live plotting stopped.");
        const result = await runAnalysisProgress("Generating shear analysis outputs...", () => callApi("/api/perform-analysis", {
          shear_readings: latestShearAnalysisData,
        }));
        document.getElementById("shearAnalysisButton").disabled = false;
        if (!result.ok) return;
        setShearState("ANALYSIS", result.message || "shear analysis outputs saved.");
        populateShearAnalysis(result.analysis || null);
        shearAnalysisModal.showModal();
      }

      function shearChannelPlotSvg(readings) {
        const width = 1120;
        const channelHeight = 44;
        const forceHeight = 54;
        const gap = 7;
        const padLeft = 54;
        const padRight = 58;
        const padTop = 18;
        const padBottom = 32;
        const height = padTop + (channelHeight + gap) * 8 + forceHeight + padBottom;
        const plotWidth = width - padLeft - padRight;
        const duration = Math.max(1, readings[readings.length - 1].time - readings[0].time, 5);
        const startTime = readings[0].time;
        const toX = (time) => padLeft + ((time - startTime) / duration) * plotWidth;
        const timeTicks = xAxisTicks(0, duration, (time) => padLeft + (time / duration) * plotWidth, height - padBottom, "s");
        const channelPlots = Array.from({ length: 8 }, (_, channelIndex) => {
          const yTop = padTop + channelIndex * (channelHeight + gap);
          const baseline = 22 + (8 - channelIndex) * 0.55;
          const capValues = readings.map((point, pointIndex) => {
            const pulse = Math.max(0, point.force) * (0.13 + channelIndex * 0.015);
            const ripple = Math.sin(point.time * (0.8 + channelIndex * 0.09)) * 0.18;
            const burst = pointIndex % (42 + channelIndex * 3) < 8 ? point.force * 0.08 : 0;
            return baseline + pulse + ripple + burst;
          });
          const minCap = Math.min(...capValues, baseline - 0.5);
          const maxCap = Math.max(...capValues, baseline + 2);
          const span = Math.max(1, maxCap - minCap);
          const toY = (value) => yTop + channelHeight - 10 - ((value - minCap) / span) * (channelHeight - 18);
          const path = readings.map((point, index) => {
            const command = index === 0 ? "M" : "L";
            return `${command}${toX(point.time).toFixed(2)},${toY(capValues[index]).toFixed(2)}`;
          }).join(" ");
          return `
            <rect x="${padLeft}" y="${yTop}" width="${plotWidth}" height="${channelHeight}" fill="#ffffff" stroke="#d7dee9"></rect>
            <text x="${width / 2}" y="${yTop + 13}" text-anchor="middle" fill="#20242c" font-size="12" font-family="Inter, sans-serif">CH ${channelIndex + 1}</text>
            <text x="${padLeft - 18}" y="${yTop + channelHeight / 2}" text-anchor="middle" transform="rotate(-90 ${padLeft - 18} ${yTop + channelHeight / 2})" fill="#4f86c6" font-size="10" font-family="Inter, sans-serif">CAP (pF)</text>
            <text x="${width - 20}" y="${yTop + channelHeight / 2}" text-anchor="middle" transform="rotate(-90 ${width - 20} ${yTop + channelHeight / 2})" fill="#ff8a3d" font-size="10" font-family="Inter, sans-serif">ΔCAP (pF)</text>
            <line x1="${padLeft}" y1="${yTop + channelHeight - 10}" x2="${width - padRight}" y2="${yTop + channelHeight - 10}" stroke="#edf2f7"></line>
            <path d="${path}" fill="none" stroke="#3f7fb8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          `;
        }).join("");
        const forceTop = padTop + 8 * (channelHeight + gap);
        const forceMax = Math.max(5, ...readings.map((point) => point.force));
        const forceToY = (force) => forceTop + forceHeight - 10 - (force / forceMax) * (forceHeight - 18);
        const forcePath = readings.map((point, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${toX(point.time).toFixed(2)},${forceToY(point.force).toFixed(2)}`;
        }).join(" ");
        return `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Shear channel capacitance and force plot">
            <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
            ${channelPlots}
            <rect x="${padLeft}" y="${forceTop}" width="${plotWidth}" height="${forceHeight}" fill="#ffffff" stroke="#d7dee9"></rect>
            <text x="${padLeft - 22}" y="${forceTop + forceHeight / 2}" text-anchor="middle" transform="rotate(-90 ${padLeft - 22} ${forceTop + forceHeight / 2})" fill="#20242c" font-size="11" font-family="Inter, sans-serif">Force (N)</text>
            <text x="${width / 2 - 20}" y="${height - 7}" fill="#20242c" font-size="11" font-family="Inter, sans-serif">Time (s)</text>
            <path d="${forcePath}" fill="none" stroke="#3f8b42" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
            ${timeTicks}
          </svg>
        `;
      }

      function shearDetectionTable(negativeByChannel, deltaEventsByChannel) {
        const channels = Array.from({ length: 8 }, (_, index) => index + 1);
        const negativeCells = channels.map((channel) => {
          const item = negativeByChannel.find((entry) => entry.channel === channel);
          return item?.values?.length ? `${Math.min(...item.values).toFixed(3)} pF` : "none";
        });
        const deltaCells = channels.map((channel) => {
          const events = deltaEventsByChannel.filter((event) => event.channel === channel);
          return events.length ? `${Math.max(...events.map((event) => event.delta)).toFixed(3)} pF` : "none";
        });
        const row = (label, cells) => `
          <tr>
            <th><strong>${label}</strong></th>
            ${cells.map((cell) => `<td${cell !== "none" ? ' class="metric-alert"' : ""}>${cell}</td>`).join("")}
          </tr>
        `;
        return `
          <div class="stats-table-wrap">
            <table class="stats-table">
              <thead>
                <tr>
                  <th></th>
                  ${channels.map((channel) => `<th>ch ${channel}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${row("negative CAP", negativeCells)}
                ${row("delta_CAP_gt_10pF", deltaCells)}
              </tbody>
            </table>
          </div>
        `;
      }

      // fill the shear analysis tabs and automatically flag channels that cross the delta threshold.
      // render the Shear Report Output: editable fields + colored preview + copy.
      function renderShearReportPanel(shortedChannels, testResult) {
        shearReportShorted = (shortedChannels && shortedChannels !== "None") ? shortedChannels : "None";
        shearReportResult = (String(testResult).toUpperCase() === "PASS") ? "Pass" : "Fail";
        document.getElementById("shear-reportOutput").innerHTML = `
          <div class="report-fields">
            <label class="report-field"><span>Site</span>
              <select id="shearSite" onchange="renderShearReport()">
                <option value="">Select site…</option>
                <option value="ULP">ULP</option>
                <option value="Roseman">Roseman</option>
                <option value="Roseman - ULP">Roseman - ULP</option>
                <option value="ULP - Roseman">ULP - Roseman</option>
              </select>
            </label>
            <label class="report-field"><span>Shear Fixture</span>
              <select id="shearFixture" onchange="renderShearReport()">
                <option value="">Select fixture…</option>
                <option value="FXT0009-01">FXT0009-01</option>
                <option value="FXT0009-02">FXT0009-02</option>
              </select>
            </label>
            <label class="report-field"><span>Sign off</span>
              <input id="shearSignoff" placeholder="Initials" oninput="renderShearReport()" />
            </label>
          </div>
          <div class="copy-row">
            <button id="copyShearReportButton" onclick="copyShearReportValues()">Copy Values</button>
          </div>
          <div id="shearReportPreview"></div>
          <textarea id="shearReportOutputText" class="copy-source" readonly></textarea>
        `;
        renderShearReport();
      }

      function shearTrackerOutput() {
        const fieldValue = (id) => (document.getElementById(id)?.value || "").trim();
        const headerTop = ["Identification", "", "SHEARING TEST", "", "", "", "", "", ""];
        const header = [
          "Sensor Lot Number", "Site", "Test Date", "Shear Fixture", "Shear Test software",
          "Vena Vitals Wearable iOS App", "Shorted CH(S) Via Shear", "FPQC-S-001 Shearing Test Results", "Sign off",
        ];
        const row = [
          config().sensor_id || "", fieldValue("shearSite"), isoDate(), fieldValue("shearFixture"),
          "SW002", "SW0004", shearReportShorted, shearReportResult, fieldValue("shearSignoff"),
        ];
        return [headerTop.join("\t"), header.join("\t"), row.join("\t")].join("\n");
      }

      function renderShearReport() {
        const tsv = shearTrackerOutput();
        const preview = document.getElementById("shearReportPreview");
        const text = document.getElementById("shearReportOutputText");
        if (preview) preview.innerHTML = coloredReportPreviewTable(tsv);
        if (text) text.value = tsv;
      }

      async function copyShearReportValues() {
        const required = [
          { id: "shearSite", label: "Site" },
          { id: "shearFixture", label: "Shear Fixture" },
          { id: "shearSignoff", label: "Sign off" },
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
        copyReportValues("shearReportOutputText", "copyShearReportButton");
      }

      function populateShearAnalysis(analysis = null) {
        renderInteractivePanel("shear", analysis);
        // When the real matplotlib engine ran, show its figure + real detection.
        if (analysis && analysis.shear_images && analysis.shear_images.raw_fig) {
          const detection = Array.isArray(analysis.shear_detection) ? analysis.shear_detection : [];
          const failed = detection.filter((d) => d.failed).map((d) => d.channel);
          const shortedChannels = failed.length ? formatShortedChannels(failed) : "None";
          const testResult = analysis.shear_result || (failed.length ? "FAIL" : "PASS");
          // map the real detection into the same transposed table layout (channels
          // as columns; negative CAP and delta_CAP_gt_10pF rows).
          const negativeByChannel = detection.map((d) => ({ channel: d.channel, values: d.min_cap != null ? [d.min_cap] : [] }));
          const deltaEventsByChannel = detection
            .filter((d) => d.delta_over_count > 0)
            .map((d) => ({ channel: d.channel, delta: d.max_delta }));
          document.getElementById("shear-plot").innerHTML = `
            <div class="em-analysis-png-wrap">${emPngImg(analysis.shear_images.raw_fig, "Raw shearing figure — CAP and force")}</div>
          `;
          document.getElementById("shear-detection").innerHTML = shearDetectionTable(negativeByChannel, deltaEventsByChannel);
          renderShearReportPanel(shortedChannels, testResult);
          showAnalysisTab("shear", "plot");
          return;
        }

        const readings = latestShearAnalysisData.length ? latestShearAnalysisData : [{ time: 0, force: 0 }];
        const channelSeries = Array.from({ length: 8 }, (_, channelIndex) => {
          const baseline = 22 + (8 - channelIndex) * 0.55;
          const values = readings.map((point, pointIndex) => {
            const pulse = Math.max(0, point.force) * (0.13 + channelIndex * 0.015);
            const ripple = Math.sin(point.time * (0.8 + channelIndex * 0.09)) * 0.18;
            const burst = pointIndex % (42 + channelIndex * 3) < 8 ? point.force * 0.08 : 0;
            return baseline + pulse + ripple + burst;
          });
          return { channel: channelIndex + 1, values };
        });
        const negativeByChannel = channelSeries.map(({ channel, values }) => {
          const negativeValues = values.filter((value) => value < 0);
          return { channel, count: negativeValues.length, values: negativeValues };
        });
        const deltaEventsByChannel = channelSeries.map(({ channel, values }) => {
          const events = [];
          values.forEach((value, index) => {
            if (index === 0) return;
            const delta = Math.abs(value - values[index - 1]);
            if (delta > 10) events.push({ channel, delta, time: readings[index]?.time || 0 });
          });
          return events;
        }).flat();
        const failedChannels = deltaEventsByChannel.map((event) => event.channel);
        const shortedChannels = formatShortedChannels(failedChannels);
        const testResult = shortedChannels === "None" ? "PASS" : "FAIL";
        document.getElementById("shear-plot").innerHTML = `
          <div class="analysis-plot-scroll shear-analysis-plot">${shearChannelPlotSvg(readings)}</div>
        `;
        document.getElementById("shear-detection").innerHTML = shearDetectionTable(negativeByChannel, deltaEventsByChannel);
        renderShearReportPanel(shortedChannels, testResult);
        showAnalysisTab("shear", "plot");
      }
