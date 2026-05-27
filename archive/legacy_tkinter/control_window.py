import tkinter as tk
from tkinter import ttk

from zaber_cli import ZaberCLI


class ControlWindow(tk.Frame):
    """Separate window for direct Zaber control."""

    def __init__(self, root, main_window, zaber):
        super().__init__(root)
        self.root = root
        self.main_window = main_window
        self.zaber = zaber or ZaberCLI()
        self.window = tk.Toplevel(self.root)
        self.window.title("Zaber Control Panel")
        self.window.geometry("720x460")
        self.window.minsize(640, 420)

        self.default_pos = tk.DoubleVar(value=17)
        self.position = tk.DoubleVar(value=17)
        self.min_pos = tk.DoubleVar(value=17)
        self.max_pos = tk.DoubleVar(value=40)
        self.zaber_comport = tk.StringVar(value=self.main_window.zaber_comport.get())
        self.status = tk.StringVar(value="Select a COM port and connect.")
        self.widgets = []

        self._create_ui()
        self._set_controls_state(tk.DISABLED)

    def _create_ui(self):
        main = ttk.Frame(self.window, padding=16)
        main.pack(fill="both", expand=True)

        ttk.Label(main, text="Zaber Control Panel", font=("Segoe UI", 16, "bold")).pack(anchor="w")
        ttk.Label(main, textvariable=self.status, foreground="#1976d2").pack(anchor="w", pady=(4, 14))

        port_row = ttk.Frame(main)
        port_row.pack(fill="x", pady=(0, 12))
        ttk.Label(port_row, text="Zaber COM Port").pack(side="left")
        try:
            import serial.tools.list_ports
            ports = [port.device for port in serial.tools.list_ports.comports()]
        except ImportError:
            ports = []
            self.status.set("Install pyserial to auto-list COM ports.")
        combo = ttk.Combobox(port_row, values=ports, textvariable=self.zaber_comport, width=18)
        combo.pack(side="left", padx=8)
        ttk.Button(port_row, text="Connect", command=self.connect).pack(side="left")

        content = ttk.Frame(main)
        content.pack(fill="both", expand=True)

        slider_frame = ttk.LabelFrame(content, text="Remote", padding=10)
        slider_frame.pack(side="left", fill="y", padx=(0, 12))
        self.slider = tk.Scale(
            slider_frame,
            variable=self.position,
            from_=self.min_pos.get(),
            to=self.max_pos.get(),
            orient=tk.VERTICAL,
            length=190,
        )
        self.slider.pack()
        up_btn = ttk.Button(slider_frame, text="Up", command=lambda: self.bump(-1))
        up_btn.pack(fill="x", pady=(8, 3))
        down_btn = ttk.Button(slider_frame, text="Down", command=lambda: self.bump(1))
        down_btn.pack(fill="x")

        fields = ttk.LabelFrame(content, text="Position Settings", padding=10)
        fields.pack(side="left", fill="both", expand=True)
        self._entry(fields, "Current Position", self.position, 0)
        self._entry(fields, "Min Position", self.min_pos, 1)
        self._entry(fields, "Max Position", self.max_pos, 2)
        self._entry(fields, "Default Position", self.default_pos, 3)

        button_row = ttk.Frame(fields)
        button_row.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(18, 0))
        home_btn = ttk.Button(button_row, text="Home", command=self.home_axis)
        home_btn.pack(side="left", fill="x", expand=True, padx=(0, 5))
        park_btn = ttk.Button(button_row, text="Park/Unpark", command=self.park_axis)
        park_btn.pack(side="left", fill="x", expand=True, padx=5)
        save_btn = ttk.Button(button_row, text="Save Inputs", command=self.save_inputs)
        save_btn.pack(side="left", fill="x", expand=True, padx=(5, 0))

        self.widgets.extend([self.slider, up_btn, down_btn, home_btn, park_btn, save_btn])

    def _entry(self, parent, label, variable, row):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=7)
        entry = ttk.Entry(parent, textvariable=variable, width=12)
        entry.grid(row=row, column=1, sticky="w", padx=8)
        ttk.Label(parent, text="mm").grid(row=row, column=2, sticky="w")
        self.widgets.append(entry)

    def _set_controls_state(self, state):
        for widget in self.widgets:
            widget.config(state=state)

    def connect(self):
        comport = self.zaber_comport.get()
        connected = self.zaber.connect(comport)
        if connected == 0:
            self.status.set(f"Could not connect to {comport}.")
            return

        self.main_window.zaber_comport.set(comport)
        raw_position = self.zaber.axis.get_position()
        position_mm = (raw_position * 0.04765) / 1000
        self.position.set(position_mm)
        self.status.set(f"Connected on {comport}. Current position: {position_mm:.2f} mm")
        self._set_controls_state(tk.NORMAL)

    def save_inputs(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.status.set(f"Missing zaber-motion package: {exc}")
            return

        position = self.position.get()
        if position < self.min_pos.get():
            position = self.min_pos.get()
            self.position.set(position)
        elif position > self.max_pos.get():
            position = self.max_pos.get()
            self.position.set(position)

        self.zaber.axis.move_absolute(position, Units.LENGTH_MILLIMETRES)
        self.status.set(f"Position moved to {position:.2f} mm.")

    def bump(self, delta):
        new_position = self.position.get() + delta
        self.position.set(max(self.min_pos.get(), min(self.max_pos.get(), new_position)))
        self.save_inputs()

    def home_axis(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.status.set(f"Missing zaber-motion package: {exc}")
            return

        default_pos = self.default_pos.get()
        self.zaber.axis.move_absolute(default_pos, Units.LENGTH_MILLIMETRES)
        self.position.set(default_pos)
        self.status.set(f"Homed to default position: {default_pos:.2f} mm.")

    def park_axis(self):
        if not self.zaber.axis.is_parked():
            self.zaber.axis.park()
            self.status.set("Axis parked.")
        else:
            self.zaber.axis.unpark()
            self.status.set("Axis unparked.")
