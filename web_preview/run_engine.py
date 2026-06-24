# Backend EM test-run engine.

#   * Real (Windows + rig): drives the Zaber with velocity moves and reads the
#     live FUTEK load cell, stopping the press at the force limit.
#   * Simulated (Mac / no hardware): a coupled spring model where pressing
#     deeper raises the simulated force, so the exact same control flow (descend
#     until >= limit, retract, home, save) runs end-to-end with no hardwar
import math
import os
import threading
import time
from pathlib import Path

from hardware import STATE, _mm_unit

# -- press parameters ---------------------------------------------------------
HOME_MM = 17.0              # retracted / home position
GAP_MM = 10.95              # initial travel toward the sensor before the press
FUJI_EXTRUSION_MAX_MM = 12.0  # ceiling for the operator-set Fuji extrusion distance (safety clamp)
SAMPLE_DT = 0.010           # 100 Hz sampling - record force every 10 ms
JOG_POLL_DT = 0.04          # manual jog: poll the stage ~25 Hz (gentler on the serial port)
UPPER_LIMIT_N = 32.0        # EM run press target - stop the press once force reaches this
# travel safety: the Zaber stage's travel limits (mm). HOME_MM (17) is the
# minimum / retracted end and the floor of travel; a press extrudes UPWARD from
# there toward the 50.8 mm maximum. A press is stopped if the actuator reaches
# either end, so it can never drive into its own mechanical hard stop. The
# frontend uses the same range (ACTUATOR_MIN_MM / ACTUATOR_MAX_MM in shared.js).
# Set these to match the actual stage if it differs.
ZABER_TRAVEL_MIN_MM = 17.0
ZABER_TRAVEL_MAX_MM = 50.8
TRAVEL_MARGIN_MM = 0.5      # stop this far before the physical end stop
LBF_TO_N = -4.44822         # FUTEK pounds -> newtons (and polarity flip)

# real-hardware press speeds (slow, gentle) - used on Windows with the rig.
REAL_DESCEND_MM_S = 0.05
REAL_ASCEND_MM_S = 1.0
# simulated speeds - faster so a dev run on the Mac finishes in a few seconds.
SIM_DESCEND_MM_S = 1.0
SIM_ASCEND_MM_S = 2.5

# simulated spring model: free travel before contact, then force rises with depth.
SIM_FREE_GAP_MM = 2.0
SIM_STIFFNESS_N_MM = 9.0

# fatigue (cyclical) cycling speeds. Each cycle is force-feedback: press down to
# the upper force bound, retract to the lower force bound, repeat N times. Real
# uses a moderate speed; sim is faster so a handful of demo cycles finish quickly.
REAL_CYC_DESCEND_MM_S = 1.0
REAL_CYC_ASCEND_MM_S = 1.0
SIM_CYC_DESCEND_MM_S = 4.0
SIM_CYC_ASCEND_MM_S = 4.0
# how many of the most recent 100 Hz samples the live waveform shows (~10 s).
CYC_TRACE_WINDOW = 1000

# force-spike protection. A sudden contact/jam jumps the force far more than a
# smooth press. The legitimate jump between two force checks is about the contact
# stiffness times how far the actuator moved between them (force = stiffness x
# displacement), so for the continuous presses the cutoff SCALES WITH SPEED via
# distance = speed x sample interval. The goal is to fire ONLY on a metal-stiffness
# contact, not on pressing a sensor (even when contacting it at speed): a press
# through a sensor is a few hundred N/mm at most (the soft sensor dominates the
# series stiffness), while hitting the bare metal/load cell is ~8700 N/mm. So
# SPIKE_STIFFNESS_N_PER_MM is set well above any sensor and well below metal, with
# wide margin so a normal process is never interrupted. SPIKE_FLOOR_N is the
# minimum, above the load cell's noise at very slow speeds. The manual jog is
# stepped and the actuator stalls at its 25 N peak thrust, so its per-step jump is
# bounded - it uses a flat MANUAL_SPIKE_N instead.
SPIKE_FLOOR_N = 1.5
SPIKE_STIFFNESS_N_PER_MM = 2000.0
MANUAL_SPIKE_N = 8.0
# absolute hard ceiling (N): force above this stops immediately, whatever caused
# it. EM/fatigue runs intentionally target 32 N (above the 5 lb load cell's
# 22.24 N rated output but within its 33.3 N safe overload), so the ceiling sits
# just above 32 N and below 33.3 N to catch a true fault before the cell is
# damaged. The actuator's ~25 N peak thrust is itself below the cell's safe
# overload, so the actuator cannot physically drive the cell into overload - it
# stalls (slip/stall detection) well before 33.3 N.
FORCE_CEILING_N = 33.0
# Fuji-film calibration press target.
FUJI_TARGET_N = 20.0
# manual jogs move in small increments so the load cell can be read between
# steps and the motion halted the instant force crosses the ceiling.
MANUAL_STEP_MM = 0.25


class ForceSpikeStop(Exception):
    """Raised inside a run loop when a force spike / over-force is detected."""


class ZaberDisconnect(Exception):
    """Raised inside a run loop when the live Zaber stops responding (comms lost)."""


class FutekDisconnect(Exception):
    """Raised inside a run loop when the live FUTEK load cell stops responding mid-run."""


# --- Single-owner load cell reader -------------------------------------------
# The FUTEK is a single device that does NOT tolerate being read from more than one
# place at a time. Concurrent reads, or reads from different threads, corrupt the .NET
# driver and drop the load cell to simulated for the rest of the session. The manual
# window made this happen constantly: its live graph read force ~10x/second WHILE a
# compression read it too, so two reads collided and killed the device.
#
# The fix is structural: exactly ONE background thread owns the device. It opens it
# once (on its own thread - also avoiding any .NET thread-affinity issue) and reads it
# ~100 Hz into a shared 'latest raw' value. Every consumer - the manual live graph,
# every compression/jog, EM, Shear, Fuji, Fatigue - reads that cached value and NEVER
# touches the driver. One writer, many readers, so two simultaneous device accesses are
# impossible, in every window and every test.
class _FutekReader:
    def __init__(self):
        self._lock = threading.Lock()
        self._device = None        # open FUTEK (real on Windows, mock on Mac) or None
        self._latest_raw = None    # most recent raw signed reading; holds the last good value
        self._kind = "NONE"
        self._started = False
        self._failed = False       # open failed (or FORCE_SIM) -> simulated this session
        self._stop = False
        self._read_fail = 0        # consecutive bad reads on an open device (3 = lost mid-run)
        self._lost = False         # set True after a real device stops responding mid-recording

    def ensure_started(self):
        # Open the device and start the owner thread on first force need. Non-blocking:
        # readiness is observed via latest_raw() / wait_ready(), so callers that poll
        # (the idle graph sampler) never block on the multi-second device open.
        with self._lock:
            if self._started or self._failed:
                return
            if os.environ.get("FORCE_SIM"):
                print("[futek] FORCE_SIM set -> simulated force; the load cell is not opened.")
                self._failed = True
                return
            self._started = True
        threading.Thread(target=self._run, name="futek-reader", daemon=True).start()

    def _run(self):
        # Owns the device for its whole life: opens it on THIS thread, then reads it
        # forever on THIS thread. No other thread ever touches the driver.
        try:
            import futek_cli
            real_ok = getattr(futek_cli, "_REAL_FUTEK_AVAILABLE", False)
            print(f"[futek] opening the load cell (owner thread)... real .NET driver loaded = {real_ok}")
            if not real_ok:
                print(f"[futek]   real driver did NOT load: {getattr(futek_cli, '_FUTEK_IMPORT_ERROR', None)}; "
                      "using the MOCK load cell (synthetic force).")
            device = futek_cli.FUTEKDeviceCLI()
            from futek_cli import MockFUTEKDeviceCLI
            kind = "MOCK (synthetic force)" if isinstance(device, MockFUTEKDeviceCLI) else "REAL"
        except Exception as exc:
            import traceback
            print(f"[futek] FAILED to open the load cell: {type(exc).__name__}: {exc}")
            print("[futek]   falling back to simulated force; not retrying until restart.")
            traceback.print_exc()
            with self._lock:
                self._failed = True
                self._device = None
            return
        with self._lock:
            self._device = device
            self._kind = kind
        print(f"[futek] >>> load cell open: {kind}. One owner thread now reads it ~100 Hz.")
        # The ONLY place the device is ever read:
        while not self._stop:
            try:
                raw = device.getNormalData()
                with self._lock:
                    self._latest_raw = raw
                    self._read_fail = 0
            except Exception:
                # a single bad read is transient: keep the last value and keep going. But
                # a REAL load cell that stops responding for several reads in a row has
                # been unplugged mid-recording - flag it (3-strike, like the actuator's
                # comms_lost) so an in-progress capture can invalidate itself.
                with self._lock:
                    if kind == "REAL":
                        self._read_fail += 1
                        if self._read_fail >= 3:
                            self._lost = True
            time.sleep(SAMPLE_DT)

    def wait_ready(self, timeout=15.0):
        # Block until the first reading exists or the open failed. Called before a press
        # so motion never starts against a not-yet-ready load cell.
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if self._failed or self._latest_raw is not None:
                    return
            time.sleep(0.05)

    def latest_raw(self):
        with self._lock:
            return self._latest_raw

    def real_in_use(self):
        # True when a device (real or mock) is open and being read; False when the open
        # failed or FORCE_SIM is set, so callers treat force as simulated.
        with self._lock:
            return self._device is not None and not self._failed

    def lost(self):
        # True once a REAL device that was open has stopped responding (unplugged
        # mid-recording). Mirrors STATE.comms_lost for the actuator.
        with self._lock:
            return self._lost

    def kind(self):
        with self._lock:
            return self._kind

    def stop(self):
        # Shut the reader down (app exit / explicit reconnect) and clear the failure
        # latch so a later ensure_started() re-attempts the open.
        with self._lock:
            self._stop = True
            dev = self._device
        if dev is not None:
            try:
                dev.stop(); dev.exit()
            except Exception:
                pass
        with self._lock:
            self._device = None
            self._latest_raw = None
            self._started = False
            self._failed = False
            self._stop = False
            self._read_fail = 0
            self._lost = False


READER = _FutekReader()


def _futek_kind(dev):
    # human label for the load cell in use. `dev` is the single-owner READER (from
    # _open_futek) or None. Returns exactly "REAL" only when a real device is being
    # read, so callers can gate on it (e.g. shear's simulated flag).
    if dev is None:
        return "NONE (simulated force)"
    if isinstance(dev, _FutekReader):
        return dev.kind()       # "REAL" / "MOCK (synthetic force)" / "NONE"
    return "REAL"


def _open_futek():
    # Ensure the single owner reader is running, then BLOCK until it has a reading (or
    # the open failed). Returns the reader when a device is in use, or None for
    # simulated force. Callers keep using `simulated = (axis is None) or (futek is None)`.
    READER.ensure_started()
    READER.wait_ready()
    return READER if READER.real_in_use() else None


FUTEK_INIT_FAIL_MSG = ("Could not connect to the FUTEK load cell. Confirm it is plugged in "
                       "and that you are running on Windows.")


def _futek_init_failed(futek):
    # True only when a REAL load cell was expected (the .NET driver loaded) but the open
    # did not produce a usable real device. On a Mac / no-hardware machine the driver
    # never loads, so this stays False and the simulated (MOCK) run proceeds untouched.
    try:
        import futek_cli
        real_expected = getattr(futek_cli, "_REAL_FUTEK_AVAILABLE", False)
    except Exception:
        real_expected = False
    return real_expected and (futek is None or _futek_kind(futek) != "REAL")


def _close_futek():
    # Stop the owner reader (app shutdown / reconnect). A later force read re-opens it.
    READER.stop()


class RunEngine:
    def __init__(self):
        self._lock = threading.Lock()
        self._thread = None
        # the load cell's resting (uncompressed) raw reading, captured when the actuator
        # is at home. Manual force moves measure ABSOLUTE force as abs(raw - baseline) so
        # compression and decompression share one reference (a per-move tare would read 0
        # at the start of a decompress and stop it instantly). None until first captured.
        self._manual_baseline = None
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
        STATE.comms_lost = False
        # Mark running synchronously, BEFORE spawning the thread. _run only sets
        # status="running" after _open_futek(), which on real hardware takes a few
        # hundred ms; without this, the first UI poll after start-run could read the
        # previous run's stale "paused"/"completed" status and tear down its own poll
        # loop, leaving the actuator running with a frozen graph.
        # "waiting" until the run thread is past the load-cell init and about to move
        # (the thread flips it to "running"); the UI shows a wait pill meanwhile.
        self._set(status="waiting", run=int(run_number), force=0.0, samples=0,
                  message="initializing actuator and load cell - please wait",
                  position=HOME_MM, disconnect=False, safety_stop=False)
        self._thread = threading.Thread(
            target=self._run,
            args=(int(run_number), Path(test_folder), float(surface_area_mm2), redo_of, reason),
            daemon=True,
        )
        self._thread.start()
        return True, f"Run {run_number} started."

    # -- the press loop -----------------------------------------------------

    def _home(self, axis):
        # drive to the true 17 mm home (the device's absolute coordinate) and wait for
        # the actuator to arrive before anything else happens. Because the reference is
        # no longer redefined on connect, move_absolute(17) actually moves the actuator
        # to physical home even when it was somewhere else when the test started.
        if axis is not None:
            try:
                if axis.is_parked():
                    axis.unpark()
                axis.move_absolute(HOME_MM, _mm_unit(), wait_until_idle=True)
                STATE._read_position()
                return
            except Exception:
                pass
        STATE.position_mm = HOME_MM

    def _read_force(self, futek, depth):
        # real load cell, or the coupled spring model in simulation.
        if futek is not None:
            # `futek` is the single-owner READER. Read the value its owner thread already
            # cached - we NEVER touch the .NET driver here, so no two consumers can hit
            # the device at once. Callers tare to the start-of-press baseline
            # (force - init_force) then take the magnitude, which gives a positive
            # compression force for a load cell of either polarity.
            raw = futek.latest_raw()
            if raw is not None:
                return raw * LBF_TO_N
            # device still opening or a momentary gap: on a real rig do not fake a
            # spring force (presses wait for wait_ready() before moving, so this is rare).
            return 0.0
        # simulation: a gently stiffening contact spring (force rises a little
        # faster as the sensor compresses, like real foam/silicone), so the
        # loading ramp is a smooth curve. No high-frequency ripple - the old
        # sin(depth*60) term is what made the simulated curves look jagged.
        press = max(0.0, depth - SIM_FREE_GAP_MM)
        return SIM_STIFFNESS_N_MM * press * (1.0 + 0.06 * press)

    def _spike_limit(self, distance_mm):
        # speed-relative force-spike cutoff: scales with how far the actuator moves
        # between force checks (distance = speed x sample interval for the presses),
        # floored above the load cell's noise. A smooth press stays under it at any
        # speed; a hard contact jumps past it.
        return max(SPIKE_FLOOR_N, SPIKE_STIFFNESS_N_PER_MM * abs(distance_mm))

    def _at_travel_limit(self):
        # True when the actuator has reached (within a margin) either physical end
        # of its travel. Checked in both directions so it is correct regardless of
        # which way a press moves the stage.
        pos = STATE.position_mm
        return (pos <= ZABER_TRAVEL_MIN_MM + TRAVEL_MARGIN_MM or
                pos >= ZABER_TRAVEL_MAX_MM - TRAVEL_MARGIN_MM)

    def _approach_move(self, axis, distance_mm=None):
        # single move toward the sensor, up to the gap-set start position. Contact
        # and pressing happen afterward in the main loop, where the force-spike,
        # ceiling, and travel checks run. Sets the position directly in simulation.
        # distance_mm defaults to GAP_MM; the Fuji film press passes the operator's
        # extrusion distance instead.
        distance = GAP_MM if distance_mm is None else float(distance_mm)
        if axis is None:
            STATE.position_mm = HOME_MM + distance
            return
        try:
            # Drive the approach non-blocking and poll, instead of one blocking
            # wait_until_idle move, so a Stop or Pause pressed DURING the approach
            # takes effect right away. The old blocking move ignored both flags until
            # the actuator finished arriving (~5.5 s for the gap move at 2 mm/s), which
            # is why Pause "didn't trigger right away" while the fixture was still
            # moving toward the sensor. On a stop/pause we halt here and return; the
            # caller's run loop then runs its own pause/stop handling (home + status).
            axis.move_relative(distance, _mm_unit(), wait_until_idle=False)
            deadline = time.time() + 60.0
            while axis.is_busy():
                if STATE.stop_requested or STATE.pause_requested:
                    self._stop_axis(axis)
                    break
                if time.time() > deadline:
                    self._stop_axis(axis)
                    break
                time.sleep(SAMPLE_DT)
            STATE._read_position()
        except Exception:
            STATE.comms_lost = True
            raise ZaberDisconnect()

    def manual_move(self, distance, speed=None):
        # Smooth, force-monitored manual jog. Drives ONE continuous velocity move
        # (not a 0.25 mm stepped stop-start) while polling the load cell, and stops
        # at the target distance, the force ceiling, a metal-contact spike, or the
        # travel limit. It first sets status="waiting" BEFORE opening the load cell -
        # that open can take ~12 s the first time - so the UI can lock controls and
        # show a "waiting to start" pill before the actuator moves. Streams live
        # force/position into self.live for the UI to poll.
        distance = float(distance)
        axis = STATE.axis
        STATE.stop_requested = False
        base_pos = STATE.position_mm
        target_pos = base_pos + distance
        print(f"[calibration] manual_move START distance={distance:.3f} mm  base={base_pos:.2f}  target={target_pos:.2f}  simulated={(axis is None)}")
        # waiting-to-start: the load cell can still take a few seconds to initialize
        # sometimes; show it before the open so the UI can lock + show a wait pill.
        self._set(status="waiting", simulated=(axis is None), force=0.0, position=base_pos,
                  elapsed=0.0, samples=0, trace=[], disconnect=False, safety_stop=False,
                  message="initializing load cell - please wait")
        futek = _open_futek()
        simulated = (axis is None) or (futek is None)
        jog_speed = max(0.01, min(abs(float(speed)) if speed else 2.0, 25.0))   # mm/s
        if axis is not None:
            try:
                from zaber_motion import Units
                default_speed = axis.settings.get("maxspeed", Units.VELOCITY_MILLIMETRES_PER_SECOND)
                print(f"[calibration] Zaber default move speed (maxspeed): {default_speed:.4f} mm/s; jogging at {jog_speed:.3f} mm/s")
            except Exception as exc:
                print(f"[calibration] could not read Zaber default move speed: {exc}")
        t0 = time.time()
        trace = []
        prev_force = None
        force = 0.0
        # continuous motion polls finely, so use the same speed-relative, metal-only
        # spike cutoff as the press (a flat threshold would false-trip on a sensor).
        spike_limit = self._spike_limit(jog_speed * JOG_POLL_DT)
        self._set(status="running", simulated=simulated, force=0.0, position=base_pos,
                  elapsed=0.0, samples=0, trace=[], message="")

        def record_and_check():
            # read force, stream it, enforce ceiling/spike. Returns a stop result dict
            # if it tripped, else None.
            nonlocal force, prev_force
            force = abs(self._read_force(futek, max(0.0, STATE.position_mm - HOME_MM)))
            t = time.time() - t0
            trace.append([round(t, 4), round(force, 4)])
            self._set(force=force, position=STATE.position_mm, elapsed=t, trace=list(trace))
            if force > FORCE_CEILING_N or (prev_force is not None and abs(force - prev_force) > spike_limit):
                self._stop_axis(axis)
                msg = (f"Force limit reached ({force:.1f} N). Manual move stopped for "
                       f"safety at {STATE.position_mm:.2f} mm.")
                self._set(status="error", safety_stop=True, position=STATE.position_mm, force=force, message=msg)
                return {"ok": True, "position": STATE.position_mm, "force": force,
                        "stopped_for_safety": True, "simulated": simulated, "message": msg}
            prev_force = force
            return None

        def reached_target():
            return (distance >= 0 and STATE.position_mm >= target_pos) or \
                   (distance < 0 and STATE.position_mm <= target_pos)

        STATE._move_loop_active = True   # this loop owns the serial port now
        try:
            if axis is not None:
                # ONE smooth relative move - the device handles the target with its own
                # encoder, so completion (is_busy) is correct even if the GUI's absolute
                # reference is off, and it never gets stuck waiting for a position that
                # never matches.
                try:
                    axis.move_relative(distance, _mm_unit(), wait_until_idle=False)
                except Exception as exc:
                    STATE.comms_lost = True
                    self._set(status="error", disconnect=True, position=STATE.position_mm,
                              message=f"Manual move failed: {exc}")
                    return {"ok": False, "position": STATE.position_mm, "disconnect": True,
                            "message": f"Manual move failed: {exc}"}
                time.sleep(JOG_POLL_DT)   # let the move actually start before polling is_busy
                # Hard safety net: the move should finish within its expected travel
                # time. If is_busy stops responding or the device never reports idle,
                # this deadline ends the loop so /api/move ALWAYS returns - the UI can
                # never get stuck "actuator moving" with the controls locked.
                deadline = time.time() + abs(distance) / max(0.1, jog_speed) * 2.0 + 5.0
                busy_fail = 0
                while True:
                    if STATE.stop_requested:
                        self._stop_axis(axis)
                        self._set(status="stopped", position=STATE.position_mm, force=force, message="Manual move stopped.")
                        return {"ok": True, "position": STATE.position_mm, "force": force,
                                "stopped": True, "simulated": simulated, "message": "Manual move stopped."}
                    if time.time() > deadline:
                        print(f"[calibration] manual_move: DEADLINE reached at pos={STATE.position_mm:.2f} mm "
                              f"(is_busy never reported idle in time) - ending move")
                        self._stop_axis(axis)
                        break
                    try:
                        still_moving = axis.is_busy()
                        busy_fail = 0
                    except Exception as exc:
                        busy_fail += 1
                        still_moving = busy_fail < 3   # after 3 failed queries in a row, treat as done
                        print(f"[calibration] manual_move: is_busy() failed {busy_fail}/3: {exc}")
                    STATE._read_position()    # stream the live position (3-strike comms_lost inside)
                    if STATE.comms_lost:
                        print(f"[calibration] manual_move: COMMS LOST at pos={STATE.position_mm:.2f} mm")
                        self._stop_axis(axis)
                        self._set(status="error", disconnect=True, position=STATE.position_mm,
                                  message="Actuator connection lost. Check the cable before continuing.")
                        return {"ok": False, "position": STATE.position_mm, "disconnect": True,
                                "message": "Actuator connection lost. Check the cable before continuing."}
                    tripped = record_and_check()
                    if tripped is not None:
                        print(f"[calibration] manual_move: SAFETY STOP at pos={STATE.position_mm:.2f} mm")
                        return tripped
                    if not still_moving:      # the device finished the move
                        print(f"[calibration] manual_move: device reported IDLE at pos={STATE.position_mm:.2f} mm")
                        self._stop_axis(axis)
                        break
                    time.sleep(JOG_POLL_DT)
            else:
                # simulation: ramp the position smoothly at jog_speed, streaming force.
                while True:
                    if STATE.stop_requested:
                        self._set(status="stopped", position=STATE.position_mm, force=force, message="Manual move stopped.")
                        return {"ok": True, "position": STATE.position_mm, "force": force,
                                "stopped": True, "simulated": simulated, "message": "Manual move stopped."}
                    remaining = target_pos - STATE.position_mm
                    if abs(remaining) <= jog_speed * SAMPLE_DT:
                        STATE.position_mm = target_pos
                        record_and_check()
                        break
                    STATE.position_mm += math.copysign(jog_speed * SAMPLE_DT, remaining)
                    tripped = record_and_check()
                    if tripped is not None:
                        return tripped
                    time.sleep(SAMPLE_DT)
            print(f"[calibration] manual_move COMPLETE pos={STATE.position_mm:.2f} mm  force={force:.2f} N - returning to UI")
            self._set(status="completed", position=STATE.position_mm, force=force, trace=list(trace),
                      message=f"Manual move complete. Position {STATE.position_mm:.2f} mm.")
            return {"ok": True, "position": STATE.position_mm, "force": force, "simulated": simulated,
                    "message": f"Moved to {STATE.position_mm:.2f} mm."}
        except Exception as exc:
            self._stop_axis(axis)
            self._set(status="error", position=STATE.position_mm, message=f"Manual move failed: {exc}")
            return {"ok": False, "position": STATE.position_mm, "message": f"Manual move failed: {exc}"}
        finally:
            STATE._move_loop_active = False

    def manual_force_move(self, target_force, direction="down", speed=None):
        # Force-feedback jog driven at the actuator speed:
        #   down = COMPRESS, move toward the sensor until force RISES to the target.
        #   up   = DECOMPRESS, move away from the sensor until force FALLS to the target.
        # It only moves in the direction that brings force toward the target: compression
        # never moves up, decompression never moves down. Force is ABSOLUTE (abs(raw -
        # resting baseline)), so both directions compare against the same reference. The
        # press safety net applies: force ceiling, metal spike, travel limit, comms loss.
        target_force = abs(float(target_force))
        going_down = (direction != "up")
        axis = STATE.axis
        STATE.stop_requested = False
        self._set(status="waiting", simulated=(axis is None), force=0.0, position=STATE.position_mm,
                  elapsed=0.0, samples=0, trace=[], disconnect=False, safety_stop=False,
                  message="initializing load cell - please wait")
        futek = _open_futek()
        simulated = (axis is None) or (futek is None)
        jog_speed = max(0.01, min(abs(float(speed)) if speed else 2.0, 25.0))
        # capture the resting (uncompressed) baseline when at home; otherwise reuse the
        # last one so absolute force is consistent across a compress/decompress sequence.
        raw_now = self._read_force(futek, 0.0)
        if self._manual_baseline is None or abs(STATE.position_mm - HOME_MM) < 0.1:
            self._manual_baseline = raw_now
        baseline = self._manual_baseline
        current_force = abs(raw_now - baseline)
        print(f"[manual force] target={target_force:.2f} N  dir={direction}  speed={jog_speed:.3f} mm/s  "
              f"current={current_force:.2f} N  simulated={simulated}  load_cell={_futek_kind(futek)}")
        # only move in the direction that brings force toward the target.
        if going_down and current_force >= target_force:
            msg = f"Already at {current_force:.2f} N (>= target {target_force:.2f} N). Compression does not move up."
            print(f"[manual force] no move - {msg}")
            self._set(status="completed", position=STATE.position_mm, force=current_force, message=msg)
            return {"ok": True, "position": STATE.position_mm, "force": current_force, "simulated": simulated, "message": msg}
        if (not going_down) and current_force <= max(target_force, 0.1):
            msg = f"Already at {current_force:.2f} N (<= target {target_force:.2f} N). Decompression does not move down."
            print(f"[manual force] no move - {msg}")
            self._set(status="completed", position=STATE.position_mm, force=current_force, message=msg)
            return {"ok": True, "position": STATE.position_mm, "force": current_force, "simulated": simulated, "message": msg}
        t0 = time.time()
        trace = []
        force = current_force
        prev_force = current_force
        spike_limit = self._spike_limit(jog_speed * JOG_POLL_DT)
        self._set(status="running", simulated=simulated, force=current_force, position=STATE.position_mm,
                  elapsed=0.0, samples=0, trace=[], message="")
        STATE._move_loop_active = True
        try:
            if axis is not None:
                from zaber_motion import Units
                try:
                    axis.move_velocity(jog_speed if going_down else -jog_speed,
                                       Units.VELOCITY_MILLIMETRES_PER_SECOND)
                except Exception as exc:
                    STATE.comms_lost = True
                    self._set(status="error", disconnect=True, position=STATE.position_mm,
                              message=f"Manual force move failed: {exc}")
                    return {"ok": False, "position": STATE.position_mm, "disconnect": True,
                            "message": f"Manual force move failed: {exc}"}
            # bound the search so a target that is never reached cannot run forever.
            deadline = time.time() + 120.0
            while True:
                if STATE.stop_requested:
                    self._stop_axis(axis)
                    self._set(status="stopped", position=STATE.position_mm, force=force,
                              message="Manual force move stopped.")
                    return {"ok": True, "position": STATE.position_mm, "force": force, "stopped": True,
                            "simulated": simulated, "message": "Manual force move stopped."}
                if time.time() > deadline:
                    self._stop_axis(axis)
                    msg = f"Force target not reached within the time limit (stopped at {force:.2f} N)."
                    self._set(status="stopped", position=STATE.position_mm, force=force, message=msg)
                    return {"ok": True, "position": STATE.position_mm, "force": force, "stopped": True,
                            "simulated": simulated, "message": msg}
                if axis is None:
                    STATE.position_mm += (jog_speed if going_down else -jog_speed) * SAMPLE_DT
                else:
                    STATE._read_position()
                if STATE.comms_lost:
                    self._stop_axis(axis)
                    self._set(status="error", disconnect=True, position=STATE.position_mm,
                              message="Actuator connection lost. Check the cable before continuing.")
                    return {"ok": False, "position": STATE.position_mm, "disconnect": True,
                            "message": "Actuator connection lost. Check the cable before continuing."}
                depth = max(0.0, STATE.position_mm - HOME_MM)
                f = self._read_force(futek, depth)
                # ABSOLUTE force vs the resting baseline (positive for either polarity),
                # so compression and decompression share one reference.
                force = abs(f - baseline)
                t = time.time() - t0
                trace.append([round(t, 4), round(force, 4)])
                self._set(force=force, position=STATE.position_mm, elapsed=t, samples=len(trace), trace=list(trace))
                # safety: a sudden metal-contact force spike, or the over-force ceiling.
                spike = prev_force is not None and abs(force - prev_force) > spike_limit
                if force > FORCE_CEILING_N or spike:
                    self._stop_axis(axis)
                    if spike:
                        msg = "Force spike detected. Motion stopped for safety"
                    else:
                        msg = (f"Force limit reached ({force:.1f} N). Manual move stopped for safety "
                               f"at {STATE.position_mm:.2f} mm.")
                    self._set(status="error", safety_stop=True, position=STATE.position_mm, force=force, message=msg)
                    return {"ok": True, "position": STATE.position_mm, "force": force,
                            "stopped_for_safety": True, "simulated": simulated, "message": msg}
                prev_force = force
                # never drive into the actuator's mechanical end stop. This is
                # DIRECTIONAL: compression starts at the 17 mm home (the travel minimum)
                # and moves toward the 50.8 mm maximum, so only the max end is a limit
                # when going down. (A non-directional check would false-trip at home.)
                if going_down and STATE.position_mm >= ZABER_TRAVEL_MAX_MM - TRAVEL_MARGIN_MM:
                    self._stop_axis(axis)
                    self._set(status="error", safety_stop=True, position=STATE.position_mm,
                              message="Actuator reached its travel limit before the target force. Move stopped for safety.")
                    return {"ok": True, "position": STATE.position_mm, "force": force,
                            "stopped_for_safety": True, "simulated": simulated,
                            "message": "Actuator reached its travel limit before the target force."}
                # compression: stop once force has RISEN to the target.
                if going_down and force >= target_force:
                    self._stop_axis(axis)
                    break
                # decompression: stop the first time force has FALLEN to the target, or
                # the actuator is back at home (the floor - it cannot retract further).
                # The threshold is floored at 0.1 N: with abs() force never lands exactly
                # on 0, so a target of 0 needs a small noise-floor tolerance to register
                # "reached 0" (non-zero targets are unaffected - max() keeps them exact).
                if (not going_down) and (force <= max(target_force, 0.1) or STATE.position_mm <= HOME_MM + 0.02):
                    self._stop_axis(axis)
                    break
                time.sleep(SAMPLE_DT)
            verb = "Compressed" if going_down else "Decompressed"
            msg = f"{verb} to {force:.2f} N at {STATE.position_mm:.2f} mm."
            print(f"[manual force] done - {msg}")
            self._set(status="completed", position=STATE.position_mm, force=force, trace=list(trace), message=msg)
            return {"ok": True, "position": STATE.position_mm, "force": force, "simulated": simulated,
                    "message": msg}
        except Exception as exc:
            self._stop_axis(axis)
            self._set(status="error", position=STATE.position_mm, message=f"Manual force move failed: {exc}")
            return {"ok": False, "position": STATE.position_mm, "message": f"Manual force move failed: {exc}"}
        finally:
            STATE._move_loop_active = False

    def read_force_now(self):
        # Idle live-force read for the manual window's continuous graph (no motion).
        # During a move the move loop already streams force into self.live, so just hand
        # that back. Otherwise read the value the single-owner reader has cached - this
        # NEVER touches the device itself (only the owner thread does), so it can never
        # collide with a move's reads. ensure_started() is non-blocking, so the first
        # idle read returns immediately even while the device is still opening.
        if self.is_running() or STATE._move_loop_active:
            with self._lock:
                return {"ok": True, "force": self.live.get("force", 0.0),
                        "position": self.live.get("position", STATE.position_mm),
                        "simulated": self.live.get("simulated", True)}
        if os.environ.get("FORCE_SIM"):
            return {"ok": True, "force": 0.0, "position": STATE.position_mm, "simulated": True}
        READER.ensure_started()
        if READER.real_in_use():
            raw = self._read_force(READER, 0.0)      # cached value from the owner thread
            simulated = (STATE.axis is None)
        else:
            raw = self._read_force(None, 0.0)        # no device yet / failed: simulated
            simulated = True
        # absolute force vs the resting baseline (captured at home), same reference the
        # manual force moves use, so the idle reading lines up with the move readings.
        if self._manual_baseline is None or abs(STATE.position_mm - HOME_MM) < 0.1:
            self._manual_baseline = raw
        force = abs(raw - self._manual_baseline)
        return {"ok": True, "force": round(force, 4), "position": round(STATE.position_mm, 4),
                "simulated": simulated}

    def _run(self, run_number, test_folder, surface_area_mm2, redo_of=None, reason=None):
        axis = STATE.axis                 # None when the Zaber is simulated
        futek = _open_futek()             # None when the FUTEK is simulated
        simulated = (axis is None) or (futek is None)
        descend = SIM_DESCEND_MM_S if simulated else REAL_DESCEND_MM_S
        ascend = SIM_ASCEND_MM_S if simulated else REAL_ASCEND_MM_S

        self._set(status="running", run=run_number, simulated=simulated,
                  force=0.0, samples=0, message="", position=HOME_MM, disconnect=False, safety_stop=False)

        readings = []   # (index, force_N, time_s)
        trace = []      # [time, force] for the dense (100 Hz) live force graph
        t0 = time.time()
        idx = 0
        prev_force = None

        def record(stage_force, spike_limit):
            nonlocal idx, prev_force
            if STATE.comms_lost:
                raise ZaberDisconnect()
            # Callers pass the tared change (force - start-of-press baseline). Take
            # the magnitude so a load cell of either polarity reads positive during
            # compression - this is the single place the live/recorded force is made
            # positive, AFTER the baseline has been removed.
            stage_force = abs(stage_force)
            # force-spike / over-force protection: a sudden jump (real contact/jam)
            # or any reading past the hard ceiling stops the run for safety. The
            # spike cutoff scales with the move speed; the smooth sim spring never
            # trips this.
            if (prev_force is not None and abs(stage_force - prev_force) > spike_limit) or stage_force > FORCE_CEILING_N:
                raise ForceSpikeStop()
            prev_force = stage_force
            # simulated runs use a deterministic 100 Hz clock so the time axis is
            # perfectly uniform (10 ms apart); real runs use the wall clock, which
            # follows the real FUTEK cadence.
            t = idx * SAMPLE_DT if simulated else (time.time() - t0)
            idx += 1
            readings.append((idx, stage_force, t))
            trace.append([round(t, 4), round(stage_force, 4)])
            fields = dict(force=stage_force, position=STATE.position_mm, elapsed=t, samples=idx)
            # ship the dense waveform a few times per UI poll for a smooth 100 Hz graph.
            if idx % 5 == 0:
                fields["trace"] = list(trace)
            self._set(**fields)

        try:
            # --- gap-set move toward the sensor (force-monitored) ---
            STATE._move_loop_active = True   # this loop owns the serial port now
            self._home(axis)             # start every press from the 17 mm baseline
            self._approach_move(axis)
            start_pos = STATE.position_mm
            depth = 0.0

            # --- descend until force reaches the limit ---
            if axis is not None:
                from zaber_motion import Units
                try:
                    axis.move_velocity(descend, Units.VELOCITY_MILLIMETRES_PER_SECOND)
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
                              message=f"Run {run_number} paused - repeat this run.")
                    return

                if axis is None:
                    depth += descend * SAMPLE_DT
                    STATE.position_mm = start_pos + depth
                else:
                    STATE._read_position()
                    depth = max(0.0, STATE.position_mm - start_pos)
                force = self._read_force(futek, depth)
                if init_force is None:
                    init_force = force
                stage = force - init_force
                record(stage, self._spike_limit(descend * SAMPLE_DT))
                if stage >= UPPER_LIMIT_N:
                    self._stop_axis(axis)
                    break
                # travel safety: never drive into the actuator's mechanical end stop.
                if self._at_travel_limit():
                    self._stop_axis(axis); self._home(axis)
                    self._set(status="error", safety_stop=True, position=HOME_MM, trace=list(trace),
                              message="Actuator reached its travel limit. Run stopped for safety.")
                    return
                time.sleep(SAMPLE_DT)

            # --- retract back to the start position ---
            if axis is not None:
                from zaber_motion import Units
                try:
                    axis.move_velocity(-ascend, Units.VELOCITY_MILLIMETRES_PER_SECOND)
                except Exception:
                    pass
            while True:
                if STATE.stop_requested:
                    self._stop_axis(axis); self._home(axis)
                    self._set(status="stopped", message="Run stopped.", position=HOME_MM)
                    return
                # honor Pause during the retract too (not just the descend), else a
                # pause here stops the motor but the loop spins on with status
                # "running" and the run never ends.
                if STATE.pause_requested:
                    self._stop_axis(axis); self._home(axis)
                    STATE.pause_requested = False
                    self._set(status="paused", position=HOME_MM,
                              message=f"Run {run_number} paused - repeat this run.")
                    return
                if axis is None:
                    depth -= ascend * SAMPLE_DT
                    STATE.position_mm = start_pos + depth
                else:
                    STATE._read_position()
                force = self._read_force(futek, max(0.0, depth))
                record(force - (init_force or 0.0), self._spike_limit(ascend * SAMPLE_DT))
                if STATE.position_mm <= start_pos:
                    self._stop_axis(axis)
                    break
                time.sleep(SAMPLE_DT)

            self._home(axis)
            fut_path = self._write_fut(test_folder, run_number, readings)
            # Capacitance is NEVER fabricated. The CAP/ folder is the only source of
            # truth: the operator drops the real capacitance file(s) in manually (and
            # the computer will record them itself later). The analysis auto-detects
            # whatever real CAP is present, and shows empty capacitance graphs when
            # none has been added - no synthetic data ever reaches the analysis plots.
            # (Previously, a pure-software demo machine synthesized CAP here; that was
            # removed so the perform-analysis graphs only ever show real data.)
            # never overwrite: record this run (and the redo reason) in the log.
            import run_log
            run_log.record_run(test_folder, run_number, redo_of=redo_of, reason=reason)
            self._set(status="completed", position=HOME_MM, redo_of=redo_of, trace=list(trace),
                      message=f"Run {run_number} complete - {len(readings)} samples saved to {fut_path.name}.")
        except ForceSpikeStop:
            self._stop_axis(axis)
            self._home(axis)
            self._set(status="error", safety_stop=True, position=HOME_MM,
                      message="Force spike detected. Motion stopped for safety.")
        except ZaberDisconnect:
            self._zaber_disconnect_safe_state()
        except Exception as exc:
            # any unexpected failure: stop and home the actuator so it is never
            # left moving or in an unknown state when the UI re-enables Start,
            # then surface the real error so the cause is visible.
            self._stop_axis(axis)
            self._home(axis)
            self._set(status="error", position=HOME_MM,
                      message=f"Run failed: {exc}")
        finally:
            STATE._move_loop_active = False   # release the serial port
            # the cached FUTEK stays open between operations (reopening it costs many
            # seconds); it is only dropped on a read failure / disconnect.

    # -- the Fuji-film calibration press ------------------------------------

    def start_fuji_film(self, surface_area_mm2=325.0, extrusion_mm=None):
        if self.is_running():
            return False, "A test is already in progress."
        STATE.stop_requested = False
        STATE.pause_requested = False
        STATE.comms_lost = False
        # the operator sets the extrusion distance in the calibration window; clamp it
        # to the safety ceiling, and fall back to the default gap if none was sent.
        if extrusion_mm is None:
            extrusion = GAP_MM
        else:
            extrusion = max(0.0, min(float(extrusion_mm), FUJI_EXTRUSION_MAX_MM))
        # "waiting" until the run thread is past the load-cell init and about to move
        # (the thread flips it to "running"); the UI shows a wait pill meanwhile.
        self._set(status="waiting", force=0.0, samples=0,
                  message="initializing actuator and load cell - please wait",
                  position=HOME_MM, disconnect=False, safety_stop=False)
        self._thread = threading.Thread(
            target=self._run_fuji_film, args=(float(surface_area_mm2), extrusion), daemon=True)
        self._thread.start()
        return True, "Fuji Film Test started."

    def _run_fuji_film(self, surface_area_mm2, extrusion_mm=None):
        # press down until the load cell reaches the calibration target (20 N),
        # streaming live force; spike/over-force and a max-travel timeout keep it
        # safe. No data is saved - this is a calibration press.
        axis = STATE.axis
        futek = _open_futek()
        simulated = (axis is None) or (futek is None)
        descend = SIM_DESCEND_MM_S if simulated else REAL_DESCEND_MM_S
        self._set(status="running", run=0, force=0.0, samples=0, message="",
                  position=HOME_MM, simulated=simulated, trace=[], disconnect=False, safety_stop=False)
        trace = []
        t0 = time.time()
        idx = 0
        prev_force = None
        try:
            STATE._move_loop_active = True   # this loop owns the serial port now
            self._home(axis)             # start every press from the 17 mm baseline
            self._approach_move(axis, extrusion_mm)   # extrude the operator-set distance
            start_pos = STATE.position_mm
            depth = 0.0
            if axis is not None:
                from zaber_motion import Units
                try:
                    axis.move_velocity(descend, Units.VELOCITY_MILLIMETRES_PER_SECOND)
                except Exception:
                    pass
            init_force = None
            while True:
                if STATE.stop_requested:
                    # calibration pause: stop in place, do NOT home/reset.
                    self._stop_axis(axis)
                    self._set(status="stopped", position=STATE.position_mm,
                              message="Fuji Film Test paused - actuator held in place.")
                    return
                if axis is None:
                    depth += descend * SAMPLE_DT
                    STATE.position_mm = start_pos + depth
                else:
                    STATE._read_position()
                    depth = max(0.0, STATE.position_mm - start_pos)
                force = self._read_force(futek, depth)
                if init_force is None:
                    init_force = force
                # tare to baseline, then magnitude (positive for either cell polarity)
                stage = abs(force - init_force)
                if STATE.comms_lost:
                    raise ZaberDisconnect()
                if futek is not None and not simulated and futek.lost():
                    raise FutekDisconnect()
                if (prev_force is not None and abs(stage - prev_force) > self._spike_limit(descend * SAMPLE_DT)) or stage > FORCE_CEILING_N:
                    raise ForceSpikeStop()
                prev_force = stage
                t = idx * SAMPLE_DT if simulated else (time.time() - t0)
                idx += 1
                trace.append([round(t, 4), round(stage, 4)])
                fields = dict(force=stage, position=STATE.position_mm, elapsed=t, samples=idx)
                if idx % 5 == 0:
                    fields["trace"] = list(trace)
                self._set(**fields)
                if stage >= FUJI_TARGET_N:
                    self._stop_axis(axis)
                    break
                if self._at_travel_limit():
                    self._stop_axis(axis); self._home(axis)
                    self._set(status="error", safety_stop=True, position=HOME_MM, trace=list(trace),
                              message="Target force not reached. Test stopped for safety.")
                    return
                time.sleep(SAMPLE_DT)
            self._home(axis)
            self._set(status="completed", position=HOME_MM, trace=list(trace),
                      message=f"Fuji Film Test completed successfully - reached {FUJI_TARGET_N:.0f} N target.")
        except ForceSpikeStop:
            self._stop_axis(axis); self._home(axis)
            self._set(status="error", safety_stop=True, position=HOME_MM,
                      message="Force spike detected. Motion stopped for safety.")
        except ZaberDisconnect:
            self._zaber_disconnect_safe_state()
        except FutekDisconnect:
            self._stop_axis(axis); self._home(axis)
            self._set(status="error", position=HOME_MM,
                      message="Load cell disconnected during calibration.")
        except Exception as exc:
            self._set(status="error", message=f"Fuji Film Test failed: {exc}")
        finally:
            STATE._move_loop_active = False   # release the serial port
            # the cached FUTEK stays open between operations (reopening it costs many
            # seconds); it is only dropped on a read failure / disconnect.

    # -- the fatigue (cyclical) loop ----------------------------------------

    def start_shear(self):
        # live shear-force capture. The shear test does NOT drive the actuator (the
        # operator applies shear by hand); this only reads the load cell and streams
        # force to the UI, so it just needs the FUTEK, not the Zaber.
        if self.is_running():
            return False, "A test is already in progress."
        STATE.stop_requested = False
        STATE.pause_requested = False
        self._set(status="waiting", force=0.0, elapsed=0.0, samples=0, trace=[],
                  disconnect=False, safety_stop=False, message="initializing load cell - please wait")
        self._thread = threading.Thread(target=self._run_shear, daemon=True)
        self._thread.start()
        return True, "Shear test started."

    def _run_shear(self):
        futek = _open_futek()
        if _futek_init_failed(futek):
            # a real load cell was expected but it did not come up - surface the
            # connect-the-FUTEK guidance instead of starting a dead capture.
            print("[shear] load cell failed to initialize")
            self._set(status="error", message=FUTEK_INIT_FAIL_MSG)
            return
        simulated = futek is None or _futek_kind(futek) != "REAL"
        print(f"[shear] starting live shear read - load cell = {_futek_kind(futek)}")
        t0 = time.time()
        readings = []          # full [time, force] series for analysis
        trace = []             # recent window for the live graph (dense)
        init_force = None
        force = 0.0
        idx = 0
        self._set(status="running", simulated=simulated, force=0.0, elapsed=0.0, samples=0,
                  trace=[], disconnect=False, safety_stop=False, message="")
        try:
            while not STATE.stop_requested:
                # mid-recording disconnect: if a REAL load cell stops responding while
                # capturing, stop now and invalidate the capture (mirrors the actuator's
                # comms_lost mid-run detection in the fatigue/EM loops).
                if futek is not None and futek.lost():
                    print("[shear] load cell disconnected during recording - invalidating capture")
                    self._set(status="error", disconnect=True,
                              message="Load cell disconnected during recording. Capture invalidated")
                    return
                f = self._read_force(futek, 0.0)
                if init_force is None:
                    init_force = f
                # tare to the start-of-test baseline, then magnitude (positive for a
                # load cell of either polarity), same convention as the press tests.
                force = abs(f - init_force)
                t = time.time() - t0
                idx += 1
                readings.append([round(t, 4), round(force, 4)])
                trace.append([round(t, 4), round(force, 4)])
                if len(trace) > CYC_TRACE_WINDOW:
                    del trace[0:len(trace) - CYC_TRACE_WINDOW]
                fields = dict(force=force, elapsed=t, samples=idx)
                if idx % 5 == 0:           # throttle the trace payload (like fatigue)
                    fields["trace"] = list(trace)
                self._set(**fields)
                time.sleep(SAMPLE_DT)
            print(f"[shear] stopped after {idx} samples ({(time.time() - t0):.1f} s)")
            # send the FULL series on stop so the analysis has every reading, not just
            # the rolling live window.
            self._set(status="stopped", force=force, elapsed=time.time() - t0, samples=idx,
                      trace=readings, message=f"Shear test stopped. {idx} samples captured.")
        except Exception as exc:
            print(f"[shear] failed: {exc}")
            self._set(status="error", message=f"Shear test failed: {exc}")

    def start_cyclical(self, params, test_folder, surface_area_mm2=325.0):
        if self.is_running():
            return False, "A test is already in progress."
        STATE.stop_requested = False
        STATE.pause_requested = False
        STATE.comms_lost = False
        # "waiting" until the run thread is past the load-cell init and about to move
        # (the thread flips it to "running"); the UI shows a wait pill meanwhile.
        self._set(status="waiting", force=0.0, samples=0,
                  message="initializing actuator and load cell - please wait",
                  position=HOME_MM, disconnect=False, safety_stop=False)
        self._thread = threading.Thread(
            target=self._run_cyclical,
            args=(dict(params), Path(test_folder), float(surface_area_mm2)),
            daemon=True,
        )
        self._thread.start()
        return True, "Fatigue test started."

    @staticmethod
    def _inverse_press(force):
        # depth of compression (mm past the free gap) that the sim spring model
        # needs to produce `force` N. Inverse of SIM_STIFFNESS*press*(1+0.06*press).
        if force <= 0:
            return 0.0
        k = SIM_STIFFNESS_N_MM
        a = 0.06 * k
        return (-k + math.sqrt(k * k + 4.0 * a * force)) / (2.0 * a)

    def _run_cyclical(self, params, test_folder, surface_area_mm2):
        # Drives a true force WAVEFORM (sine or square) between the lower/upper
        # bounds at the configured frequency, for N cycles. In simulation the
        # recorded force IS the target waveform (a clean sine); on the real rig the
        # actuator position is driven to track the waveform while the FUTEK is read.
        axis = STATE.axis
        print("[fatigue] starting fatigue (cyclical) run - opening the load cell now")
        if axis is None:
            print("[fatigue] no Zaber connected -> simulated run, load cell not opened")
        futek = _open_futek() if axis is not None else None
        if axis is not None and _futek_init_failed(futek):
            # a real load cell was expected (the actuator is connected on a real rig) but
            # it did not come up - do not run a fatigue test with no force feedback.
            print("[fatigue] load cell failed to initialize")
            self._set(status="error", message=FUTEK_INIT_FAIL_MSG)
            return
        from futek_cli import MockFUTEKDeviceCLI
        real_run = (axis is not None) and (futek is not None) and not isinstance(futek, MockFUTEKDeviceCLI)
        force_futek = futek if real_run else None
        print(f"[fatigue] real_run={real_run} -> {'reading the REAL load cell' if real_run else 'using simulated force'}")
        simulated = not real_run
        lower = float(params.get("lower_force", 1.0))
        upper = float(params.get("upper_force", 20.0))
        total_cycles = max(1, int(params.get("cycle_count", 1)))
        frequency = max(0.01, float(params.get("frequency", 1.0)))
        waveform = str(params.get("waveform", "Sine")).lower()
        period = 1.0 / frequency
        total_time = total_cycles * period

        def cyclical_shape(phase):
            # Shape of one fatigue cycle on a normalized phase 0..1, returned on a
            # 0..1 scale (0 = lower bound, 1 = upper bound). Mirrors cyclicalShape()
            # in fatigue.js exactly so the live preview matches what the actuator
            # actually does. Every shape starts and ends near the lower bound.
            if waveform.startswith("square"):
                return 1.0 if phase < 0.5 else 0.0
            if waveform.startswith("triangle"):
                return phase / 0.5 if phase < 0.5 else (1.0 - phase) / 0.5
            if waveform.startswith("sawtooth"):
                return phase
            if waveform.startswith("blood"):
                # arterial pulse: sharp systolic peak, a smaller dicrotic wave, then
                # a slow diastolic decay back to the lower bound.
                systolic = math.exp(-(((phase - 0.18) / 0.085) ** 2))
                dicrotic = 0.45 * math.exp(-(((phase - 0.42) / 0.13) ** 2))
                return (systolic + dicrotic) / 1.015
            # sine (default): smooth press/release, starts low, peaks at upper.
            return 0.5 - 0.5 * math.cos(2.0 * math.pi * phase)

        def target_force(t):
            # one full cycle per period: starts at the lower bound, peaks at upper.
            return lower + (upper - lower) * cyclical_shape((t * frequency) % 1.0)

        self._set(status="running", run=0, cycle=0, total_cycles=total_cycles,
                  simulated=simulated, force=0.0, samples=0, message="", position=HOME_MM,
                  trace=[], disconnect=False, safety_stop=False)

        readings = []   # (index, force_N, time_s, cycle)
        trace = []      # recent [time, force] for the live waveform (dense, 100 Hz)
        t0 = time.time()
        idx = 0
        prev_force = None
        # A spike means the force jumped FAR more than this waveform can legitimately
        # command in one 100 Hz step. The biggest legitimate step is the full
        # lower->upper swing (a square wave's edge), so allow that plus a noise margin.
        # Real over-force is still caught by FORCE_CEILING_N and the travel limit. The
        # old threshold assumed a clean sine and false-tripped on square waves, on real
        # load-cell noise, and on the actuator's discrete catch-up moves.
        spike_threshold = max(SPIKE_FLOOR_N, abs(upper - lower) + 5.0)

        def record(force_value, cycle):
            nonlocal idx, prev_force
            if STATE.comms_lost:
                raise ZaberDisconnect()
            if force_futek is not None and force_futek.lost():
                raise FutekDisconnect()
            if (prev_force is not None and abs(force_value - prev_force) > spike_threshold) or force_value > FORCE_CEILING_N:
                raise ForceSpikeStop()
            prev_force = force_value
            t = idx * SAMPLE_DT if simulated else (time.time() - t0)
            idx += 1
            readings.append((idx, force_value, t, cycle))
            trace.append([round(t, 4), round(force_value, 4)])
            if len(trace) > CYC_TRACE_WINDOW:
                del trace[0:len(trace) - CYC_TRACE_WINDOW]
            fields = dict(force=force_value, position=STATE.position_mm, elapsed=t,
                          samples=idx, cycle=cycle)
            if idx % 5 == 0:
                fields["trace"] = list(trace)
            self._set(**fields)

        Units = None
        if axis is not None:
            from zaber_motion import Units as _Units
            Units = _Units

        try:
            # approach the sensor (same force-monitored gap move as the EM press).
            STATE._move_loop_active = True   # this loop owns the serial port now
            self._home(axis)             # start every press from the 17 mm baseline
            self._approach_move(axis)
            start_pos = STATE.position_mm

            # depth range that maps to [lower, upper] force.
            shallow_depth = SIM_FREE_GAP_MM + self._inverse_press(max(0.0, lower))
            deep_depth = SIM_FREE_GAP_MM + self._inverse_press(max(0.0, upper))
            cal_init = 0.0

            if real_run:
                # calibrate the real depth range: slow press to the upper force,
                # capturing the depth at the lower and upper bounds.
                try:
                    axis.move_velocity(REAL_CYC_DESCEND_MM_S, Units.VELOCITY_MILLIMETRES_PER_SECOND)
                except Exception:
                    pass
                init_force = None
                got_shallow = None
                got_deep = None
                cal_prev = None
                while not STATE.stop_requested:
                    # the calibration press drives into the sensor just like the
                    # run itself, so it gets the same protection: abort on a comms
                    # loss, a sudden force jump, or a reading past the hard ceiling.
                    if STATE.comms_lost:
                        raise ZaberDisconnect()
                    if force_futek is not None and force_futek.lost():
                        raise FutekDisconnect()
                    STATE._read_position()
                    d = max(0.0, STATE.position_mm - start_pos)
                    f = self._read_force(force_futek, d)
                    if init_force is None:
                        init_force = f
                    # tare to baseline, then magnitude (positive for either polarity)
                    stage = abs(f - init_force)
                    if (cal_prev is not None and abs(stage - cal_prev) > self._spike_limit(REAL_CYC_DESCEND_MM_S * SAMPLE_DT)) or stage > FORCE_CEILING_N:
                        raise ForceSpikeStop()
                    cal_prev = stage
                    # travel safety: never drive into the actuator's mechanical end stop.
                    if self._at_travel_limit():
                        self._stop_axis(axis); self._home(axis)
                        self._set(status="error", safety_stop=True, position=HOME_MM,
                                  message="Actuator reached its travel limit. Fatigue test stopped for safety.")
                        return
                    if got_shallow is None and stage >= lower:
                        got_shallow = d
                    if stage >= upper:
                        got_deep = d
                        break
                    time.sleep(SAMPLE_DT)
                self._stop_axis(axis)
                cal_init = init_force or 0.0
                if got_deep is not None:
                    deep_depth = got_deep
                shallow_depth = got_shallow if got_shallow is not None else max(0.0, deep_depth - 1.0)

            # generate the waveform for the full duration, sampled at 100 Hz and
            # paced in real time so the live graph scrolls smoothly.
            while not STATE.stop_requested:
                t = idx * SAMPLE_DT
                if t >= total_time:
                    break
                f_t = target_force(t)
                cycle = min(total_cycles, int(t * frequency) + 1)
                if simulated:
                    # the recorded force IS the target -> an exact sine/square.
                    STATE.position_mm = start_pos + (SIM_FREE_GAP_MM + self._inverse_press(max(0.0, f_t)))
                    record(f_t, cycle)
                else:
                    # drive the actuator position to track the target waveform.
                    span = (upper - lower) or 1.0
                    frac = max(0.0, min(1.0, (f_t - lower) / span))
                    target_depth = shallow_depth + frac * (deep_depth - shallow_depth)
                    try:
                        axis.move_absolute(start_pos + target_depth, _mm_unit(), wait_until_idle=False)
                    except Exception:
                        pass
                    STATE._read_position()
                    d = max(0.0, STATE.position_mm - start_pos)
                    record(self._read_force(force_futek, d) - cal_init, cycle)
                self._set(cycle=cycle)
                time.sleep(SAMPLE_DT)

            if STATE.stop_requested:
                # Stop was pressed: halt the actuator in place RIGHT NOW so it stops
                # promptly. /api/stop only set the flag (it must not touch the serial
                # port while this loop owns it); without this explicit stop the device
                # would keep running its queued 100 Hz waveform moves before homing,
                # which is the lag felt after clicking Stop. Then home.
                print("[fatigue] stop requested - halting actuator immediately, then homing")
                self._stop_axis(axis)
                # status "stopping" is ignored by the poller, so the frontend's
                # "returning home" pill stays put instead of flipping back to RUNNING
                # while the actuator homes.
                self._set(status="stopping", message="stopping - actuator halted, returning to home...")
            self._home(axis)
            self._write_cyclical(test_folder, readings)
            self._write_cyclical_graph(test_folder, readings)
            done_cycles = readings[-1][3] if readings else 0
            forces = [r[1] for r in readings]
            self._write_cyclical_stats(test_folder, {
                "Waveform": params.get("waveform", "Sine"),
                "Frequency (Hz)": frequency,
                "Lower Bound (N)": lower,
                "Upper Bound (N)": upper,
                "Target Cycles": total_cycles,
                "Completed Cycles": done_cycles,
                "Peak Force (N)": round(max(forces), 4) if forces else 0.0,
                "Min Force (N)": round(min(forces), 4) if forces else 0.0,
                "Mean Force (N)": round(sum(forces) / len(forces), 4) if forces else 0.0,
                "Duration (s)": round(readings[-1][2], 3) if readings else 0.0,
                "Samples": len(readings),
            })
            if STATE.stop_requested:
                self._set(status="stopped", position=HOME_MM, trace=list(trace),
                          message=f"Fatigue test stopped after {done_cycles} cycle(s).")
            else:
                self._set(status="completed", position=HOME_MM, trace=list(trace),
                          message=f"Fatigue test complete - {total_cycles} cycle(s).")
        except ForceSpikeStop:
            self._stop_axis(axis)
            self._home(axis)
            self._write_cyclical_graph(test_folder, readings)
            self._set(status="error", safety_stop=True, position=HOME_MM,
                      message="Force spike detected. Fatigue test stopped for safety.")
        except ZaberDisconnect:
            self._zaber_disconnect_safe_state()
        except FutekDisconnect:
            # the load cell dropped out mid-run: stop the actuator, invalidate the run.
            self._stop_axis(axis)
            self._home(axis)
            self._set(status="error", disconnect=True, position=HOME_MM,
                      message="Load cell disconnected during the fatigue test. Run invalidated")
        except Exception as exc:
            self._set(status="error", message=f"Fatigue test failed: {exc}")
        finally:
            STATE._move_loop_active = False   # release the serial port
            # the cached FUTEK stays open between operations (reopening it costs many
            # seconds); it is only dropped on a read failure / disconnect.

    def _write_cyclical(self, test_folder, readings):
        # save the full per-sample fatigue stream (Index, Load Cell, Time, Cycle).
        test_dir = Path(test_folder)
        test_dir.mkdir(parents=True, exist_ok=True)
        path = test_dir / "Fatigue_Data.xlsx"
        try:
            import xlsxwriter
            workbook = xlsxwriter.Workbook(str(path))
            worksheet = workbook.add_worksheet("Fatigue")
            for col, head in enumerate(("Index", "Load Cell", "Time", "Cycle")):
                worksheet.write(0, col, head)
            for row, (index, force, t, cycle) in enumerate(readings, start=1):
                worksheet.write(row, 0, index)
                worksheet.write(row, 1, force)
                worksheet.write(row, 2, t)
                worksheet.write(row, 3, cycle)
            workbook.close()
            return path
        except Exception:
            import csv
            path = test_dir / "Fatigue_Data.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Index", "Load Cell", "Time", "Cycle"])
                for index, force, t, cycle in readings:
                    writer.writerow([index, round(force, 5), round(t, 5), cycle])
            return path

    def _write_cyclical_stats(self, test_folder, stats):
        # save a small fatigue summary (not the full per-sample stream).
        test_dir = Path(test_folder)
        test_dir.mkdir(parents=True, exist_ok=True)
        path = test_dir / "Fatigue_Stats.xlsx"
        try:
            import xlsxwriter
            workbook = xlsxwriter.Workbook(str(path))
            worksheet = workbook.add_worksheet("Fatigue Stats")
            worksheet.write(0, 0, "Metric")
            worksheet.write(0, 1, "Value")
            for row, (key, val) in enumerate(stats.items(), start=1):
                worksheet.write(row, 0, key)
                worksheet.write(row, 1, val)
            workbook.close()
            return path
        except Exception:
            import csv
            path = test_dir / "Fatigue_Stats.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Metric", "Value"])
                for key, val in stats.items():
                    writer.writerow([key, val])
            return path

    def _write_cyclical_graph(self, test_folder, readings):
        # save the fatigue Force-vs-Time waveform as an image in the test folder.
        if not readings:
            return None
        try:
            import matplotlib
            matplotlib.use("Agg")  # headless / thread-safe
            import matplotlib.pyplot as plt
        except Exception:
            return None
        # downsample so a long (multi-hour) run still plots quickly.
        step = max(1, len(readings) // 6000)
        times = [r[2] for r in readings[::step]]
        forces = [r[1] for r in readings[::step]]
        test_dir = Path(test_folder)
        test_dir.mkdir(parents=True, exist_ok=True)
        path = test_dir / "Fatigue_Force_vs_Time.png"
        try:
            fig, ax = plt.subplots(figsize=(11, 4.5))
            ax.plot(times, forces, color="#3f73e6", linewidth=1.0)
            ax.set_xlabel("Time (s)")
            ax.set_ylabel("Force (N)")
            ax.set_title("Fatigue - Force vs Time")
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            fig.savefig(str(path), dpi=130)
            plt.close(fig)
            return path
        except Exception:
            return None

    def _stop_axis(self, axis):
        if axis is not None:
            try:
                axis.stop()
            except Exception:
                pass

    def _zaber_disconnect_safe_state(self):
        # Safe state after a Zaber comms loss: the actuator position is UNKNOWN, so
        # do NOT command a blind home (it could drive into the fixture). Best-effort
        # stop, mark the connection dead so the next run must re-initialize, report
        # the error. The in-progress run is discarded (no data saved).
        try:
            if STATE.axis is not None:
                STATE.axis.stop()
        except Exception:
            pass
        STATE.cli = None
        STATE.simulated = True
        STATE.connection_lost = True
        # disconnect=True lets the UI tell this apart from a force-spike stop: it
        # hard-blocks Start and starts the live reconnect watcher.
        self._set(status="error", disconnect=True,
                  message="Actuator connection lost. Check the cable before continuing.")

    def _write_cap(self, test_folder, run_number, readings, surface_area_mm2):
        # synthetic capacitance for a simulated run: eight channels, each a sigmoid
        # response vs pressure (force / area), so the real EM analysis engine has
        # CAP+FUT for every run and produces its full figures/interactive plots.
        import csv
        cap_dir = Path(test_folder) / "CAP"
        cap_dir.mkdir(parents=True, exist_ok=True)
        path = cap_dir / f"Run {run_number}.csv"
        area_m2 = max(1e-9, float(surface_area_mm2) * 1e-6)
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Time", "Unused1", "Unused2", "Unused3", "Unused4",
                             "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "CH8"])
            for index, force, t in readings:
                pressure_kpa = max(0.0, force) / area_m2 / 1000.0
                channels = []
                for ch in range(8):
                    baseline = 18.0 + ch * 0.4
                    span = 2.6 + 0.18 * ch
                    response = span / (1.0 + math.exp(-(pressure_kpa - 25.0) / 6.0))
                    jitter = 0.012 * math.sin(t * 7.0 + ch)
                    channels.append(round(baseline + response + jitter, 5))
                writer.writerow([round(t, 5), "", "", "", "", *channels])
        return path

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
