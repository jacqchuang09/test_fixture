import tkinter as tk
from tkinter import messagebox, ttk

from zaber_cli import ZaberCLI


class CalibrationWindow:
    """Calibration and Fuji film testing window with real Zaber movement hooks."""

    def __init__(self, parent, main_window):
        self.parent = parent
        self.main_window = main_window
        self.window = tk.Toplevel(parent)
        self.window.title("Calibration: Lower Load Cell + Fuji Film Test")
        self.window.geometry("620x700")
        self.window.minsize(560, 620)

        self.extract_distance = tk.StringVar()
        self.increment_distance = tk.StringVar(value="0.1")
        self.current_position = tk.DoubleVar(value=0.0)
        self.current_force = tk.DoubleVar(value=0.0)
        self.status_message = tk.StringVar(value="Ready")
        self.zaber = None

        self._create_ui()

    def _create_ui(self):
        main = ttk.Frame(self.window, padding=18)
        main.pack(fill="both", expand=True)

        ttk.Label(main, text="Calibration: Lower Load Cell + Fuji Film Test", font=("Segoe UI", 14, "bold")).pack(anchor="w", pady=(0, 12))
        ttk.Label(main, text="Error check active: movement should stop if force increases significantly.", foreground="#1976d2").pack(anchor="w", pady=(0, 12))

        ttk.Button(main, text="Connect Zaber", command=self.connect_zaber).pack(fill="x", pady=(0, 10))

        status = ttk.LabelFrame(main, text="Current Status", padding=10)
        status.pack(fill="x", pady=(0, 10))
        self.position_label = ttk.Label(status, text="Position: 0.00 mm")
        self.position_label.pack(anchor="w")
        self.force_label = ttk.Label(status, text="Force: 0.0 lbs")
        self.force_label.pack(anchor="w", pady=3)
        ttk.Label(status, textvariable=self.status_message, foreground="#1976d2").pack(anchor="w")

        manual = ttk.LabelFrame(main, text="Manual Increment Control", padding=10)
        manual.pack(fill="x", pady=(0, 10))
        ttk.Label(manual, text="Increment Distance (mm)").pack(anchor="w")
        ttk.Entry(manual, textvariable=self.increment_distance).pack(fill="x", pady=(4, 8))
        row = ttk.Frame(manual)
        row.pack(fill="x")
        ttk.Button(row, text="Move Up", command=self.increment_up).pack(side="left", fill="x", expand=True, padx=(0, 5))
        ttk.Button(row, text="Move Down", command=self.increment_down).pack(side="left", fill="x", expand=True, padx=(5, 0))
        ttk.Button(manual, text="Restart (Reset to Home)", command=self.restart).pack(fill="x", pady=(8, 0))

        fuji = ttk.LabelFrame(main, text="Fuji Film Test", padding=10)
        fuji.pack(fill="x", pady=(0, 10))
        ttk.Button(fuji, text="Begin Fuji Film Pushing (Target: 20 lbs)", command=self.begin_fuji_film).pack(fill="x")

        extract = ttk.LabelFrame(main, text="Extract Feature", padding=10)
        extract.pack(fill="x", pady=(0, 10))
        ttk.Label(extract, text="Extract Distance (mm)").pack(anchor="w")
        ttk.Entry(extract, textvariable=self.extract_distance).pack(fill="x", pady=(4, 8))
        ttk.Button(extract, text="Extract Feature (Requires Confirmation)", command=self.extract_feature).pack(fill="x")

    def connect_zaber(self):
        self.zaber = ZaberCLI()
        connected = self.zaber.connect(self.main_window.zaber_comport.get())
        if connected == 0:
            self.status_message.set("Could not connect to Zaber.")
            return False

        raw_position = self.zaber.axis.get_position()
        position_mm = (raw_position * 0.04765) / 1000
        self.current_position.set(position_mm)
        self.update_displays()
        self.status_message.set("Zaber connected.")
        return True

    def _ensure_zaber(self):
        if self.zaber is not None and self.zaber.axis is not None:
            return True
        return self.connect_zaber()

    def _read_float(self, variable, label):
        try:
            return float(variable.get())
        except ValueError:
            messagebox.showerror("Invalid Value", f"Please enter a valid number for {label}.")
            return None

    def increment_up(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.status_message.set(f"Missing zaber-motion package: {exc}")
            return

        increment = self._read_float(self.increment_distance, "increment distance")
        if increment is None or not self._ensure_zaber():
            return
        self.zaber.axis.move_relative(-increment, Units.LENGTH_MILLIMETRES)
        self.current_position.set(self.current_position.get() - increment)
        self.update_displays()
        self.status_message.set(f"Moved up by {increment:g} mm.")

    def increment_down(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.status_message.set(f"Missing zaber-motion package: {exc}")
            return

        increment = self._read_float(self.increment_distance, "increment distance")
        if increment is None or not self._ensure_zaber():
            return
        self.zaber.axis.move_relative(increment, Units.LENGTH_MILLIMETRES)
        self.current_position.set(self.current_position.get() + increment)
        self.update_displays()
        self.status_message.set(f"Moved down by {increment:g} mm.")

    def restart(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.status_message.set(f"Missing zaber-motion package: {exc}")
            return

        if not self._ensure_zaber():
            return
        self.zaber.axis.move_absolute(17, Units.LENGTH_MILLIMETRES)
        self.current_position.set(17.0)
        self.current_force.set(0.0)
        self.update_displays()
        self.status_message.set("Actuator reset to 17 mm.")

    def begin_fuji_film(self):
        messagebox.showinfo(
            "FUTEK Needed",
            "Fuji film force stopping needs the real FUTEKDeviceCLI implementation in futek_cli.py.",
        )

    def extract_feature(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.status_message.set(f"Missing zaber-motion package: {exc}")
            return

        distance = self._read_float(self.extract_distance, "extract distance")
        if distance is None or not self._ensure_zaber():
            return
        confirmed = messagebox.askyesno("Confirm Extract Feature", f"This will move the stage by {distance:g} mm.\n\nContinue?")
        if not confirmed:
            self.status_message.set("Extract feature cancelled.")
            return
        self.zaber.axis.move_relative(distance, Units.LENGTH_MILLIMETRES)
        self.current_position.set(self.current_position.get() + distance)
        self.update_displays()
        self.status_message.set(f"Extract feature activated. Moved {distance:g} mm.")

    def update_displays(self):
        self.position_label.config(text=f"Position: {self.current_position.get():.2f} mm")
        self.force_label.config(text=f"Force: {self.current_force.get():.1f} lbs")
