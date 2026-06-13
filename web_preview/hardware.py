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
        self.comms_lost = False  # set True when a live Zaber command fails (disconnect)
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
        except Exception:
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
        # Establish the actuator's ABSOLUTE position with a real Zaber homing: drive
        # to the home sensor (the retracted end, away from the sensor - safe) and
        # zero the reference, then move to the working baseline (HOME_MM). Done once
        # on connect so the device and GUI agree on position for the whole session,
        # which is what makes the travel limits reliable no matter where the actuator
        # was left. Returns True if it homed.
        axis = self.axis
        if axis is None:
            return False
        try:
            axis.home()                                  # blocks until homed
            axis.move_absolute(HOME_MM, _mm_unit())       # go to the working baseline
            return True
        except Exception:
            return False

    def connect_zaber(self, comport):
        # connect on port selection, like emilio's trace_comport. Falls back to
        # a simulated stage (still returns ok=True) when no hardware responds.
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
            homed = self._home_reference()  # establish absolute position (real homing)
            self._read_position()
            home_note = " Homed to baseline." if homed else ""
            return {
                "ok": True, "connected": True, "comport": comport,
                "message": f"Connected to Zaber on {comport}.{home_note} Current position: {self.position_mm:.2f} mm.",
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
        return self.connect_zaber(self.comport)

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
        # Home does a REAL Zaber homing: it physically drives to the home sensor and
        # re-establishes the absolute reference, then moves to the working baseline
        # (17 mm). It is NOT based on the GUI's tracked guess - it finds the sensor -
        # so it always returns to the true baseline AND re-syncs the position, even
        # if tracking had drifted or was unknown (e.g. after a disconnect).
        axis = self.axis
        if axis is not None:
            try:
                if axis.is_parked():
                    axis.unpark()
                axis.home()                                   # find the sensor, re-zero the reference
                axis.move_absolute(HOME_MM, _mm_unit(), wait_until_idle=True)
                self._read_position()
                return {"ok": True, "position": self.position_mm,
                        "message": f"Homed to baseline. Current position: {self.position_mm:.2f} mm."}
            except Exception as exc:
                # an interrupted/failed home leaves the actuator somewhere unknown;
                # re-read the device's ACTUAL position so the GUI does not keep a
                # stale value (which is what breaks the travel limits).
                self._read_position()
                return {"ok": False, "position": self.position_mm,
                        "message": f"Zaber home failed: {exc}. Re-synced position to {self.position_mm:.2f} mm - press Home again."}
        self.position_mm = HOME_MM
        return {"ok": True, "position": self.position_mm,
                "message": f"[sim] Moved simulated Zaber axis to home/default position: {HOME_MM:g} mm."}

    def stop(self):
        self.stop_requested = True
        axis = self.axis
        if axis is not None:
            try:
                axis.stop()
                return True, "Zaber stop sent."
            except Exception as exc:
                return False, f"Zaber stop failed: {exc}"
        return True, "[sim] Stop requested."

    def pause(self, comport="COM3"):
        self.pause_requested = True
        axis = self.axis
        if axis is not None:
            try:
                axis.stop()
                return True, "Zaber paused (axis stopped)."
            except Exception as exc:
                return False, f"Zaber pause failed: {exc}"
        return True, "[sim] Pause requested."

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
