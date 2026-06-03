# Backend EM test-run engine.
#
# This ports Emilio's zaber-python `run_tests` (the real EM press) into a
# hardware-agnostic loop so the SAME logic runs in two modes:
#
#   * Real (Windows + rig): drives the Zaber with velocity moves and reads the
#     live FUTEK load cell, stopping the press at the force limit.
#   * Simulated (Mac / no hardware): a coupled spring model where pressing
#     deeper raises the simulated force, so the exact same control flow (descend
#     until >= limit, retract, home, save) runs end-to-end with no hardware.
#
# The mode is auto-selected: if the Zaber isn't connected (STATE.axis is None) or
# the FUTEK driver can't load (Mac, or FORCE_SIM=1), that source is simulated.
# The run executes in a background thread; the UI polls `status()` for live
# force/position and writes nothing itself. The real force/time stream is saved
# to FUT/Run N.xlsx (same format the analysis reads).
import math
import os
import threading
import time
from pathlib import Path

from hardware import STATE, _mm_unit

# -- press parameters ---------------------------------------------------------
HOME_MM = 17.0              # retracted / home position
GAP_MM = 12.75 - 1.8        # initial travel toward the sensor before the press
SAMPLE_DT = 0.010           # 100 Hz sampling — record force every 10 ms
UPPER_LIMIT_N = 20.0        # stop the press once force reaches this
LBF_TO_N = -4.44822         # FUTEK pounds -> newtons (and polarity flip)

# real-hardware press speeds (slow, gentle) — used on Windows with the rig.
REAL_DESCEND_MM_S = 0.05
REAL_ASCEND_MM_S = 1.0
# simulated speeds — faster so a dev run on the Mac finishes in a few seconds.
SIM_DESCEND_MM_S = 1.0
SIM_ASCEND_MM_S = 2.5

# simulated spring model: free travel before contact, then force rises with depth.
SIM_FREE_GAP_MM = 2.0
SIM_STIFFNESS_N_MM = 9.0


def _open_futek():
    # return a live FUTEK device, or None to simulate (Mac / no driver / FORCE_SIM).
    if os.environ.get("FORCE_SIM"):
        return None
    try:
        from futek_cli import FUTEKDeviceCLI
        return FUTEKDeviceCLI()
    except Exception:
        return None


class RunEngine:
    def __init__(self):
        self._lock = threading.Lock()
        self._thread = None
        self.reset_live()

    def reset_live(self):
        with threading.Lock():
            self.live = {
                "status": "idle", "force": 0.0, "position": HOME_MM, "run": 0,
                "elapsed": 0.0, "samples": 0, "message": "", "simulated": True,
            }

    def is_running(self):
        return self._thread is not None and self._thread.is_alive()

    def status(self):
        with self._lock:
            return dict(self.live)

    def _set(self, **kw):
        with self._lock:
            self.live.update(kw)

    def start(self, run_number, test_folder, surface_area_mm2=325.0, redo_of=None, reason=None):
        if self.is_running():
            return False, "A run is already in progress."
        STATE.stop_requested = False
        STATE.pause_requested = False
        self._thread = threading.Thread(
            target=self._run,
            args=(int(run_number), Path(test_folder), float(surface_area_mm2), redo_of, reason),
            daemon=True,
        )
        self._thread.start()
        return True, f"Run {run_number} started."

    # -- the press loop -----------------------------------------------------

    def _home(self, axis):
        if axis is not None:
            try:
                if axis.is_parked():
                    axis.unpark()
                axis.move_absolute(HOME_MM, _mm_unit())
            except Exception:
                pass
        STATE.position_mm = HOME_MM

    def _read_force(self, futek, depth):
        # real load cell, or the coupled spring model in simulation.
        if futek is not None:
            try:
                return futek.getNormalData() * LBF_TO_N
            except Exception:
                return 0.0
        # simulation: a gently stiffening contact spring (force rises a little
        # faster as the sensor compresses, like real foam/silicone), so the
        # loading ramp is a smooth curve. No high-frequency ripple — the old
        # sin(depth*60) term is what made the simulated curves look jagged.
        press = max(0.0, depth - SIM_FREE_GAP_MM)
        return SIM_STIFFNESS_N_MM * press * (1.0 + 0.06 * press)

    def _run(self, run_number, test_folder, surface_area_mm2, redo_of=None, reason=None):
        axis = STATE.axis                 # None when the Zaber is simulated
        futek = _open_futek()             # None when the FUTEK is simulated
        simulated = (axis is None) or (futek is None)
        descend = SIM_DESCEND_MM_S if simulated else REAL_DESCEND_MM_S
        ascend = SIM_ASCEND_MM_S if simulated else REAL_ASCEND_MM_S

        self._set(status="running", run=run_number, simulated=simulated,
                  force=0.0, samples=0, message="", position=HOME_MM)

        readings = []   # (index, force_N, time_s)
        t0 = time.time()
        idx = 0

        def record(stage_force):
            nonlocal idx
            # simulated runs use a deterministic 100 Hz clock so the time axis is
            # perfectly uniform (10 ms apart); real runs use the wall clock, which
            # follows the real FUTEK cadence.
            t = idx * SAMPLE_DT if simulated else (time.time() - t0)
            idx += 1
            readings.append((idx, stage_force, t))
            self._set(force=stage_force, position=STATE.position_mm,
                      elapsed=t, samples=idx)

        try:
            # --- gap-set move toward the sensor ---
            if axis is not None:
                try:
                    axis.move_relative(-GAP_MM, _mm_unit())
                    STATE._read_position()
                except Exception:
                    STATE.position_mm = HOME_MM - GAP_MM
            else:
                STATE.position_mm = HOME_MM - GAP_MM
            start_pos = STATE.position_mm
            depth = 0.0

            # --- descend until force reaches the limit ---
            if axis is not None:
                from zaber_motion import Units
                try:
                    axis.move_velocity(-descend, Units.VELOCITY_MILLIMETRES_PER_SECOND)
                except Exception:
                    pass
            init_force = None
            while True:
                if STATE.stop_requested:
                    self._stop_axis(axis); self._home(axis)
                    self._set(status="stopped", message="Run stopped.", position=HOME_MM)
                    return
                if STATE.pause_requested:
                    self._stop_axis(axis); self._home(axis)
                    STATE.pause_requested = False
                    self._set(status="paused", position=HOME_MM,
                              message=f"Run {run_number} paused — repeat this run.")
                    return

                if axis is None:
                    depth += descend * SAMPLE_DT
                    STATE.position_mm = start_pos - depth
                else:
                    STATE._read_position()
                force = self._read_force(futek, depth)
                if init_force is None:
                    init_force = force
                stage = force - init_force
                record(stage)
                if stage >= UPPER_LIMIT_N:
                    self._stop_axis(axis)
                    break
                if axis is None and depth > SIM_FREE_GAP_MM + (UPPER_LIMIT_N / SIM_STIFFNESS_N_MM) + 3:
                    break  # sim safety net
                time.sleep(SAMPLE_DT)

            # --- retract back to the start position ---
            if axis is not None:
                from zaber_motion import Units
                try:
                    axis.move_velocity(ascend, Units.VELOCITY_MILLIMETRES_PER_SECOND)
                except Exception:
                    pass
            while True:
                if STATE.stop_requested:
                    self._stop_axis(axis); self._home(axis)
                    self._set(status="stopped", message="Run stopped.", position=HOME_MM)
                    return
                if axis is None:
                    depth -= ascend * SAMPLE_DT
                    STATE.position_mm = start_pos - depth
                else:
                    STATE._read_position()
                force = self._read_force(futek, max(0.0, depth))
                record(force - (init_force or 0.0))
                if STATE.position_mm >= start_pos:
                    self._stop_axis(axis)
                    break
                time.sleep(SAMPLE_DT)

            self._home(axis)
            fut_path = self._write_fut(test_folder, run_number, readings)
            # never overwrite: record this run (and the redo reason) in the log.
            import run_log
            run_log.record_run(test_folder, run_number, redo_of=redo_of, reason=reason)
            self._set(status="completed", position=HOME_MM, redo_of=redo_of,
                      message=f"Run {run_number} complete — {len(readings)} samples saved to {fut_path.name}.")
        except Exception as exc:
            self._set(status="error", message=f"Run failed: {exc}")
        finally:
            if futek is not None:
                try:
                    futek.stop(); futek.exit()
                except Exception:
                    pass

    def _stop_axis(self, axis):
        if axis is not None:
            try:
                axis.stop()
            except Exception:
                pass

    def _write_fut(self, test_folder, run_number, readings):
        fut_dir = Path(test_folder) / "FUT"
        fut_dir.mkdir(parents=True, exist_ok=True)
        path = fut_dir / f"Run {run_number}.xlsx"
        try:
            import xlsxwriter
            workbook = xlsxwriter.Workbook(str(path))
            worksheet = workbook.add_worksheet(str(run_number))
            worksheet.write("A1", "Index")
            worksheet.write("B1", "Load Cell")
            worksheet.write("C1", "Time")
            for row, (index, force, t) in enumerate(readings, start=1):
                worksheet.write(row, 0, index)
                worksheet.write(row, 1, force)
                worksheet.write(row, 2, t)
            workbook.close()
            return path
        except Exception:
            import csv
            path = fut_dir / f"Run {run_number}.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Index", "Load Cell", "Time"])
                for index, force, t in readings:
                    writer.writerow([index, round(force, 5), round(t, 5)])
            return path


ENGINE = RunEngine()
