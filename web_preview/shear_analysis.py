# Shear analysis — matplotlib figure + shorted-channel detection.
#
# Adapted from emilio's ShearAnalysis (zaber-python shear_analysis.py) to the web
# app's saved-file layout:
#   - CAP csv:  time in column 0, CH1..CH8 in columns 5..12 (v = 5).
#   - FUT file: load cell (N) in column 1, time (s) in column 2 (csv or xlsx).
#
# Outputs written into the test folder:
#   - "Raw Fig_ Shearing.png"  : 9 stacked subplots — each channel's raw CAP (blue,
#                                left axis) + ΔCAP (orange, right axis), and the
#                                load-cell force (green) along the bottom.
#   - "SHEAR_RESULT.xlsx"       : negative-CAP and ΔCAP>10 pF sheets + metadata.
#
# Shorted-channel rule (same as the reference): a channel is flagged if it shows
# negative capacitance or a ΔCAP greater than 10 pF.
import re
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")  # headless: render to file, never open a window
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

from plot_style import apply_plot_style, rasterize_dense_lines

apply_plot_style()  # high-quality, crisp-text SVG styling for all figures

CH = 8   # channels per sensor
V = 5    # first capacitance column (cap1 at index 5)


def _run_sort_key(path):
    match = re.search(r"(\d+)", path.stem)
    return int(match.group(1)) if match else 0


def _fut_force_time(fut_df):
    # Force is column 1 in every FUT layout. Time is column 3 ("Time Elapsed") in
    # the real FUTEK "Live Graph" export (4 cols: Sample, Tracking Value, Date,
    # Time Elapsed), and column 2 in our generated 3-column files. Handle numeric
    # elapsed-seconds or a datetime column either way.
    force = pd.to_numeric(fut_df.iloc[:, 1], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    time_idx = 3 if fut_df.shape[1] >= 4 else 2
    col = fut_df.iloc[:, time_idx]
    if pd.api.types.is_datetime64_any_dtype(col):
        time = col.diff().dt.total_seconds().fillna(0.0).cumsum().to_numpy(dtype=float)
    else:
        time = pd.to_numeric(col, errors="coerce").to_numpy(dtype=float)
        time = np.nan_to_num(time)
        if len(time):
            time = time - time[0]  # zero-base
    return force, time


class ShearAnalysis:
    def __init__(self, test_folder, sensor_id):
        self.sensor_id = sensor_id
        self.path = Path(test_folder)
        self.cap_path = self.path / "CAP"
        self.fut_path = self.path / "FUT"
        self.ch = CH
        self.v = V

        self.csv_files = sorted(self.cap_path.glob("*.csv"), key=_run_sort_key)
        self.fut_files = sorted(
            list(self.fut_path.glob("*.xlsx")) + list(self.fut_path.glob("*.csv")),
            key=_run_sort_key,
        )

        self.cap_data = [pd.read_csv(f) for f in self.csv_files]
        self.fut_data = [
            pd.read_excel(f) if f.suffix.lower() == ".xlsx" else pd.read_csv(f)
            for f in self.fut_files
        ]

    # -- raw CAP + force figure --------------------------------------------

    def plot_cap_and_force(self):
        fig = plt.figure(figsize=(19.2, 10.8))

        axes = []
        for ch_idx in range(self.ch):
            ax = plt.subplot(9, 1, ch_idx + 1, sharex=axes[0] if axes else None)
            axes.append(ax)
            ax.set_ylabel("CAP (pF)", color="tab:blue")
            ax.tick_params(axis="y", labelcolor="tab:blue")
            ax.set_title(f"CH {ch_idx + 1}", fontsize=10, fontweight="bold")
            ax.grid(True, alpha=0.3)
            if ch_idx < self.ch - 1:
                ax.tick_params(labelbottom=False)

        ax_force = plt.subplot(9, 1, 9, sharex=axes[0])
        ax_force.set_ylabel("Force (N)")
        ax_force.set_xlabel("Time (s)")
        ax_force.grid(True, alpha=0.3)
        ax_force.xaxis.set_major_locator(ticker.AutoLocator())

        twin_axes = []
        for ch_idx in range(self.ch):
            ax_r = axes[ch_idx].twinx()
            ax_r.set_ylabel("ΔCAP (pF)", color="tab:orange")
            ax_r.tick_params(axis="y", labelcolor="tab:orange")
            ax_r.patch.set_visible(False)  # keep the left-axis lines visible
            axes[ch_idx].set_zorder(0)
            ax_r.set_zorder(1)
            twin_axes.append(ax_r)

        for file_idx in range(len(self.cap_data)):
            cap_df = self.cap_data[file_idx]
            cap_time = cap_df.iloc[:, 0].values.astype(float)

            for ch_idx in range(self.ch):
                cap_values = cap_df.iloc[:, ch_idx + self.v].values.astype(float)
                initial_cap = cap_values[2] if len(cap_values) > 2 else cap_values[0]
                delta_cap = cap_values - initial_cap

                axes[ch_idx].plot(cap_time, cap_values, color="tab:blue", alpha=0.7)
                twin_axes[ch_idx].plot(cap_time, delta_cap, color="tab:orange", alpha=0.7)

                # widen the right axis to include the new ΔCAP with a margin.
                y_min, y_max = float(np.min(delta_cap)), float(np.max(delta_cap))
                span = (y_max - y_min) or 1.0
                margin = span * 0.2
                cur = twin_axes[ch_idx].get_ylim()
                twin_axes[ch_idx].set_ylim(min(cur[0], y_min - margin), max(cur[1], y_max + margin))

            fut_df = self.fut_data[file_idx] if file_idx < len(self.fut_data) else None
            if fut_df is not None and fut_df.shape[1] >= 3:
                force_values, time_values = _fut_force_time(fut_df)
                n = min(len(time_values), len(force_values))
                ax_force.plot(time_values[:n], force_values[:n], "g-", linewidth=1.5, alpha=0.7)

        plt.tight_layout()
        output_path = self.path / "Shear_Failure_Check.svg"
        rasterize_dense_lines(fig)
        plt.savefig(output_path, format="svg", bbox_inches="tight")
        plt.close(fig)
        return output_path

    # -- shorted-channel detection -----------------------------------------

    def analyze_shorted_channels(self):
        negative = {ch: [] for ch in range(1, self.ch + 1)}
        delta_over = {ch: [] for ch in range(1, self.ch + 1)}

        for cap_df in self.cap_data:
            for ch_idx in range(self.ch):
                ch_num = ch_idx + 1
                cap_values = cap_df.iloc[:, ch_idx + self.v].values.astype(float)
                delta_cap = cap_values - cap_values[0]

                negative[ch_num].extend(cap_values[cap_values < 0].tolist())
                delta_over[ch_num].extend(delta_cap[delta_cap > 10].tolist())

        self._save_results(negative, delta_over)
        return negative, delta_over

    def _save_results(self, negative, delta_over):
        # pickle archive of the raw detection result (matches diagram layout).
        import pickle
        shear_result = {
            "shorted_ch_neg": {ch: list(map(float, v)) for ch, v in negative.items()},
            "shorted_ch_delt_CAP": {ch: list(map(float, v)) for ch, v in delta_over.items()},
            "sensor_id": self.sensor_id,
            "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(self.path / "shear_analysis_results.pkl", "wb") as fh:
            pickle.dump(shear_result, fh)

        output_file = self.path / "Shear_Analysis_Results.xlsx"
        with pd.ExcelWriter(output_file, engine="xlsxwriter") as writer:
            neg_rows = [{"Channel": ch, "Capacitance (pF)": v} for ch, vals in negative.items() for v in vals]
            pd.DataFrame(neg_rows or [{"Channel": "", "Capacitance (pF)": ""}]).to_excel(
                writer, sheet_name="Negative_CAP", index=False)

            delta_rows = [{"Channel": ch, "Delta CAP (pF)": v} for ch, vals in delta_over.items() for v in vals]
            pd.DataFrame(delta_rows or [{"Channel": "", "Delta CAP (pF)": ""}]).to_excel(
                writer, sheet_name="Delta_CAP_gt_10pF", index=False)

            pd.DataFrame({
                "Sensor ID": [self.sensor_id],
                "Analysis Date": [datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
            }).to_excel(writer, sheet_name="Metadata", index=False)


def run_shear_analysis(test_folder, sensor_id):
    """
    Run the real shear pipeline. Returns a JSON-safe summary dict, or raises if
    the data/format is unusable (the caller falls back to the preview analysis).
    """
    analyzer = ShearAnalysis(test_folder, sensor_id)
    if not analyzer.cap_data:
        raise ValueError("no CAP files found for shear analysis")

    image_path = analyzer.plot_cap_and_force()
    negative, delta_over = analyzer.analyze_shorted_channels()

    detection = []
    failed_channels = []
    for ch in range(1, CH + 1):
        neg_count = len(negative[ch])
        delta_count = len(delta_over[ch])
        is_failed = neg_count > 0 or delta_count > 0
        if is_failed:
            failed_channels.append(ch)
        detection.append({
            "channel": ch,
            "negative_count": neg_count,
            "delta_over_count": delta_count,
            "max_delta": round(max(delta_over[ch]), 4) if delta_over[ch] else 0.0,
            "min_cap": round(min(negative[ch]), 4) if negative[ch] else None,
            "failed": is_failed,
        })

    return {
        "image_path": str(image_path),
        "result_workbook": str(analyzer.path / "Shear_Analysis_Results.xlsx"),
        "result_pickle": str(analyzer.path / "shear_analysis_results.pkl"),
        "detection": detection,
        "failed_channels": failed_channels,
        "result": "FAIL" if failed_channels else "PASS",
        "runs": len(analyzer.cap_data),
    }
