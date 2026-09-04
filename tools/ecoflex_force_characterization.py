#!/usr/bin/env python3
"""
Force-waveform square-wave characterization on a loaded sample (e.g. an Ecoflex block).

Sibling to tools/zaber_square_wave_characterization.py. That tool measures the
bare actuator's COMMANDED-vs-ACHIEVED POSITION in free travel. This one is the
LOADED case: with a sample under the actuator, it looks at the FORCE waveform and
asks "did the force square wave actually stay square, or did it round into a
triangle / fail to reach the force bounds?" — per frequency.

Why a soft sample matters: to swing from the lower to the upper force, the rod
has to travel  D = (force band) / (sample stiffness)  millimetres. A soft block
(Ecoflex) needs a LOT of travel per press, so at a given actuator speed the force
square rounds off — and then clips — at a much lower frequency than a stiff
sample. So Ecoflex is the worst-case the limit should be sized against.

TWO ways to feed it data:

  Real testing (recommended):
    Run the app's Fatigue test on the Ecoflex block at each frequency, then point
    this tool at the saved force-vs-time files:
        python3 tools/ecoflex_force_characterization.py --data path/to/folder \
            --lower 1 --upper 20
    It accepts the rig's "Index, Load Cell, Time, Cycle" .xlsx, or any .csv with a
    time column and a force column. One file per frequency; put the frequency in
    the filename (e.g. data_2Hz.csv, Fatigue_2hz.xlsx).

  No hardware (preview / test the tool):
    Model the loaded square wave with a slew-rate actuator + a stiffening contact
    spring (the same spring the app's simulation uses), for an Ecoflex-soft sample:
        python3 tools/ecoflex_force_characterization.py --sim

Outputs land in ./ecoflex_characterization/ :
    data_<freq>Hz.csv            time, commanded force, achieved force  (sim only)
    force_overlay.svg            commanded vs achieved force, per frequency
    force_fidelity_curve.svg     squareness % and amplitude fidelity % vs frequency
    summary.csv                  per-frequency metrics + the empirical max-square freq
"""
import argparse
import csv
import math
import re
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---- defaults (override on the command line) -------------------------------
LOWER_N, UPPER_N = 1.0, 20.0          # force bounds of the fatigue square wave
FREQS_HZ = [0.5, 1.0, 2.0, 3.0, 5.0, 8.0]
CYCLES = 6
SAMPLE_HZ = 200
# Effective force-tracking slew speed during a real run. The fatigue loop drives
# move_absolute at the Zaber's maxspeed setting; confirm yours from the startup log
# line "Zaber default move speed (maxspeed): X mm/s".
SPEED_MM_S = 5.0
# Contact stiffness of the loaded sample (N per mm of compression). The app's
# simulated spring uses 9.0 for a generic foam/silicone; a real Ecoflex block is
# softer. This is the ONE number to pin down from a characterization press —
# replace it with the measured value (or feed real --data and it doesn't matter).
STIFFNESS_N_MM = 9.0
SQUARE_FLAT_THRESHOLD = 0.50          # >= this fraction flat -> counts as "square"
OUT_DIR = Path("ecoflex_characterization")


# ---- contact-spring model (matches run_engine.py's simulation) -------------
def spring_force(depth_mm, k):
    p = max(0.0, depth_mm)
    return k * p * (1.0 + 0.06 * p)


def inverse_press(force_n, k):
    if force_n <= 0:
        return 0.0
    a = 0.06 * k
    return (-k + math.sqrt(k * k + 4.0 * a * force_n)) / (2.0 * a)


def square_phase(t, freq):
    return (t * freq) % 1.0 < 0.5      # True -> upper half of the cycle


# ---- no-hardware model: slew-limited rod pressing a soft spring -------------
def simulate_force(freq, lower, upper, speed, k):
    dt = 1.0 / SAMPLE_HZ
    duration = CYCLES / freq
    n = int(duration / dt)
    depth_lo, depth_hi = inverse_press(lower, k), inverse_press(upper, k)
    depth = depth_lo
    step_cap = speed * dt              # most the rod can move per sample
    recs = []
    for i in range(n):
        t = i * dt
        cmd_depth = depth_hi if square_phase(t, freq) else depth_lo
        delta = cmd_depth - depth
        depth += math.copysign(min(abs(delta), step_cap), delta)
        cmd_force = upper if square_phase(t, freq) else lower
        recs.append((t, cmd_force, spring_force(depth, k)))
    return recs


# ---- real data: load the rig's force-vs-time files -------------------------
def load_force_file(path, lower, upper):
    """Return [(t, commanded_force, achieved_force)] from a rig fatigue file."""
    rows = _read_rows(path)
    # find a time column and a force column by header name
    hdr = {h.lower(): i for i, h in enumerate(rows[0])}
    ti = _pick(hdr, ["time", "time_s", "t"])
    fi = _pick(hdr, ["load cell", "force", "force_n", "achieved_force", "load_cell"])
    if ti is None or fi is None:
        raise ValueError(f"{path.name}: need a time column and a force column; got {rows[0]}")
    out = []
    for r in rows[1:]:
        try:
            t, f = float(r[ti]), float(r[fi])
        except (ValueError, IndexError):
            continue
        out.append((t, None, f))      # commanded reconstructed below
    if not out:
        raise ValueError(f"{path.name}: no numeric rows")
    return out


def _read_rows(path):
    if path.suffix.lower() in (".xlsx", ".xls"):
        import pandas as pd
        df = pd.read_excel(path)
        return [list(df.columns)] + df.astype(object).values.tolist()
    with open(path, newline="") as f:
        return [row for row in csv.reader(f) if row]


def _pick(hdr, names):
    for n in names:
        if n in hdr:
            return hdr[n]
    return None


def _freq_from_name(name):
    m = re.search(r"([0-9]*\.?[0-9]+)\s*hz", name.lower())
    return float(m.group(1)) if m else None


# ---- metrics: how square is the FORCE waveform -----------------------------
def metrics(recs, freq, lower, upper):
    steady = recs[len(recs) // 2:]    # drop the leading transient
    forces = [r[2] for r in steady if r[2] is not None]
    if not forces:
        return None
    band = max(1e-6, upper - lower)
    tol = 0.10 * band                 # "at a bound" = within 10% of the band
    lo_seen = _pct(forces, 5)
    hi_seen = _pct(forces, 95)
    amp_fidelity = _clamp((hi_seen - lo_seen) / band, 0.0, 1.0)
    reaches = (hi_seen >= upper - tol) and (lo_seen <= lower + tol)
    # squareness: a real square dwells at BOTH bounds. Take the time spent near the
    # upper bound and near the lower bound separately; the weaker of the two governs
    # (a wave stuck near one bound is not square). x2 so a clean 50/50 square -> 1.0.
    flat_hi = sum(1 for f in forces if f >= upper - tol) / len(forces)
    flat_lo = sum(1 for f in forces if f <= lower + tol) / len(forces)
    flat = min(1.0, 2.0 * min(flat_hi, flat_lo))
    return {
        "freq": freq, "amp_fidelity": amp_fidelity, "flat": flat,
        "reaches": reaches, "lo_seen": lo_seen, "hi_seen": hi_seen,
        "square": flat >= SQUARE_FLAT_THRESHOLD and reaches,
    }


def _pct(xs, p):
    s = sorted(xs)
    k = _clamp(int(round((p / 100.0) * (len(s) - 1))), 0, len(s) - 1)
    return s[k]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---- plots -----------------------------------------------------------------
def plot_overlay(all_data, lower, upper):
    freqs = sorted(all_data)
    cols = min(3, len(freqs))
    rows = math.ceil(len(freqs) / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(5 * cols, 3.2 * rows), squeeze=False)
    for idx, freq in enumerate(freqs):
        ax = axes[idx // cols][idx % cols]
        recs = all_data[freq]
        t = [r[0] for r in recs]
        cmd = [r[1] for r in recs]
        if any(c is None for c in cmd):    # real data: rebuild the commanded square
            cmd = [upper if square_phase(tt, freq) else lower for tt in t]
        ax.plot(t, cmd, color="#888", lw=1.2, ls="--", label="commanded square")
        ax.plot(t, [r[2] for r in recs], color="#2f6fe0", lw=1.8, label="achieved force")
        ax.axhline(upper, color="#2e7d32", lw=0.6, ls=":")
        ax.axhline(lower, color="#2e7d32", lw=0.6, ls=":")
        ax.set_title(f"{freq:g} Hz", fontweight="bold")
        ax.set_xlabel("Time (s)"); ax.set_ylabel("Force (N)")
        ax.grid(True, alpha=0.3)
        if idx == 0:
            ax.legend(loc="upper right", fontsize=8)
    for j in range(len(freqs), rows * cols):
        axes[j // cols][j % cols].axis("off")
    fig.suptitle("Force square wave: commanded vs achieved (loaded sample)", fontsize=14, fontweight="bold")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "force_overlay.svg", format="svg", bbox_inches="tight")
    plt.close(fig)


def plot_curve(summary, max_square):
    freqs = [s["freq"] for s in summary]
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(freqs, [100 * s["flat"] for s in summary], "-o", color="#2f6fe0", label="squareness (flat-hold %)")
    ax.plot(freqs, [100 * s["amp_fidelity"] for s in summary], "-s", color="#ed6c02", label="amplitude fidelity %")
    ax.axhline(100 * SQUARE_FLAT_THRESHOLD, color="#2e7d32", ls="--", lw=1, label=f"square threshold ({int(100*SQUARE_FLAT_THRESHOLD)}%)")
    if max_square is not None:
        ax.axvline(max_square, color="#c62828", lw=1.5)
        ax.text(max_square, 94, f" max square ~{max_square:g} Hz", color="#c62828",
                fontsize=10, fontweight="bold", ha="left", va="top")
    ax.set_xlabel("Square-wave frequency (Hz)"); ax.set_ylabel("%")
    ax.set_ylim(0, 105); ax.grid(True, alpha=0.3)
    ax.legend(loc="upper right", fontsize=9)
    fig.suptitle("Force squareness vs frequency (loaded sample)", fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "force_fidelity_curve.svg", format="svg", bbox_inches="tight")
    plt.close(fig)


# ---- main ------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Force square-wave characterization on a loaded sample.")
    ap.add_argument("--data", help="folder of rig force-vs-time files (one per frequency, freq in the filename)")
    ap.add_argument("--sim", action="store_true", help="no hardware: model an Ecoflex-soft loaded square wave")
    ap.add_argument("--lower", type=float, default=LOWER_N, help="lower force bound (N)")
    ap.add_argument("--upper", type=float, default=UPPER_N, help="upper force bound (N)")
    ap.add_argument("--speed", type=float, default=SPEED_MM_S, help="effective slew speed (mm/s, sim only)")
    ap.add_argument("--stiffness", type=float, default=STIFFNESS_N_MM, help="sample stiffness (N/mm, sim only)")
    args = ap.parse_args()
    if not args.data and not args.sim:
        ap.error("give --data FOLDER (real runs) or --sim (no-hardware model)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lower, upper = args.lower, args.upper
    all_data = {}

    if args.sim:
        for freq in FREQS_HZ:
            recs = simulate_force(freq, lower, upper, args.speed, args.stiffness)
            all_data[freq] = recs
            with open(OUT_DIR / f"data_{freq:g}Hz.csv", "w", newline="") as f:
                w = csv.writer(f); w.writerow(["time_s", "commanded_force_n", "achieved_force_n"]); w.writerows(recs)
        print(f"[sim] Ecoflex model: stiffness {args.stiffness:g} N/mm, speed {args.speed:g} mm/s, band {lower:g}-{upper:g} N")
        travel = inverse_press(upper, args.stiffness) - inverse_press(lower, args.stiffness)
        print(f"[sim] travel per swing = {travel:.2f} mm  ->  reaches-bounds ceiling = {args.speed/(2*travel):.2f} Hz")
    else:
        files = sorted(p for p in Path(args.data).iterdir()
                       if p.suffix.lower() in (".csv", ".xlsx", ".xls") and _freq_from_name(p.name))
        if not files:
            ap.error(f"no force files with a frequency in the name found in {args.data}")
        for p in files:
            freq = _freq_from_name(p.name)
            all_data[freq] = load_force_file(p, lower, upper)
            print(f"[data] {p.name} -> {freq:g} Hz, {len(all_data[freq])} samples")

    # metrics + the empirical max-square frequency
    summary = [m for m in (metrics(all_data[f], f, lower, upper) for f in sorted(all_data)) if m]
    passing = [s["freq"] for s in summary if s["square"]]
    max_square = max(passing) if passing else None

    with open(OUT_DIR / "summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["frequency_hz", "squareness_flat_pct", "amplitude_fidelity_pct", "reaches_bounds", "is_square",
                    "force_low_seen_n", "force_high_seen_n"])
        for s in summary:
            w.writerow([s["freq"], round(100 * s["flat"], 1), round(100 * s["amp_fidelity"], 1),
                        s["reaches"], s["square"], round(s["lo_seen"], 2), round(s["hi_seen"], 2)])
        w.writerow([])
        w.writerow(["empirical_max_square_hz", max_square if max_square is not None else "none in sweep"])

    plot_overlay(all_data, lower, upper)
    plot_curve(summary, max_square)

    print("\n freq   squareness  amp-fidelity  reaches  square?")
    for s in summary:
        print(f" {s['freq']:>4g} Hz   {100*s['flat']:5.0f}%       {100*s['amp_fidelity']:5.0f}%      "
              f"{'yes' if s['reaches'] else 'no ':>3}     {'SQUARE' if s['square'] else '-'}")
    print(f"\n==> empirical max square-wave frequency: "
          f"{(str(max_square)+' Hz') if max_square is not None else 'none in the swept range'}")
    print(f"Wrote data + plots to {OUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
