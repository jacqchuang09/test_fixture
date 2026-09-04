# Manual analysis - matplotlib figures for a single manual test run.
#
# A manual run is a list of recorded points {time, force, capacitance}. This
# produces the same three views the app shows, styled to match the EM/Shear
# matplotlib output:
#   - "Manual_Cap_vs_Force.png"  : capacitance vs force
#   - "Manual_Force_vs_Time.png" : force vs time
#   - "Manual_Cap_vs_Time.png"   : capacitance vs time
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")  # headless rendering to file
import matplotlib.pyplot as plt

from plot_style import apply_plot_style, rasterize_dense_lines

apply_plot_style()  # high-quality, crisp-text SVG styling for all figures


def _line_plot(x, y, title, x_label, y_label, color, output_path):
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(x, y, "-o", markersize=3, linewidth=1.6, color=color, alpha=0.9)
    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel(x_label, fontsize=12)
    ax.set_ylabel(y_label, fontsize=12)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    rasterize_dense_lines(fig)
    fig.savefig(output_path, format="svg", bbox_inches="tight")
    plt.close(fig)
    return output_path


def run_manual_analysis(points, test_folder, sensor_id):
    """
    Render the three manual figures from recorded points. Returns a JSON-safe
    summary with the image paths, or raises if there is nothing to plot.
    """
    path = Path(test_folder)
    if not points:
        raise ValueError("no manual points to plot")

    time = np.array([float(p.get("time", 0.0)) for p in points], dtype=float)
    force = np.array([float(p.get("force", 0.0)) for p in points], dtype=float)
    cap = np.array([float(p.get("capacitance", 0.0)) for p in points], dtype=float)

    cap_vs_force = _line_plot(
        force, cap, "Capacitance vs Force", "Force (N)", "Capacitance (pF)",
        "tab:blue", path / "Manual_Cap_vs_Force.svg")
    force_vs_time = _line_plot(
        time, force, "Force vs Time", "Time (s)", "Force (N)",
        "tab:green", path / "Manual_Force_vs_Time.svg")
    cap_vs_time = _line_plot(
        time, cap, "Capacitance vs Time", "Time (s)", "Capacitance (pF)",
        "tab:orange", path / "Manual_Cap_vs_Time.svg")

    # results: pickle (full point record) + xlsx (one row per recorded sample).
    table = pd.DataFrame({"Time (s)": time, "Force (N)": force, "Capacitance (pF)": cap})
    workbook = path / "Manual_Analysis_Results.xlsx"
    table.to_excel(workbook, index=False)
    pkl = path / "manual_analysis_results.pkl"
    with open(pkl, "wb") as fh:
        pickle.dump({"sensor_id": sensor_id, "points": points,
                     "time": time.tolist(), "force": force.tolist(), "capacitance": cap.tolist()}, fh)

    return {
        "images": {
            "cap_vs_force": str(cap_vs_force),
            "force_vs_time": str(force_vs_time),
            "cap_vs_time": str(cap_vs_time),
        },
        "result_workbook": str(workbook),
        "result_pickle": str(pkl),
        "point_count": len(points),
    }
