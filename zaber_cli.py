class ZaberCLI:
    """small wrapper around the zaber motion serial connection."""

    def __init__(self):
        self.connection = None
        self.axis = None

    def connect(self, comport):
        # import here so the preview can still open if zaber-motion is missing.
        try:
            from zaber_motion.ascii import Connection
            from zaber_motion import exceptions
        except ImportError as exc:
            print(f"Missing zaber-motion package: {exc}")
            return 0

        try:
            # open the serial port and use the first detected zaber device.
            self.connection = Connection.open_serial_port(comport)
            device_list = self.connection.detect_devices()
            if not device_list:
                print("No Zaber devices detected")
                return 0

            device = device_list[0]
            self.axis = device.get_axis(1)
            if self.axis.is_parked():
                self.axis.unpark()

            print("Device fully connected")
            return 1
        except exceptions.ConnectionFailedException:
            print("Connection Failed")
            return 0
        except Exception as exc:
            print(f"Zaber connection error: {exc}")
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
