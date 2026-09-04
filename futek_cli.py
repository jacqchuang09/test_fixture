"""
Wrapper around the FUTEK load cell DLL.

Tries to load the real .NET-based driver first. If that fails (typically on
macOS Apple Silicon, where Mono is x86_64 but Python is arm64), falls back
to MockFUTEKDeviceCLI which returns synthetic force values that simulate
slow compression. This lets the whole EM test pipeline - run_em_run, the
browser polling, CSV file writing, and analysis - be exercised end-to-end
on a Mac without real hardware.

When you actually run on Windows (or get Mono+pythonnet working on the Mac),
the real class is used automatically. No other code needs to change.
"""

import math
import os
import sys
import time


def _register_dll_dir():
    """Make the FUTEK/.NET DLLs in libs/windows/ resolvable by pythonnet.

    The DLLs live in libs/windows/ when running from source, and next to the
    exe (or in _MEIPASS) when frozen by PyInstaller. pythonnet/.NET resolves
    assemblies from sys.path, and native deps from the Windows DLL search path,
    so register every candidate location.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "libs", "windows"),   # running from source
        getattr(sys, "_MEIPASS", None),           # PyInstaller (onefile)
        os.path.dirname(sys.executable),          # PyInstaller (onedir, next to exe)
        here,                                     # legacy: DLLs beside this file
    ]
    for d in candidates:
        if d and os.path.isdir(d):
            if d not in sys.path:
                sys.path.append(d)
            try:
                os.add_dll_directory(d)           # Windows only (py3.8+)
            except (AttributeError, OSError):
                pass


_register_dll_dir()


# ----------------------------------------------------------------------
# try to load the real FUTEK .NET stack.
# ----------------------------------------------------------------------
_REAL_FUTEK_AVAILABLE = False
_FUTEK_IMPORT_ERROR = None
try:
    # Pick the .NET runtime before any clr import. Windows has .NET Framework
    # natively, so let pythonnet use its default (netfx) - forcing Mono there can
    # stop the real FUTEK driver from loading (and silently fall back to the mock).
    # Only force Mono on macOS/Linux, where it is the runtime that is present.
    if not sys.platform.startswith("win"):
        try:
            from pythonnet import load as _pythonnet_load
            _pythonnet_load("mono")
        except Exception:
            pass

    import clr  # noqa: F401  (loads .NET runtime when imported)
    clr.AddReference("FUTEK.Devices")
    import FUTEK.Devices  # noqa: F401
    from FUTEK.Devices import DeviceRepository  # noqa: F401

    _REAL_FUTEK_AVAILABLE = True
except Exception as exc:
    _FUTEK_IMPORT_ERROR = exc


# ----------------------------------------------------------------------
# mock implementation - always defined
# ----------------------------------------------------------------------
class MockFUTEKDeviceCLI:
    """
    Stand-in for the real FUTEK driver. Returns synthetic raw values that,
    after run_em_run's calibration (`* -4.44822`) and zero-baseline
    subtraction, produce a force curve that ramps from ~0 N up past 20 N
    over about 4 seconds - naturally triggering the upper-limit safety
    stop. Used when the .NET runtime isn't available.
    """

    def __init__(self):
        print("=" * 64)
        print("MOCK FUTEK ACTIVE - synthetic force readings only.")
        if _FUTEK_IMPORT_ERROR is not None:
            print(f"Reason: {_FUTEK_IMPORT_ERROR}")
        print("Install Mono on x86_64 Python or run on Windows for real data.")
        print("=" * 64)
        self._start_time = time.monotonic()
        self.OpenedConnection = True
        # printed fields so anything that reads these attributes still works.
        self.ModelNumber = "MOCK-USB225"
        self.SerialNumber = "MOCK-0000"
        self.UnitCode = 0
        self.SamplingRate = "100"
        self.NormalData = 0.0
        self.USB225 = None
        self.oFUTEKDeviceRepoDLL = None

    def getNormalData(self):
        # synthetic raw value that grows negative over time (compression).
        # raw value `v` becomes force `-4.44822 * v` after calibration, so
        # negative raw → positive Newtons after sign flip.
        elapsed = time.monotonic() - self._start_time
        raw = -(0.1 + elapsed * 1.2 + math.log1p(elapsed) * 0.4)
        # small jitter so the curve isn't a perfectly straight line.
        raw += math.sin(elapsed * 7) * 0.02
        return raw

    def stop(self):
        if not self.OpenedConnection:
            return
        self.OpenedConnection = False
        print("Mock FUTEK session closed.")

    def exit(self):
        if self.OpenedConnection:
            self.stop()
        print("Mock FUTEK exiting.")


# ----------------------------------------------------------------------
# real implementation - only defined if .NET loaded successfully.
# ----------------------------------------------------------------------
if _REAL_FUTEK_AVAILABLE:
    class RealFUTEKDeviceCLI:
        """Wraps the actual FUTEK USB225 via the .NET driver."""

        def __init__(self):
            self.oFUTEKDeviceRepoDLL = self.connect()
            # find the connected futek device, usually the usb225.
            devices = self.oFUTEKDeviceRepoDLL.DetectDevices()
            self.USB225 = devices[0] if devices else None
            if self.USB225 is None:
                raise RuntimeError(
                    "No FUTEK device detected on USB. Plug in the load cell and confirm "
                    "the FUTEK USB driver is installed.")

            # Model / serial / unit / rate are INFORMATIONAL only - the force reading at
            # the end is what the test actually uses. Some FUTEK.Devices builds expose
            # model/serial as INSTANCE methods rather than the static Device.GetX(device)
            # form, which throws "No method matches given arguments" / "non-static method
            # with an invalid instance". So read each one defensively (trying the instance
            # form as a fallback) and never let a metadata-call mismatch stop the load cell
            # from opening for readings.
            self.ModelNumber = self._read_meta(
                "model number",
                lambda: FUTEK.Devices.Device.GetModelNumber(self.USB225),
                lambda: self.USB225.GetModelNumber())
            self.SerialNumber = self._read_meta(
                "serial number",
                lambda: FUTEK.Devices.Device.GetInstrumentSerialNumber(self.USB225),
                lambda: self.USB225.GetInstrumentSerialNumber())
            self.UnitCode = self._read_meta(
                "unit of measure",
                lambda: FUTEK.Devices.DeviceUSB225.GetChannelXUnitOfMeasure(self.USB225, 0),
                default=0)
            # available sampling rates: ['2.5','5','10','16.6','20','50','60','100','400','1200','2400','4800']
            self.SamplingRate = self._read_meta(
                "sampling rate",
                lambda: FUTEK.Devices.DeviceUSB225.GetChannelXSamplingRate(self.USB225, 0),
                default="100")
            # Set a high, steady sampling rate. The force read loop samples every 10 ms
            # (~100 Hz), so the device MUST produce new samples at least that fast or the
            # loop re-reads the same frame (repeated force/timestamps) - a stale held
            # value delays the force-limit stop and overshoots the target. Ask for 400 Hz
            # (a fresh sample every 2.5 ms, 4x margin over the loop); if the device
            # rejects that, fall back to 100 Hz (10 ms) which still matches the loop.
            for want_hz in ("400", "100"):
                try:
                    self.USB225.SetChannelXSamplingRate(0, want_hz)
                    break
                except Exception as e:
                    print(f"[futek] device rejected a {want_hz} Hz sampling rate: {e}")
            # Read the rate back so the console shows what the device is ACTUALLY running
            # at (a Set call can fail silently). Below 100 Hz = repeated readings.
            try:
                actual_rate = FUTEK.Devices.DeviceUSB225.GetChannelXSamplingRate(self.USB225, 0)
                print(f"[futek] load cell sampling rate is now {actual_rate} Hz "
                      f"(read loop samples every 10 ms; the device must run >= 100 Hz "
                      f"to avoid repeated readings).")
                try:
                    if float(str(actual_rate)) < 100:
                        print("[futek] WARNING: the device is sampling SLOWER than the 10 ms "
                              "read loop - force readings will repeat and lag the true force.")
                except (TypeError, ValueError):
                    pass
            except Exception as e:
                print(f"[futek] could not read back sampling rate: {e}")

            # THE REAL GATE: if force cannot be read, this is not a working load cell -
            # let the exception propagate so the caller falls back to simulated force
            # instead of reporting a dead device as connected.
            self.NormalData = FUTEK.Devices.DeviceUSB225.GetChannelXReading(self.USB225, 0)
            print(f"Sensor Reading: {self.NormalData:.3f}")
            self.OpenedConnection = True

        def _read_meta(self, label, *getters, default=None):
            # informational device property: try each call form in turn, and on total
            # failure log and return the default so opening never hinges on metadata.
            last = None
            for getter in getters:
                try:
                    value = getter()
                    print(f"FUTEK {label}: {value}")
                    return value
                except Exception as exc:
                    last = exc
            print(f"[futek] could not read {label} ({last}); continuing - force readings still work.")
            return default

        def getNormalData(self):
            # Raw SIGNED reading. Two load cells are in use - one reads positive
            # under compression, the other negative. The run engine tares to the
            # start-of-press baseline and takes the magnitude of the change, which
            # is correct for either polarity. Do NOT abs here: abs-ing the raw value
            # before the baseline is subtracted can still come out negative when the
            # cell has a resting offset.
            return FUTEK.Devices.DeviceUSB225.GetChannelXReading(self.USB225, 0)

        def connect(self):
            try:
                print("FUTEK Devices DLL initialized.")
                return FUTEK.Devices.DeviceRepository()
            except Exception as e:
                print(f"Error initializing FUTEK Devices DLL: {e}")
                return

        def stop(self):
            if not self.OpenedConnection:
                print("No open connection to close.")
                return

            self.oFUTEKDeviceRepoDLL.DisconnectAllDevices()
            if self.oFUTEKDeviceRepoDLL.DeviceCount > 0:
                print("A device is still connected.")
            else:
                print("Session closed.")

            self.SerialNumber = ""
            self.ModelNumber = ""
            self.UnitCode = 0

            self.OpenedConnection = False

        def exit(self):
            if self.OpenedConnection:
                self.stop()
            print("Exiting the CLI...")
            # keep python alive after closing the futek session.

    FUTEKDeviceCLI = RealFUTEKDeviceCLI
else:
    FUTEKDeviceCLI = MockFUTEKDeviceCLI


# ----------------------------------------------------------------------
# manual debugging entry point - works with either real or mock.
# ----------------------------------------------------------------------
if __name__ == '__main__':
    cli = FUTEKDeviceCLI()
    while True:
        command = input("Enter command (start/stop/exit): ").strip().lower()
        if command == 'start':
            print(cli.getNormalData())
        elif command == 'stop':
            cli.stop()
        elif command == 'exit':
            cli.exit()
        else:
            print("Unknown command. Please enter 'start', 'stop', or 'exit'.")
