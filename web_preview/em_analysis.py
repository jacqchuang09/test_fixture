"""
Real EM (Eco Blox) analysis engine.

This is a faithful adaptation of Emilio's zaber-python ``EMAnalysis`` class. It
keeps his scientific pipeline intact -- interpolate CAP/FUT to 200 Hz, sync the
two streams on the release peak, smooth the pressure/sensitivity (P.S) curve,
take the 1st derivative, and locate the inflection point (max slope) -- and
produces the same set of plots and result statistics the sensor team expects:

    Plots (PNG, written into the test folder):
      - Raw Signal_Run #N_CHk.png        (CAP / Pressure / hysteresis per channel)
      - PS curve all CHs number #N.png    (P.S curve + 1st-derivative inflection)
      - PS curves all ch per run.png      (all channels overlaid, one panel per run)
      - PS curves all run per CH.png       (all runs overlaid, one panel per channel)

    Data:
      - EB_Analysis_Results.xlsx          (every result array, one sheet per key)
      - eb_analysis_results.pkl           (pickled result dict)
      - eb_analysis_results.json          (JSON-safe result dict for the web app)

Adaptations for this project (vs. the original Tkinter version):
  - The constructor takes the *test folder* directly (the folder that contains
    the FUT/ and CAP/ subfolders), not the FUT folder.
  - FUT runs may be .xlsx (real FUTEK export) or .csv (preview/hardware capture);
    both are read into the same [Index, Load Cell, Time] column layout.
  - CAP files may have the real 16-column layout or the simpler preview layout;
    column selection is clamped to whatever width is present.
  - matplotlib runs head-less (Agg backend) so it works inside the packaged app.
  - Surface area is passed in (mm^2) instead of hard-coded.

The heavy scientific stack (numpy / pandas / scipy / matplotlib) is imported at
module import time, so callers that want a graceful fallback should import this
module inside a try/except.
"""

import copy
import json
import pickle
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # head-less: render straight to files, never open a window.

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.signal import find_peaks

from plot_style import apply_plot_style, rasterize_dense_lines, SIGNAL_COLORS

apply_plot_style()  # high-quality, crisp-text SVG styling for all figures
from scipy.ndimage import uniform_filter1d


def _run_sort_key(path):
    # sort run files naturally: Run 1, Run 2, ... Run 10 (not lexical 1,10,2).
    import re

    match = re.search(r"(\d+)", path.stem)
    return (int(match.group(1)) if match else 0, path.name)


def _share_axes(axes):
    # Put a list of axes onto one shared x/y scale (the union of their autoscaled
    # limits) so subplots can be compared on the same scale.
    axes = [a for a in axes if a is not None]
    if not axes:
        return
    x0 = min(a.get_xlim()[0] for a in axes)
    x1 = max(a.get_xlim()[1] for a in axes)
    y0 = min(a.get_ylim()[0] for a in axes)
    y1 = max(a.get_ylim()[1] for a in axes)
    for a in axes:
        a.set_xlim(x0, x1)
        a.set_ylim(y0, y1)


class EMAnalysis:
    def __init__(self, test_folder, sensor_id, sensor_type="Standard", surface_area_mm2=325.0, active_runs=None, progress=None):
        """
        Parameters:
            test_folder: folder containing the FUT/ and CAP/ run subfolders
            sensor_id: sensor ID string
            sensor_type: "Standard" or "Inverted" (sets channel order)
            surface_area_mm2: sensor surface area in mm^2 (converted to m^2 internally)
            active_runs: optional list of run numbers to analyze (the latest run in
                each supersession chain). When given, superseded/redone runs are
                excluded. When None, every run file is used.
            progress: optional callable(frac, message) reporting 0..1 pipeline progress
                (plotting dominates the runtime, so this drives the loading bar).
        """
        self._progress = progress if callable(progress) else (lambda frac, message="": None)
        self.sensor_id = sensor_id
        self.path = Path(test_folder)
        self.sensor_type = sensor_type

        # Channel order depends on how the sensor is wired.
        if sensor_type == "Standard":
            self.ch_order = np.arange(1, 9)
        elif sensor_type == "Inverted":
            self.ch_order = np.array([1, 2, 3, 4, 8, 7, 6, 5])
        else:
            raise ValueError(f"Invalid sensor_type: {sensor_type}")

        self.cap_path = self.path / "CAP"
        self.fut_path = self.path / "FUT"

        csv_files = sorted(self.cap_path.glob("*.csv"), key=_run_sort_key)
        # FUT may be exported as .xlsx (real FUTEK) or captured as .csv.
        fut_files = sorted(self.fut_path.glob("*.xlsx"), key=_run_sort_key)
        if not fut_files:
            fut_files = sorted(self.fut_path.glob("*.csv"), key=_run_sort_key)

        # keep only the active (non-superseded) runs when a list is provided.
        if active_runs:
            active = set(active_runs)
            csv_files = [f for f in csv_files if _run_sort_key(f)[0] in active]
            fut_files = [f for f in fut_files if _run_sort_key(f)[0] in active]

        # preserve the ACTUAL run numbers (e.g. [1, 3, 4] after a redo superseded
        # run 2) so plots/labels/files show the real run, not a 1..N re-index.
        self.run_numbers = [_run_sort_key(f)[0] for f in fut_files]

        self.cap_size = len(csv_files)

        if self.cap_size == 0 or len(fut_files) == 0:
            raise ValueError("EM analysis needs at least one CAP file and one FUT file.")

        self.cap, self.fut = self._create_data(csv_files, fut_files)

        # Pressure window (kPa) over which the P.S curve is analysed.
        self.start_force = 0
        self.end_force = 45

        self.ch = 8           # channels per sensor
        self.v = 5            # PCB board version offset: v2 = 2 | v3 = 5
        self.SA = float(surface_area_mm2) * 1e-6  # mm^2 -> m^2

        # Gate: every run must actually exceed the analysis window (45 kPa). This
        # rejects preview/simulated captures that never reach test pressure, so we
        # fall back to the lightweight preview analysis without writing any files.
        peak_kpa = [
            float(np.nanmax(self.fut[r].iloc[:, 1].values.astype(float))) / self.SA / 1000
            for r in range(self.cap_size)
        ]
        if min(peak_kpa) <= self.end_force:
            raise ValueError(
                f"Peak pressure {min(peak_kpa):.1f} kPa does not reach the {self.end_force} kPa "
                "analysis window; data is not a completed EM test."
            )

        # Reorder channels for this sensor type.
        self.cap = self._correct_ch_order(self.cap)

        # Storage.
        self.run = []
        self.t_c = []
        self.t_f = []
        self.test = []
        self.c = np.zeros((self.cap_size, self.ch))
        self.shorted_ch = None

        self.zaber_x = []
        self.zaber_y = []
        self.fir_dev = []
        self.valz = []
        self.locz = []
        self.max_ps = []
        self.max_kPa = []
        self.inf_CAP = []
        self.cap_inc = []

        self.max_ps_numeric = np.zeros((self.cap_size, self.ch))
        self.max_kPa_numeric = np.zeros((self.cap_size, self.ch))
        self.inf_CAP_numeric = np.zeros((self.cap_size, self.ch))

        # Run the pipeline. _synch_and_plot and _derive_and_plot report per-run inside.
        self._progress(0.05, "Interpolating CAP and force to 200 Hz…")
        self._interp_cap()
        self._synch_and_plot()
        self._derive_and_plot()
        self._progress(0.82, "Rendering channel plots…")
        self._plot_all_chs_across_runs()
        self._plot_all_runs_across_chs()
        self._progress(0.9, "Finalizing analysis…")

    # -- data loading -------------------------------------------------------

    def _create_data(self, csv_files, fut_files):
        cap = []
        fut = []
        for f in csv_files:
            df = pd.read_csv(f)
            # keep at most the first 16 columns (real layout); preview files have fewer.
            cap.append(df.iloc[:, : min(16, df.shape[1])])
        for f in fut_files:
            if f.suffix.lower() == ".xlsx":
                fut.append(pd.read_excel(f))
            else:
                fut.append(pd.read_csv(f))
        return cap, fut

    def _correct_ch_order(self, cap):
        reordered_cap = []
        for df in cap:
            ncols = df.shape[1]
            head = list(range(0, min(5, ncols)))
            channel_block = [c for c in (self.ch_order + self.v - 1) if c < ncols]
            tail = list(range(13, min(16, ncols)))
            cols = head + channel_block + tail
            reordered_cap.append(df.iloc[:, cols])
        return reordered_cap

    # -- 200 Hz interpolation ----------------------------------------------

    def _interp_cap(self):
        for i in range(self.cap_size):
            time_col = self.fut[i].iloc[:, 2]

            if pd.api.types.is_datetime64_any_dtype(time_col):
                time_diffs = time_col.diff()
                elapsed = time_diffs.fillna(pd.Timedelta(0)).cumsum().dt.total_seconds()
            else:
                elapsed = np.concatenate([[0], np.cumsum(np.diff(time_col))])
            elapsed = np.array(elapsed, dtype=float)

            # CAP time can contain NaNs that wreck interpolation; drop them.
            cap_time = self.cap[i].iloc[:, 0].values.astype(float)
            valid_mask = ~np.isnan(cap_time)
            cap_time_clean = cap_time[valid_mask]
            if cap_time_clean.size == 0:
                raise ValueError(
                    f"CAP file for run {self.run_numbers[i]} has no usable timestamps "
                    "(its first column is empty or all NaN).")

            t_c_i = np.arange(0, cap_time_clean[-1] + 0.005, 0.005)
            t_f_i = np.arange(0, elapsed[-1] + 0.005, 0.005)

            self.t_c.append(t_c_i)
            self.t_f.append(t_f_i)

            cap_interp = np.zeros((len(t_c_i), self.ch))
            for j in range(self.ch):
                col_idx = j + self.v
                cap_data = self.cap[i].iloc[:, col_idx].values.astype(float)[valid_mask]
                # Drop samples where THIS channel is NaN. A blank/NaN cell - often the
                # very first sample - would otherwise poison the baseline and turn the
                # whole channel into NaN, which later crashes the release-peak sync
                # (empty chan_candidates). A channel with no finite data stays flat zero.
                finite = ~np.isnan(cap_data)
                if not finite.any():
                    continue
                ct = cap_time_clean[finite]
                cd = cap_data[finite] - cap_data[finite][0]   # baseline = first finite value
                cap_interp[:, j] = np.interp(t_c_i, ct, cd)

            fut_interp = np.interp(t_f_i, elapsed, self.fut[i].iloc[:, 1].values.astype(float))
            # Orient the force so a compression press reads POSITIVE. This fixture uses
            # load cells of BOTH polarities; a cell that outputs negative under compression
            # leaves the press as a downward dip, so the pipeline's argmax peak detection
            # locks onto the near-zero start - the loading window [:loc_f] comes out empty
            # and the whole analysis crashes ("argmax of an empty sequence"), falling back
            # to the synthesized preview. Flip the sign (reflected about the resting
            # baseline, preserving magnitude) only when the dominant excursion is negative;
            # positive-reading data is left unchanged.
            if fut_interp.size:
                base = float(fut_interp[0])
                if abs(np.nanmin(fut_interp) - base) > abs(np.nanmax(fut_interp) - base):
                    fut_interp = 2.0 * base - fut_interp
            self.run.append([cap_interp, fut_interp])

    # -- sync CAP & FUT on the release peak, plot raw signals ---------------

    def _synch_and_plot(self):
        temp_run = copy.deepcopy(self.run)

        for i in range(self.cap_size):
            self._progress(0.10 + 0.38 * (i / max(1, self.cap_size)), f"Syncing & plotting run {i + 1}/{self.cap_size}…")
            # The max CAP corresponds to when the FUTEK released pressure (inflection).
            temp_max_cap = np.nanmax(temp_run[i][0], axis=0)
            self.shorted_ch = np.where(temp_max_cap > 10)[0]  # >10 pF change = shorted
            temp_run[i][0][:, self.shorted_ch] = 0

            # Pick the channel with the largest CAP swing to sync on. nan-safe and
            # guarded so a degenerate run cannot crash with an empty selection.
            max_per_channel = np.nanmax(temp_run[i][0], axis=0)
            global_max = np.nanmax(max_per_channel)
            chan_candidates = np.where(max_per_channel == global_max)[0]
            chan = int(chan_candidates[0]) if chan_candidates.size else 0

            loc_c = np.argmax(self.run[i][0], axis=0)
            loc_f = np.nanargmax(self.run[i][1])

            offset = int((self.t_c[i][loc_c[chan]] - self.t_f[i][loc_f]) * 200)

            if offset > 0:
                # CAP starts after FUT -> shift CAP backward.
                timec = self.t_c[i][offset:] - (offset * (1 / 200))
                caps = self.run[i][0][offset:, :]
                test_cap = np.column_stack([timec[:loc_f], caps[:loc_f, :]])

                timef = self.t_f[i][:]
                futs = self.run[i][1][:]
                test_fut = np.column_stack([timef[:loc_f], futs[:loc_f] / self.SA / 1000])
            else:
                offset = abs(offset)
                timec = self.t_c[i][:]
                caps = self.run[i][0][:, :]
                test_cap = np.column_stack([timec[:loc_f], caps[:loc_f, :]])

                timef = self.t_f[i][offset:] - (offset * (1 / 200))
                futs = self.run[i][1][offset:]
                test_fut = np.column_stack([timef[:loc_f], futs[:loc_f] / self.SA / 1000])

            self.c[i, :] = np.max(caps, axis=0)  # max CAP per channel

            # Trim the unload tail (peak + last 500 samples) so the drop-off
            # values don't pollute the rising P.S curve.
            force = test_fut[:, 1]
            # Guard a degenerate run (empty loading window) so it cannot crash the whole
            # analysis on np.argmax of an empty sequence; it just yields an empty trace.
            peak_idx = int(np.argmax(force)) if force.size else 0
            test_cap = test_cap[:peak_idx, :]
            test_fut = test_fut[:peak_idx, :]
            # only trim the 500-sample unload tail when there is enough data to trim; a
            # short loading curve keeps what it has instead of being emptied by [:-500].
            if test_cap.shape[0] > 500:
                test_cap = test_cap[:-500, :]
                test_fut = test_fut[:-500, :]

            self.test.append([test_cap, test_fut])

            # (raw-signal figures are drawn after this loop, in _plot_raw_signals,
            # so every channel and run can share one axis scale for comparison.)

        self._plot_raw_signals()

    def _plot_raw_signals(self):
        # Per-channel raw-signal figures (CAP/time, Pressure/time, hysteresis),
        # drawn after self.test is fully built so every figure shares ONE set of
        # axis limits and can be compared directly. A dot marks every sample.
        if not self.test:
            return
        cap_vals, time_vals, press_vals = [], [], []
        for tc, tf in self.test:
            if tc.size:
                cap_vals.append(tc[:, 1:1 + self.ch]); time_vals.append(tc[:, 0])
            if tf.size:
                press_vals.append(tf[:, 1]); time_vals.append(tf[:, 0])

        def _lim(arrs, pad=0.05):
            if not arrs:
                return None
            lo = float(np.nanmin([np.nanmin(a) for a in arrs]))
            hi = float(np.nanmax([np.nanmax(a) for a in arrs]))
            margin = (hi - lo) * pad or 1.0
            return lo - margin, hi + margin

        cap_lim, time_lim, press_lim = _lim(cap_vals), _lim(time_vals), _lim(press_vals)

        for i, (tc, tf) in enumerate(self.test):
            if not tc.size or not tf.size:
                continue
            for j in range(self.ch):
                fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(10, 12))
                # color each subplot by the TYPE of graph, not by channel; a dot per sample.
                ax1.plot(tc[:, 0], tc[:, j + 1], "-o", markersize=2, color=SIGNAL_COLORS["cap"])
                ax1.set_ylabel("Change in CAP (pF)", fontsize=12)
                ax1.set_xlabel("Time (s)", fontsize=12)
                ax1.set_title(f"Raw Signal - Run #{self.run_numbers[i]} - CH{j + 1}", fontsize=14, fontweight="bold")

                ax2.plot(tf[:, 0], tf[:, 1], "-o", markersize=2, color=SIGNAL_COLORS["pressure"])
                ax2.set_ylabel("Pressure (kPa)", fontsize=12)
                ax2.set_xlabel("Time (s)", fontsize=12)

                ax3.plot(tf[:, 1], tc[:, j + 1], "-o", markersize=2, color=SIGNAL_COLORS["hysteresis"])
                ax3.set_xlabel("Pressure (kPa)", fontsize=12)
                ax3.set_ylabel("Change in CAP (pF)", fontsize=12)

                for ax in (ax1, ax2, ax3):
                    ax.grid(True, alpha=0.3)
                # shared scales: every channel/run figure uses the same limits.
                if time_lim:
                    ax1.set_xlim(time_lim); ax2.set_xlim(time_lim)
                if cap_lim:
                    ax1.set_ylim(cap_lim); ax3.set_ylim(cap_lim)
                if press_lim:
                    ax2.set_ylim(press_lim); ax3.set_xlim(press_lim)

                plt.tight_layout()
                run_dir = self.path / "Raw Signal" / f"Run {self.run_numbers[i]}"
                run_dir.mkdir(parents=True, exist_ok=True)
                filename = run_dir / f"Raw Signal_Run #{self.run_numbers[i]}_CH{j + 1}.svg"
                rasterize_dense_lines(plt.gcf())
                plt.savefig(filename, format="svg", bbox_inches="tight")
                plt.close(fig)

    @staticmethod
    def _first_above(values, threshold, default):
        # index of the first sample above threshold, or a default if none qualify.
        hits = np.where(values - threshold > 0)[0]
        return int(hits[0]) if hits.size else default

    # -- 1st derivative + inflection detection, per-run P.S figure ----------

    def _derive_and_plot(self):
        for i in range(self.cap_size):
            self._progress(0.48 + 0.34 * (i / max(1, self.cap_size)), f"Building P.S curves run {i + 1}/{self.cap_size}…")
            fig = plt.figure(figsize=(20, 10))

            zaber_x_i = None
            zaber_y_i = []
            fir_dev_i = []
            max_ps_i = []
            max_kPa_i = []
            inf_CAP_i = []
            cap_inc_i = []

            pressure = self.test[i][1][:, 1]
            k = self._first_above(pressure, self.start_force, 0)
            f = self._first_above(pressure, self.end_force, len(pressure))
            for j in range(self.ch):
                x = self.test[i][1][k:f, 1]       # pressure (kPa)
                y = self.test[i][0][k:f, j + 1]   # CAP for channel j

                st_pt = self._first_above(x, 0, 0)
                x_smooth = pd.Series(x[st_pt:]).rolling(100, min_periods=1).mean().to_numpy()
                y_smooth = pd.Series(y[st_pt:]).rolling(100, min_periods=1).mean().to_numpy()

                if zaber_x_i is None:
                    zaber_x_i = x_smooth
                zaber_y_i.append(y_smooth)

                # 1st derivative of the P.S curve. Flat pressure regions (a dwell)
                # give np.diff(x)=0; guard the divide so they become 0 slope instead
                # of inf/NaN (which would otherwise warn and break peak detection).
                with np.errstate(divide="ignore", invalid="ignore"):
                    fir_dev_ij = np.diff(y_smooth) / np.diff(x_smooth)
                fir_dev_ij = np.nan_to_num(fir_dev_ij, nan=0.0, posinf=0.0, neginf=0.0)

                # First filter: clamp out-of-range slopes to 0.
                fir_dev_ij[(fir_dev_ij > 1) | (fir_dev_ij < 0)] = 0

                peaks, _ = find_peaks(fir_dev_ij, prominence=0.08, width=300)
                if len(peaks) > 1:
                    peak_values = fir_dev_ij[peaks]
                    max_idx = np.argmax(peak_values)
                    locz_ij = peaks[max_idx]
                    valz_ij = peak_values[max_idx]
                elif len(peaks) == 1:
                    locz_ij = peaks[0]
                    valz_ij = fir_dev_ij[locz_ij]
                else:
                    locz_ij = None
                    valz_ij = None

                # Second filter: clamp anything above the chosen peak to 0.
                if valz_ij is not None:
                    fir_dev_ij[fir_dev_ij > valz_ij] = 0

                fir_dev_i.append(fir_dev_ij)

                if valz_ij is None or locz_ij is None:
                    max_ps_i.append(np.nan)
                    max_kPa_i.append(np.nan)
                    inf_CAP_i.append(np.nan)
                    self.max_ps_numeric[i, j] = np.nan
                    self.max_kPa_numeric[i, j] = np.nan
                    self.inf_CAP_numeric[i, j] = np.nan
                else:
                    max_ps_i.append(valz_ij)
                    max_kPa_i.append(x_smooth[locz_ij])
                    inf_CAP_i.append(y_smooth[locz_ij])
                    self.max_ps_numeric[i, j] = valz_ij
                    self.max_kPa_numeric[i, j] = x_smooth[locz_ij]
                    self.inf_CAP_numeric[i, j] = y_smooth[locz_ij]

                # CAP at 5 kPa increments (5..45 kPa).
                cap_inc_ij = []
                for p in range(1, 10):
                    inc_mult = p * 5
                    idx = int(np.argmin(np.abs(x_smooth - inc_mult))) if x_smooth.size else -1
                    if idx >= 0 and np.abs(x_smooth[idx] - inc_mult) < 2.0:
                        cap_inc_ij.append(y_smooth[idx])
                    else:
                        cap_inc_ij.append(np.nan)
                cap_inc_i.append(cap_inc_ij)

                # Plot the P.S curve + derivative for this channel.
                ax = plt.subplot(2, 4, j + 1)
                ax.set_title(f"Run# {self.run_numbers[i]} - CH {j + 1}", fontsize=12, fontweight="bold")
                ax.plot(x_smooth, y_smooth, "-o", markersize=2, linewidth=1.5, color="tab:blue", label="CAP")
                if locz_ij is not None:
                    ax.plot(x_smooth[locz_ij], y_smooth[locz_ij], "or", markersize=10, linewidth=2, label="Inflection Point")
                ax.set_xlabel("Pressure (kPa)", fontsize=10)
                ax.set_ylabel("Change in CAP (pF)", fontsize=10, color="tab:blue")
                ax.tick_params(axis="y", labelcolor="tab:blue")

                ax2 = ax.twinx()
                ax2.plot(x_smooth[:-1], fir_dev_ij, color="tab:orange", linewidth=1.5, label="1st Derivative")
                if locz_ij is not None:
                    ax2.plot(x_smooth[locz_ij], fir_dev_ij[locz_ij], "ok", markersize=8, linewidth=2, label="Max Slope")
                ax2.set_ylabel("1st Derivative (pF/kPa)", fontsize=10, color="tab:orange")
                ax2.tick_params(axis="y", labelcolor="tab:orange")
                ax.grid(True, alpha=0.3)

            self.zaber_x.append(zaber_x_i)
            self.zaber_y.append(zaber_y_i)
            self.fir_dev.append(fir_dev_i)
            self.max_ps.append(max_ps_i)
            self.max_kPa.append(max_kPa_i)
            self.inf_CAP.append(inf_CAP_i)
            self.cap_inc.append(cap_inc_i)

            plt.tight_layout()
            ps_dir = self.path / "PS Curve"
            ps_dir.mkdir(parents=True, exist_ok=True)
            filename = ps_dir / f"PS curve all CHs number #{self.run_numbers[i]}.svg"
            rasterize_dense_lines(plt.gcf())
            plt.savefig(filename, format="svg", bbox_inches="tight")
            plt.close(fig)

    # -- overview figures ---------------------------------------------------

    def _plot_all_chs_across_runs(self):
        fig, axes = plt.subplots(1, self.cap_size, figsize=(8 * self.cap_size, 6))
        fig.suptitle("P.S Curves of All CHs Across Runs", fontsize=16, fontweight="bold")
        if self.cap_size == 1:
            axes = [axes]

        for i in range(self.cap_size):
            pressure = self.test[i][1][:, 1]
            k = self._first_above(pressure, self.start_force, 0)
            max_force_threshold = np.floor(np.max(self.test[0][1][:, 1]) - 1)
            f = self._first_above(pressure, max_force_threshold, len(pressure))
            for j in range(self.ch):
                x = self.test[i][1][k:f, 1]
                y = self.test[i][0][k:f, j + 1]
                st_pt = self._first_above(x, 0, 0)
                x_smooth = uniform_filter1d(x[st_pt:], size=100, mode="nearest")
                y_smooth = uniform_filter1d(y[st_pt:], size=100, mode="nearest")

                axes[i].plot(x_smooth, y_smooth, "-o", markersize=1.6, linewidth=2, label=f"Ch. #: {j + 1}")
                axes[i].set_title(f"Run {self.run_numbers[i]}", fontsize=14, fontweight="bold")
                axes[i].set_xlabel("Pressure (kPa)", fontsize=12)
                axes[i].set_ylabel("Change in CAP (pF)", fontsize=12)
                axes[i].grid(True, alpha=0.3)
                axes[i].legend(loc="lower right", fontsize=10)

        _share_axes(axes)  # one x/y scale across the run subplots so they compare directly
        plt.tight_layout()
        filename = self.path / "PS curves all ch per run.svg"
        rasterize_dense_lines(plt.gcf())
        plt.savefig(filename, format="svg", bbox_inches="tight")
        plt.close(fig)

    def _plot_all_runs_across_chs(self):
        fig, axes = plt.subplots(2, 4, figsize=(20, 10))
        fig.suptitle("P.S Curves of All Runs Across Channels", fontsize=18, fontweight="bold")
        axes = axes.flatten()

        num_runs = len(self.test)
        colors = plt.cm.tab10(np.linspace(0, 1, max(num_runs, 1)))
        for i in range(num_runs):
            for j in range(self.ch):
                axes[j].plot(self.zaber_x[i], self.zaber_y[i][j], "-o", markersize=1.4, linewidth=2.5,
                             color=colors[i], label=f"Run {self.run_numbers[i]}", alpha=0.8)
                axes[j].set_title(f"CH {j + 1}", fontsize=14, fontweight="bold")
                axes[j].set_xlabel("Pressure (kPa)", fontsize=11)
                axes[j].set_ylabel("Change in CAP (pF)", fontsize=11)
                axes[j].grid(True, alpha=0.3)

        for j in range(self.ch):
            axes[j].legend(loc="lower right", fontsize=10, framealpha=0.9)
        _share_axes(axes[:self.ch])  # one x/y scale across the channel subplots
        for j in range(self.ch, 8):
            axes[j].axis("off")

        plt.tight_layout()
        filename = self.path / "PS curves all run per CH.svg"
        rasterize_dense_lines(plt.gcf())
        plt.savefig(filename, format="svg", bbox_inches="tight")
        plt.close(fig)

    # -- browser plot payload ----------------------------------------------

    def plot_payload(self, max_points=3000):
        """
        Build a JSON-safe version of the computed curves so the web UI can render
        the same graphs the matplotlib figures show. Kept at a high point budget
        so the interactive plots preserve the fine structure (e.g. the noisy 1st
        derivative on the P.S curve) instead of looking over-smoothed.

          - per run, per channel: the smoothed P.S curve (pressure vs CAP), its
            1st derivative, and the inflection point  -> Pressure Sensitivity tab
            (mirrors "PS curve all CHs number #N")
          - per run: the synced raw signals (CAP vs time per channel, pressure
            vs time)                                  -> Raw Signals tab
          - the smoothed curves are reused for the All-Channels/All-Runs overlays.

        Arrays are downsampled to ~max_points to keep the payload small.
        """
        import math

        def _indices(n):
            if n <= max_points:
                return list(range(n))
            step = math.ceil(n / max_points)
            return list(range(0, n, step))

        def _clean(value, ndigits):
            v = float(value)
            return None if (v != v or v in (float("inf"), float("-inf"))) else round(v, ndigits)

        runs = []
        for i in range(self.cap_size):
            x = np.asarray(self.zaber_x[i], dtype=float)
            idx = _indices(len(x))
            pressure = [_clean(x[k], 4) for k in idx]

            channels = []
            for j in range(self.ch):
                y = np.asarray(self.zaber_y[i][j], dtype=float)
                cap = [_clean(y[k], 5) for k in idx]

                d = np.asarray(self.fir_dev[i][j], dtype=float)  # length len(x) - 1
                didx = [k for k in idx if k < len(d)]
                deriv_x = [_clean(x[k], 4) for k in didx]
                deriv = [_clean(d[k], 6) for k in didx]

                kpa = self.max_kPa_numeric[i, j]
                cap_inf = self.inf_CAP_numeric[i, j]
                ps = self.max_ps_numeric[i, j]
                infl = None
                if np.isfinite(kpa) and np.isfinite(cap_inf):
                    infl = {"kpa": round(float(kpa), 3), "cap": round(float(cap_inf), 5), "ps": round(float(ps), 5)}

                channels.append({"cap": cap, "deriv": deriv, "deriv_x": deriv_x, "infl": infl})

            # synced raw signals (test_cap: time + 8 CAP, test_fut: time + pressure)
            tc = np.asarray(self.test[i][0], dtype=float)
            tf = np.asarray(self.test[i][1], dtype=float)
            ridx = _indices(len(tc))
            raw_time = [_clean(tc[k, 0], 4) for k in ridx]
            raw_cap = [[_clean(tc[k, j + 1], 5) for k in ridx] for j in range(self.ch)]
            raw_pressure = [_clean(tf[k, 1], 3) for k in ridx if k < len(tf)]

            runs.append({
                "run": self.run_numbers[i],
                "pressure": pressure,
                "channels": channels,
                "raw": {"time": raw_time, "cap": raw_cap, "pressure": raw_pressure},
            })

        return {"channels": self.ch, "runs": runs}

    # -- results ------------------------------------------------------------

    def save_data(self):
        """Compute result statistics, persist them (pkl/xlsx/json), and return the dict."""
        result = {}

        # A channel that never produced a valid inflection is all-NaN, and a single
        # run gives ddof=1 std no degrees of freedom - both are expected and yield NaN
        # (handled downstream). Silence the benign RuntimeWarnings they raise.
        import warnings
        with warnings.catch_warnings(), np.errstate(divide="ignore", invalid="ignore"):
            warnings.simplefilter("ignore", RuntimeWarning)
            result["max_ps"] = self.max_ps_numeric
            result["mean_max_ps"] = np.nanmean(result["max_ps"], axis=0)
            result["std_max_ps"] = np.nanstd(result["max_ps"], axis=0, ddof=1)
            result["cov_max_ps"] = result["std_max_ps"] / result["mean_max_ps"]

            result["max_kpa"] = self.max_kPa_numeric
            result["mean_max_kpa"] = np.nanmean(result["max_kpa"], axis=0)
            result["std_max_kpa"] = np.nanstd(result["max_kpa"], ddof=1, axis=0)
            result["cov_max_kpa"] = result["std_max_kpa"] / result["mean_max_kpa"]

            result["max_cap"] = self.c
            result["mean_max_cap"] = np.mean(result["max_cap"], axis=0)
            result["std_max_cap"] = np.std(result["max_cap"], ddof=1, axis=0)
            result["max_cap_cov"] = result["std_max_cap"] / result["mean_max_cap"]

            result["inf_cap"] = self.inf_CAP_numeric
            result["mean_inf_cap"] = np.nanmean(result["inf_cap"], axis=0)
            result["std_inf_cap"] = np.nanstd(result["inf_cap"], ddof=1, axis=0)
            result["cov_inf_cap"] = result["std_inf_cap"] / result["mean_inf_cap"]

        # Channel variability across 9 incremental points (5 kPa steps).
        n_runs_dim = len(self.cap_inc)
        n_ch_dim = len(self.cap_inc[0]) if self.cap_inc else 0
        inc_arr = []
        ch_var_center4_mean = np.zeros((n_runs_dim, 9))
        ch_var_center4_std = np.zeros((n_runs_dim, 9))
        ch_var_outer4_mean = np.zeros((n_runs_dim, 9))
        ch_var_outer4_std = np.zeros((n_runs_dim, 9))
        ch_var_allch_mean = np.zeros((n_runs_dim, 9))
        ch_var_allch_std = np.zeros((n_runs_dim, 9))

        for a in range(n_runs_dim):
            run_data = [self.cap_inc[a][b] for b in range(n_ch_dim)]
            inc_arr.append(np.column_stack(run_data))
            for inc in range(9):
                ch_var_center4_mean[a, inc] = np.nanmean(inc_arr[a][inc, 2:6], axis=0)
                ch_var_center4_std[a, inc] = np.nanstd(inc_arr[a][inc, 2:6], ddof=1, axis=0)
                ch_var_outer4_mean[a, inc] = np.nanmean(inc_arr[a][inc, [0, 1, 6, 7]], axis=0)
                ch_var_outer4_std[a, inc] = np.nanstd(inc_arr[a][inc, [0, 1, 6, 7]], ddof=1, axis=0)
                ch_var_allch_mean[a, inc] = np.nanmean(inc_arr[a][inc, :], axis=0)
                ch_var_allch_std[a, inc] = np.nanstd(inc_arr[a][inc, :], ddof=1, axis=0)

        result["inc_arr"] = inc_arr
        result["ch_var_center4_mean"] = ch_var_center4_mean
        result["ch_var_center4_std"] = ch_var_center4_std
        result["ch_var_center4_cov"] = result["ch_var_center4_std"] / result["ch_var_center4_mean"]
        result["avg_ch_var_center4_mean"] = np.mean(result["ch_var_center4_mean"], axis=0)
        result["avg_ch_var_center4_cov"] = np.mean(result["ch_var_center4_cov"], axis=0)

        result["ch_var_outer4_mean"] = ch_var_outer4_mean
        result["ch_var_outer4_std"] = ch_var_outer4_std
        result["ch_var_outer4_cov"] = result["ch_var_outer4_std"] / result["ch_var_outer4_mean"]
        result["avg_ch_var_outer4_mean"] = np.mean(result["ch_var_outer4_mean"], axis=0)
        result["avg_ch_var_outer4_cov"] = np.mean(result["ch_var_outer4_cov"], axis=0)

        result["ch_var_allch_mean"] = ch_var_allch_mean
        result["ch_var_allch_std"] = ch_var_allch_std
        result["ch_var_allch_cov"] = result["ch_var_allch_std"] / result["ch_var_allch_mean"]
        result["avg_ch_var_allch_mean"] = np.mean(result["ch_var_allch_mean"], axis=0)
        result["avg_ch_var_allch_cov"] = np.mean(result["ch_var_allch_cov"], axis=0)

        result["shorted_ch"] = self.shorted_ch
        result["test"] = self.test
        result["zaber_x"] = self.zaber_x
        result["zaber_y"] = self.zaber_y

        # Persist: pickle (full result dict) + xlsx (one sheet per metric key).
        with open(self.path / "eb_analysis_results.pkl", "wb") as fh:
            pickle.dump(result, fh)

        self._pickle_to_excel(self.path / "eb_analysis_results.pkl", self.path / "EB_Analysis_Results.xlsx")

        return result

    @staticmethod
    def _pickle_to_excel(pkl_path, xlsx_path):
        with open(pkl_path, "rb") as fh:
            data = pickle.load(fh)
        with pd.ExcelWriter(xlsx_path) as writer:
            for key, val in data.items():
                sheet_base = str(key)[:31]
                try:
                    if isinstance(val, np.ndarray):
                        pd.DataFrame(val).to_excel(writer, sheet_name=sheet_base, index=False)
                    elif isinstance(val, list):
                        try:
                            pd.DataFrame(val).to_excel(writer, sheet_name=sheet_base, index=False)
                        except Exception:
                            for idx, elem in enumerate(val):
                                run_no = self.run_numbers[idx] if idx < len(self.run_numbers) else idx + 1
                                sheet = f"{sheet_base}_run{run_no}"[:31]
                                try:
                                    pd.DataFrame(elem).to_excel(writer, sheet_name=sheet, index=False)
                                except Exception:
                                    pd.DataFrame([repr(elem)]).to_excel(writer, sheet_name=sheet, index=False)
                    else:
                        pd.DataFrame([repr(val)]).to_excel(writer, sheet_name=sheet_base, index=False)
                except Exception:
                    pd.DataFrame([repr(val)]).to_excel(writer, sheet_name=sheet_base, index=False)


def _to_jsonable(value):
    # convert numpy scalars/arrays (and nested lists of them) into plain JSON types,
    # turning NaN/inf into None so the result is valid JSON.
    if isinstance(value, np.ndarray):
        return _to_jsonable(value.tolist())
    if isinstance(value, (np.floating, float)):
        v = float(value)
        return None if (v != v or v in (float("inf"), float("-inf"))) else v
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    return value


def run_em_analysis(test_folder, sensor_id, sensor_type="Standard", surface_area_mm2=325.0, active_runs=None, progress=None):
    """
    Convenience entry point: run the full pipeline, persist outputs, and return a
    summary dict the web app can consume.

    Returns a dict with:
        channel_stats: list of per-channel {channel, ps, kpa, cap, inf} stat blocks
        shorted_channels: list of 1-based shorted channel numbers
        runs: number of runs analysed
        result: the JSON-safe full result dictionary

    progress: optional callable(frac, message) reporting 0..1 pipeline progress.
    """
    report = progress if callable(progress) else (lambda frac, message="": None)
    analyzer = EMAnalysis(test_folder, sensor_id, sensor_type, surface_area_mm2,
                          active_runs=active_runs, progress=progress)
    report(0.93, "Saving results…")
    result = analyzer.save_data()
    report(0.98, "Packaging plot data…")

    def _col(name):
        return np.asarray(result[name], dtype=float)

    max_ps = _col("max_ps")        # shape (runs, ch)
    max_kpa = _col("max_kpa")
    max_cap = _col("max_cap")
    inf_cap = _col("inf_cap")

    def _stat_block(matrix, channel):
        column = matrix[:, channel]
        finite = column[np.isfinite(column)]
        if finite.size == 0:
            return {"mean": 0.0, "std": 0.0, "cov": 0.0, "min": 0.0, "max": 0.0}
        mean = float(np.mean(finite))
        std = float(np.std(finite, ddof=1)) if finite.size > 1 else 0.0
        cov = (std / abs(mean) * 100) if abs(mean) > 1e-9 else 0.0
        return {"mean": mean, "std": std, "cov": cov, "min": float(np.min(finite)), "max": float(np.max(finite))}

    channel_stats = []
    for channel in range(analyzer.ch):
        channel_stats.append({
            "channel": channel + 1,
            "ps": _stat_block(max_ps, channel),
            "kpa": _stat_block(max_kpa, channel),
            "cap": _stat_block(max_cap, channel),
            "inf": _stat_block(inf_cap, channel),
        })

    shorted = analyzer.shorted_ch
    shorted_channels = [int(c) + 1 for c in (shorted if shorted is not None else [])]

    json_safe_result = {key: _to_jsonable(value) for key, value in result.items()}

    return {
        "channel_stats": channel_stats,
        "shorted_channels": shorted_channels,
        "runs": analyzer.cap_size,
        "plots": analyzer.plot_payload(),
        "result": json_safe_result,
    }
