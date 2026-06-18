# Zaber hardware control + the load-cell force polarity helper.
#
# pen the serial port with zaber_motion, detect the device, grab axis 1, and
# unpark it. Real moves are issued on that axis with millimetre units.
#
# Port enumeration listed
# serial.tools.list_ports.comports().
#
# If no stage answers, or zaber-motion / pyserial are not installed (e.g. on the
# dev Mac), every method falls back to a simulated axis so the browser preview
# stays usable. Simulated responses are prefixed with [sim].

from zaber_cli import ZaberCLI  # importable: config.py puts the repo root on sys.path

HOME_MM = 17.0


def list_ports():
    # enumerate serial ports the same way emilio's comport combobox did.
    try:
        import serial.tools.list_ports
    except ImportError:
        return []
    try:
        return [port.device for port in serial.tools.list_ports.comports()]
    except Exception:
        return []


def _mm_unit():
    # imported lazily so the preview still runs without zaber-motion installed.
    from zaber_motion import Units

    return Units.LENGTH_MILLIMETRES


class HardwareState:
    # holds the live Zaber connection when one is available, and a simulated
    # position otherwise. shared as a single STATE instance across requests.
    def __init__(self):
        self.position_mm = HOME_MM
        self.stop_requested = False
        self.pause_requested = False
        self.cli = None          # live ZaberCLI when connected, else None (simulated)
        self.comport = None
        self.simulated = True
        self.comms_lost = False  # set True after repeated live read failures (disconnect)
        self._read_fail_count = 0  # consecutive position-read failures (3 = real loss)
        self._move_loop_active = False  # True while a jog/run loop owns the serial port
        # set True by the run engine's safe state after a real comms loss, and only
        # cleared by a SUCCESSFUL reconnect. Lets the Start gate hard-block on a real
        # rig that lost its actuator (distinct from a dev machine with no hardware).
        self.connection_lost = False

    @property
    def axis(self):
        return self.cli.getAxis() if self.cli is not None else None

    def _read_position(self):
        # heartbeat read during a run. A failure on a live axis means comms were
        # lost (cable unplugged / stage powered off); flag it so the run loop can
        # enter its safe state. The position is then UNKNOWN (we keep the last value).
        axis = self.axis
        if axis is None:
            return self.position_mm
        try:
            self.position_mm = float(axis.get_position(_mm_unit()))
            self._read_fail_count = 0
        except Exception:
            # one failed read is usually transient (the port was busy mid-move), not
            # a real disconnect. Only flag comms_lost after several in a row, so a
            # blip doesn't trigger the disconnect+reconnect cascade (which then hits
            # the still-open port with SerialPortBusyException).
            self._read_fail_count += 1
            if self._read_fail_count >= 3:
                self.comms_lost = True
        return self.position_mm

    def _set_default_speed(self, mm_s):
        # set the actuator's default move speed (its "maxspeed" setting). Moves that
        # don't specify a velocity (home, the gap-set approach, manual jogs) use this;
        # the stock default is ~7.26 mm/s, which is too fast for the bench, so cap it.
        axis = self.axis
        if axis is None:
            return
        try:
            from zaber_motion import Units
            axis.settings.set("maxspeed", float(mm_s), Units.VELOCITY_MILLIMETRES_PER_SECOND)
        except Exception:
            pass

    def _home_reference(self):
        # On connect, move to the working baseline (17 mm) - the retracted,
        # load-cell-safe position - and rely on the actuator's encoder for absolute
        # position (which the GUI reads via _read_position). We do NOT axis.home()
        # here: on this fixture the device's home sensor is past the baseline, into
        # the load cell, so a real homing would press the sensor into its limit.
        axis = self.axis
        if axis is None:
            return False
        try:
            axis.move_absolute(HOME_MM, _mm_unit(), wait_until_idle=True)
            return True
        except Exception:
            self._read_position()   # re-sync if the move was interrupted
            return False

    def connect_zaber(self, comport, set_reference=True):
        # connect on port selection, like emilio's trace_comport. Falls back to
        # a simulated stage (still returns ok=True) when no hardware responds.
        # set_reference is kept for call compatibility but is no longer used: the
        # actuator keeps a correct absolute position across power cycles, so connect
        # never redefines the reference (doing so was wrong when connecting away from
        # home). Home is reached by move_absolute(17), not by relabeling the current spot.
        self.stop_requested = False
        self.pause_requested = False
        self.comport = comport

        if self.cli is not None:
            # drop any previous connection before reopening the port.
            try:
                self.cli.disconnect()
            except Exception:
                pass
            self.cli = None

        cli = ZaberCLI()
        reason = None
        try:
            connected = cli.connect(comport) == 1
        except Exception as exc:
            connected = False
            reason = f"{type(exc).__name__}: {exc}"
        if not connected and reason is None:
            # surface the real cause that ZaberCLI.connect recorded.
            reason = getattr(cli, "last_error", None)

        if connected:
            self.cli = cli
            self.simulated = False
            self.comms_lost = False
            self.connection_lost = False
            self._set_default_speed(2.0)   # cap the actuator's default move speed at 2 mm/s
            # Do NOT redefine the reference here. The actuator keeps a correct absolute
            # position across power cycles (it reads ~17 mm when physically retracted at
            # home), so we trust the device's own coordinates and just read them. Setting
            # "current position = 17" on connect was wrong whenever the operator connected
            # while NOT at home: it told the device it was already at 17, so the
            # move-to-17 at the start of each test became a no-op and the press began from
            # the wrong place. Tests now drive to the true 17 mm home with move_absolute.
            self._read_position()
            return {
                "ok": True, "connected": True, "comport": comport,
                "message": f"Connected to Zaber on {comport}. Current position: {self.position_mm:.2f} mm.",
            }

        self.cli = None
        self.simulated = True
        detail = f" ({reason})" if reason else ""
        return {
            "ok": True, "connected": False, "comport": comport,
            "message": f"Couldn't connect to a Zaber on {comport}.{detail} Try a different COM port, or close any other program using it.",
        }

    def try_reconnect(self):
        # used by the live reconnect watcher after a disconnect: if the actuator is
        # already live, report that; otherwise try to reopen the last known port.
        # Success clears connection_lost (inside connect_zaber).
        if self.cli is not None and not self.simulated:
            return {"ok": True, "connected": True, "comport": self.comport,
                    "message": f"Zaber connected on {self.comport}."}
        if not self.comport:
            return {"ok": True, "connected": False, "comport": None,
                    "message": "No COM port has been selected yet."}
        # auto-reconnect must NOT redefine the reference (the actuator may be mid-run,
        # not at the baseline) - keep whatever reference the session already had.
        return self.connect_zaber(self.comport, set_reference=False)

    def move(self, comport, distance):
        # relative jog, matching the gui's incremental move buttons. Blocks until
        # the stage finishes moving (wait_until_idle), then reports the real final
        # position so the UI can update the readout only once the move is done.
        distance = float(distance)
        axis = self.axis
        if axis is not None:
            try:
                axis.move_relative(distance, _mm_unit(), wait_until_idle=True)
                self._read_position()
                return {"ok": True, "position": self.position_mm,
                        "message": f"Moved Zaber axis by {distance:g} mm. Current position: {self.position_mm:.2f} mm."}
            except Exception as exc:
                return {"ok": False, "position": self.position_mm,
                        "message": f"Zaber move failed: {exc}"}
        self.position_mm += distance
        return {"ok": True, "position": self.position_mm,
                "message": f"[sim] Moved simulated Zaber axis by {distance:g} mm. Current position: {self.position_mm:.2f} mm."}

    def home(self, comport):
        # Move to the working baseline (17 mm) - the retracted position, AWAY from
        # the load cell. We deliberately do NOT call axis.home(): on this fixture the
        # device's home sensor sits PAST the baseline, into the load cell, so a real
        # homing presses the cell into its limit (MovementInterruptedException) and
        # could damage it. move_absolute is a device-absolute command using the
        # encoder, not the GUI's tracked guess, so it returns to the true baseline.
        axis = self.axis
        if axis is not None:
            try:
                # if it is already at the baseline, do nothing (no needless move).
                self._read_position()
                if abs(self.position_mm - HOME_MM) < 0.05:
                    return {"ok": True, "position": self.position_mm,
                            "message": f"Already at baseline ({self.position_mm:.2f} mm)."}
                axis.move_absolute(HOME_MM, _mm_unit(), wait_until_idle=True)
                self._read_position()
                return {"ok": True, "position": self.position_mm,
                        "message": f"Moved to baseline. Current position: {self.position_mm:.2f} mm."}
            except Exception as exc:
                # an interrupted/failed move leaves the actuator somewhere unknown;
                # re-read the device's ACTUAL position so the GUI does not keep a
                # stale value (a stale value is what breaks the travel limits).
                self._read_position()
                return {"ok": False, "position": self.position_mm,
                        "message": f"Zaber home failed: {exc}. Re-synced position to {self.position_mm:.2f} mm."}
        self.position_mm = HOME_MM
        return {"ok": True, "position": self.position_mm,
                "message": f"[sim] Moved simulated Zaber axis to home/default position: {HOME_MM:g} mm."}

    def set_baseline_position(self, mm=None):
        # Define the actuator's CURRENT physical position as a known value (the 17 mm
        # baseline by default). Use this when the device's absolute reference is not
        # established: the operator places the actuator at the known baseline, then
        # this sets the reference there (Zaber "set pos") WITHOUT homing into the
        # load cell. After this, get_position and the travel limits are correct.
        target = float(mm) if mm is not None else HOME_MM
        axis = self.axis
        if axis is None:
            self.position_mm = target
            return {"ok": True, "position": target,
                    "message": f"[sim] Baseline reference set to {target:g} mm."}
        try:
            from zaber_motion import Units
            native = axis.settings.convert_to_native_units("pos", target, Units.LENGTH_MILLIMETRES)
            axis.generic_command(f"set pos {int(round(native))}")
            self._read_position()
            return {"ok": True, "position": self.position_mm,
                    "message": f"Baseline set: the actuator's current position is now {self.position_mm:.2f} mm."}
        except Exception as exc:
            return {"ok": False, "position": self.position_mm,
                    "message": f"Could not set baseline reference: {exc}"}

    def stop(self):
        self.stop_requested = True
        axis = self.axis
        # During a jog/run the move loop owns the serial connection and stops the
        # axis itself when it sees stop_requested. Calling axis.stop() here too would
        # have TWO threads using the serial port at once, which corrupts it and looks
        # like a disconnect. So only touch the port directly when no loop is running.
        if axis is not None and not self._move_loop_active:
            try:
                axis.stop()
                return True, "Zaber stop sent."
            except Exception as exc:
                return False, f"Zaber stop failed: {exc}"
        return True, "Stop requested."

    def pause(self, comport="COM3"):
        self.pause_requested = True
        axis = self.axis
        # same as stop(): let the active move loop stop the axis to avoid a two-thread
        # serial collision (which was showing up as a false disconnect after Pause).
        if axis is not None and not self._move_loop_active:
            try:
                axis.stop()
                return True, "Zaber paused (axis stopped)."
            except Exception as exc:
                return False, f"Zaber pause failed: {exc}"
        return True, "Pause requested."

    def disconnect(self):
        if self.cli is not None:
            try:
                self.cli.disconnect()
            except Exception:
                pass
        self.cli = None
        self.simulated = True


STATE = HardwareState()


def load_cell_force(value):
    # load-cell force is always reported as a positive number; flip polarity
    # (multiply by -1) when a reading comes back negative.
    if value is None:
        return None
    return abs(value)
