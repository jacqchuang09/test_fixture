#!/usr/bin/env python3
"""
Zaber square-wave characterization.

Drives the actuator in a square-wave position oscillation across a sweep of
frequencies and records COMMANDED vs ACHIEVED position. This shows, for your
build, how fast the Zaber can actually move and how badly a square wave rounds
off (and how far the extrusion distance falls short) as the frequency rises -
i.e. the real curve behind the fatigue "too fast to track" warning.

Run on the rig (do it in free travel, with nothing in the actuator's way):
    python3 tools/zaber_square_wave_characterization.py --port COM3

Preview the output shape with no hardware (a slew-rate model, not a measurement):
    python3 tools/zaber_square_wave_characterization.py --sim

Outputs land in ./zaber_characterization/ :
    data_<freq>Hz.csv            commanded vs achieved position per frequency
    summary.csv                  frequency, amplitude fidelity, edge lag, RMS error
    overlay.svg                  commanded vs achieved, small multiples per frequency
    characterization_curve.svg   amplitude fidelity and lag vs frequency
"""
import argparse
import csv
import math
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---- parameters (edit for your setup) -------------------------------------
CENTER_MM = 25.0           # midpoint of the oscillation (inside 17-50.8 mm travel)
AMPLITUDE_MM = 1.0         # commanded half-swing of the square wave (mm)
FREQUENCIES_HZ = [0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0]   # the sweep
CYCLES = 6                 # cycles to run at each frequency
SAMPLE_HZ = 200            # position-logging rate
SETTLE_S = 0.4             # pause between frequencies
# Travel bounds the sweep must stay inside. 17 mm is home; 34 mm is the max
# extrusion this fixture allows (NOT the 50.8 mm datasheet travel) - the square
# wave is clamped so the actuator never commands past it.
TRAVEL_MIN_MM, TRAVEL_MAX_MM, MARGIN_MM = 17.0, 34.0, 0.5
MAX_SPEED_MM_S = 25.0      # datasheet max speed (used only by the --sim model)
OUT_DIR = Path("zaber_characterization")


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def square_target(t, freq):
    """Commanded square wave: high for the first half of each period, else low."""
    hi = _clamp(CENTER_MM + AMPLITUDE_MM, TRAVEL_MIN_MM + MARGIN_MM, TRAVEL_MAX_MM - MARGIN_MM)
    lo = _clamp(CENTER_MM - AMPLITUDE_MM, TRAVEL_MIN_MM + MARGIN_MM, TRAVEL_MAX_MM - MARGIN_MM)
    return hi if (t * freq) % 1.0 < 0.5 else lo


# ---- real hardware drive ---------------------------------------------------
def run_frequency_hw(axis, units, freq):
    dt = 1.0 / SAMPLE_HZ
    duration = CYCLES / freq
    axis.move_absolute(square_target(0.0, freq), units, wait_until_idle=True)
    records, last_cmd, t0 = [], None, time.perf_counter()
    while True:
        t = time.perf_counter() - t0
        if t >= duration:
            break
        cmd = square_target(t, freq)
        if cmd != last_cmd:
            try:
                axis.move_absolute(cmd, units, wait_until_idle=False)
            except Exception:
                pass
            last_cmd = cmd
        try:
            actual = axis.get_position(units)
        except Exception:
            actual = float("nan")
        records.append((t, cmd, actual))
        sleep = dt - ((time.perf_counter() - t0) - t)
        if sleep > 0:
            time.sleep(sleep)
    return records


# ---- no-hardware slew-rate model (for previewing the output) ---------------
def run_frequency_sim(freq):
    dt = 1.0 / SAMPLE_HZ
    duration = CYCLES / freq
    n = int(duration / dt)
    actual = square_target(0.0, freq)
    step_cap = MAX_SPEED_MM_S * dt  # the most the stage can move per sample
    records = []
    for i in range(n):
        t = i * dt
        cmd = square_target(t, freq)
        # move toward the command, but no faster than the actuator can go.
        delta = cmd - actual
        actual += math.copysign(min(abs(delta), step_cap), delta)
        records.append((t, cmd, actual))
    return records


# ---- metrics ---------------------------------------------------------------
def metrics(records, freq):
    # use the second half (steady state) and skip the leading transient.
    steady = records[len(records) // 2:]
    if not steady:
        return {"freq": freq, "fidelity": 0.0, "lag_ms": float("nan"), "rms_pct": float("nan")}
    cmd = [r[1] for r in steady]
    act = [r[2] for r in steady if not math.isnan(r[2])]
    if not act:
        return {"freq": freq, "fidelity": 0.0, "lag_ms": float("nan"), "rms_pct": float("nan")}
    achieved_amp = (max(act) - min(act)) / 2.0
    fidelity = _clamp(achieved_amp / AMPLITUDE_MM, 0.0, 1.0)
    rms = math.sqrt(sum((c - a) ** 2 for c, a in zip(cmd, act)) / len(act))
    rms_pct = 100.0 * rms / AMPLITUDE_MM
    # edge lag: average time for the achieved trace to cross the midpoint after a
    # commanded edge, over the steady window.
    mid = CENTER_MM
    lags, last_edge_t, last_cmd = [], None, cmd[0]
    t0 = steady[0][0]
    for (t, c, a) in steady:
        if c != last_cmd:
            last_edge_t, last_cmd = t, c
        if last_edge_t is not None and not math.isnan(a):
            # first crossing of the midpoint toward the new command after an edge
            pass
    # simpler, robust lag: cross-correlate commanded vs achieved.
    lag_ms = _xcorr_lag_ms(cmd, act, 1.0 / SAMPLE_HZ)
    return {"freq": freq, "fidelity": fidelity, "lag_ms": lag_ms, "rms_pct": rms_pct}


def _xcorr_lag_ms(cmd, act, dt):
    # shift the achieved trace back by k samples to best match the command;
    # the best k (in ms) is the tracking lag.
    n = min(len(cmd), len(act))
    cmd, act = cmd[:n], act[:n]
    cm = sum(cmd) / n
    am = sum(act) / n
    best_k, best_score = 0, -1e18
    max_shift = min(n - 1, int(0.5 * SAMPLE_HZ))  # search up to 0.5 s
    for k in range(0, max_shift + 1):
        score = sum((cmd[i] - cm) * (act[i + k] - am) for i in range(n - k))
        if score > best_score:
            best_score, best_k = score, k
    return best_k * dt * 1000.0


# ---- plots -----------------------------------------------------------------
def plot_overlay(all_data):
    freqs = sorted(all_data)
    cols = min(3, len(freqs))
    rows = math.ceil(len(freqs) / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(5 * cols, 3.2 * rows), squeeze=False)
    for idx, freq in enumerate(freqs):
        ax = axes[idx // cols][idx % cols]
        recs = all_data[freq]
        t = [r[0] for r in recs]
        ax.plot(t, [r[1] for r in recs], color="#2f6fe0", lw=1.6, label="commanded")
        ax.plot(t, [r[2] for r in recs], color="#ed6c02", lw=1.6, label="achieved")
        ax.set_title(f"{freq:g} Hz", fontweight="bold")
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("Position (mm)")
        ax.grid(True, alpha=0.3)
        if idx == 0:
            ax.legend(loc="upper right", fontsize=8)
    for j in range(len(freqs), rows * cols):
        axes[j // cols][j % cols].axis("off")
    fig.suptitle("Commanded vs achieved square wave", fontsize=14, fontweight="bold")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "overlay.svg", format="svg", bbox_inches="tight")
    plt.close(fig)


def plot_curve(summary):
    freqs = [s["freq"] for s in summary]
    fig, ax1 = plt.subplots(figsize=(9, 5))
    ax1.plot(freqs, [100 * s["fidelity"] for s in summary], "-o", color="#2f6fe0", label="amplitude fidelity")
    ax1.set_xlabel("Square-wave frequency (Hz)")
    ax1.set_ylabel("Amplitude fidelity (%)", color="#2f6fe0")
    ax1.tick_params(axis="y", labelcolor="#2f6fe0")
    ax1.set_ylim(0, 105)
    ax1.grid(True, alpha=0.3)
    ax2 = ax1.twinx()
    ax2.plot(freqs, [s["lag_ms"] for s in summary], "-s", color="#ed6c02", label="edge lag")
    ax2.set_ylabel("Tracking lag (ms)", color="#ed6c02")
    ax2.tick_params(axis="y", labelcolor="#ed6c02")
    fig.suptitle(f"Zaber square-wave fidelity vs frequency  (center {CENTER_MM:g} mm, +/-{AMPLITUDE_MM:g} mm)",
                 fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "characterization_curve.svg", format="svg", bbox_inches="tight")
    plt.close(fig)


# ---- main ------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Zaber square-wave characterization sweep.")
    ap.add_argument("--port", help="serial port of the Zaber (e.g. COM3, /dev/tty.usbserial-XXX)")
    ap.add_argument("--sim", action="store_true", help="no hardware: use a slew-rate model to preview the output")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    axis = units = None
    if not args.sim:
        if not args.port:
            ap.error("give --port for a hardware run, or --sim to preview without hardware")
        from zaber_motion import Units
        from zaber_motion.ascii import Connection
        units = Units.LENGTH_MILLIMETRES
        conn = Connection.open_serial_port(args.port)
        device = conn.detect_devices()[0]
        axis = device.get_axis(1)
        if axis.is_parked():
            axis.unpark()

    all_data, summary = {}, []
    try:
        for freq in FREQUENCIES_HZ:
            print(f"[characterize] {freq:g} Hz ...")
            recs = run_frequency_sim(freq) if args.sim else run_frequency_hw(axis, units, freq)
            all_data[freq] = recs
            with open(OUT_DIR / f"data_{freq:g}Hz.csv", "w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["time_s", "commanded_mm", "achieved_mm"])
                w.writerows(recs)
            summary.append(metrics(recs, freq))
            if not args.sim:
                time.sleep(SETTLE_S)
    finally:
        if axis is not None:
            try:
                axis.move_absolute(CENTER_MM, units, wait_until_idle=True)
                axis.park()
            except Exception:
                pass

    with open(OUT_DIR / "summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["frequency_hz", "amplitude_fidelity_pct", "tracking_lag_ms", "rms_error_pct"])
        for s in summary:
            w.writerow([s["freq"], round(100 * s["fidelity"], 1), round(s["lag_ms"], 1), round(s["rms_pct"], 1)])

    plot_overlay(all_data)
    plot_curve(summary)
    print("\nSummary (frequency -> amplitude fidelity, lag):")
    for s in summary:
        print(f"  {s['freq']:>4g} Hz   fidelity {100*s['fidelity']:5.1f}%   lag {s['lag_ms']:5.1f} ms")
    print(f"\nWrote results and plots to {OUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
