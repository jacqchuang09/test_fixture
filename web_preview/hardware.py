# Zaber hardware control + the load-cell force polarity helper.
#
# The serial connection and device/axis handshake are taken from emilio's
# zaber-python project (see zaber_cli.ZaberCLI / zaber_cli.py at the repo root):
# open the serial port with zaber_motion, detect the device, grab axis 1, and
# unpark it. Real moves are issued on that axis with millimetre units.
#
# Port enumeration mirrors emilio's comport combobox, which listed
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

    @property
    def axis(self):
        return self.cli.getAxis() if self.cli is not None else None

    def _read_position(self):
        axis = self.axis
        if axis is None:
            return self.position_mm
        try:
            self.position_mm = float(axis.get_position(_mm_unit()))
        except Exception:
            pass
        return self.position_mm

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
        try:
            connected = cli.connect(comport) == 1
        except Exception:
            connected = False

        if connected:
            self.cli = cli
            self.simulated = False
            self._read_position()
            return {
                "ok": True, "connected": True, "comport": comport,
                "message": f"Connected to Zaber on {comport}. Current position: {self.position_mm:.2f} mm.",
            }

        self.cli = None
        self.simulated = True
        return {
            "ok": True, "connected": False, "comport": comport,
            "message": f"Couldn't connect to a Zaber on {comport}. Try a different COM port.",
        }

    def move(self, comport, distance):
        # relative jog, matching the gui's incremental move buttons.
        distance = float(distance)
        axis = self.axis
        if axis is not None:
            try:
                axis.move_relative(distance, _mm_unit())
                self._read_position()
                return True, f"Moved Zaber axis by {distance:g} mm. Current position: {self.position_mm:.2f} mm."
            except Exception as exc:
                return False, f"Zaber move failed: {exc}"
        self.position_mm += distance
        return True, f"[sim] Moved simulated Zaber axis by {distance:g} mm. Current position: {self.position_mm:.2f} mm."

    def home(self, comport):
        # absolute move back to the working baseline (17 mm).
        axis = self.axis
        if axis is not None:
            try:
                axis.move_absolute(HOME_MM, _mm_unit())
                self.position_mm = HOME_MM
                return True, f"Moved Zaber axis to home/default position: {HOME_MM:g} mm."
            except Exception as exc:
                return False, f"Zaber home failed: {exc}"
        self.position_mm = HOME_MM
        return True, f"[sim] Moved simulated Zaber axis to home/default position: {HOME_MM:g} mm."

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
