class ZaberCLI:
    """small wrapper around the zaber motion serial connection."""

    def __init__(self):
        self.connection = None
        self.axis = None
        self.last_error = None   # human-readable reason the last connect() failed

    def connect(self, comport):
        # import here so the preview can still open if zaber-motion is missing.
        self.last_error = None
        try:
            from zaber_motion.ascii import Connection
            from zaber_motion import exceptions
        except ImportError as exc:
            self.last_error = f"zaber-motion package not available: {exc}"
            print(self.last_error)
            return 0

        try:
            # open the serial port and use the first detected zaber device.
            self.connection = Connection.open_serial_port(comport)
            device_list = self.connection.detect_devices()
            if not device_list:
                self.last_error = (
                    f"Port {comport} opened but no Zaber device answered "
                    "(wrong port, wrong baud, or the stage is off)."
                )
                print(self.last_error)
                return 0

            device = device_list[0]
            self.axis = device.get_axis(1)
            if self.axis.is_parked():
                self.axis.unpark()

            print("Device fully connected")
            return 1
        except exceptions.ConnectionFailedException as exc:
            self.last_error = f"Could not open {comport}: {exc} (is another program using it?)"
            print(self.last_error)
            return 0
        except Exception as exc:
            self.last_error = f"{type(exc).__name__} on {comport}: {exc}"
            print(self.last_error)
            return 0

    def disconnect(self):
        # park and close gently so the next run starts cleanly.
        print("Device disconnected")
        if self.axis is not None:
            try:
                self.axis.park()
            except Exception as exc:
                print(f"Could not park axis during disconnect: {exc}")
        if self.connection is not None:
            try:
                self.connection.close()
            except Exception as exc:
                print(f"Could not close Zaber connection: {exc}")
        self.axis = None
        self.connection = None

    def getAxis(self):
        return self.axis
