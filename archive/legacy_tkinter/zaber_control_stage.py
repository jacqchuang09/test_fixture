import tkinter as tk
from datetime import datetime
from tkinter import scrolledtext, ttk

from zaber_cli import ZaberCLI


class ZaberControlStage:
    """Live status and control window for a test run."""

    def __init__(self, parent, main_window):
        self.parent = parent
        self.main_window = main_window
        self.window = tk.Toplevel(parent)
        self.window.title("Zaber Control Stage")
        self.window.geometry("820x610")
        self.window.minsize(700, 520)
        self.zaber = None

        self._create_ui()
        self.add_status("System initialized.")
        self.add_status("Press Start to begin the selected test.")

    def _create_ui(self):
        main = ttk.Frame(self.window, padding=18)
        main.pack(fill="both", expand=True)

        ttk.Label(main, text="Zaber Control Stage", font=("Segoe UI", 16, "bold")).pack(anchor="w", pady=(0, 12))

        status_frame = ttk.LabelFrame(main, text="Current Status", padding=10)
        status_frame.pack(fill="both", expand=True, pady=(0, 14))

        self.status_text = scrolledtext.ScrolledText(
            status_frame,
            height=16,
            font=("Consolas", 10),
            state="disabled",
            wrap="word",
        )
        self.status_text.pack(fill="both", expand=True)

        controls = ttk.LabelFrame(main, text="Control Panel", padding=12)
        controls.pack(fill="x")

        row = ttk.Frame(controls)
        row.pack(fill="x", pady=(0, 8))
        self.start_btn = ttk.Button(row, text="Start", command=self.start_test)
        self.start_btn.pack(side="left", fill="x", expand=True, padx=(0, 5))
        self.pause_btn = ttk.Button(row, text="Pause", command=self.toggle_pause)
        self.pause_btn.pack(side="left", fill="x", expand=True, padx=5)
        ttk.Button(row, text="Stop", command=self.stop_test).pack(side="left", fill="x", expand=True, padx=(5, 0))

        row2 = ttk.Frame(controls)
        row2.pack(fill="x", pady=(0, 8))
        ttk.Button(row2, text="Move Up", command=lambda: self.manual_move(-1)).pack(side="left", fill="x", expand=True, padx=(0, 5))
        ttk.Button(row2, text="Move Down", command=lambda: self.manual_move(1)).pack(side="left", fill="x", expand=True, padx=5)
        ttk.Button(row2, text="Home", command=self.move_home).pack(side="left", fill="x", expand=True, padx=(5, 0))

        ttk.Button(controls, text="Emergency Stop", command=self.emergency_stop).pack(fill="x")

    def add_status(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.status_text.config(state="normal")
        self.status_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.status_text.see(tk.END)
        self.status_text.config(state="disabled")
        self.window.update()

    def start_test(self):
        self.start_btn.config(state="disabled")
        self.add_status("Test started.")
        try:
            self.main_window.toggle_pause.set(False)
            self.main_window.run_selected_test()
        finally:
            self.start_btn.config(state="normal")

    def stop_test(self):
        self.add_status("Stop requested.")
        self.main_window.request_stop()

    def toggle_pause(self):
        paused = not self.main_window.toggle_pause.get()
        self.main_window.toggle_pause.set(paused)
        self.pause_btn.config(text="Resume" if paused else "Pause")
        self.add_status("Paused." if paused else "Resumed.")
        if not paused:
            self.start_test()

    def _connect_for_manual(self):
        if self.zaber is not None and self.zaber.axis is not None:
            return True

        self.zaber = ZaberCLI()
        connected = self.zaber.connect(self.main_window.zaber_comport.get())
        if connected == 0:
            self.add_status("ERROR: Could not connect to Zaber for manual movement.")
            self.zaber = None
            return False
        return True

    def manual_move(self, distance):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.add_status(f"ERROR: Missing zaber-motion package: {exc}")
            return

        if not self._connect_for_manual():
            return
        self.zaber.axis.move_relative(distance, Units.LENGTH_MILLIMETRES)
        position = self.zaber.axis.get_position()
        self.add_status(f"Moved {distance:g} mm. Raw position: {position}")

    def move_home(self):
        try:
            from zaber_motion import Units
        except ImportError as exc:
            self.add_status(f"ERROR: Missing zaber-motion package: {exc}")
            return

        if not self._connect_for_manual():
            return
        self.zaber.axis.move_absolute(17, Units.LENGTH_MILLIMETRES)
        self.add_status("Moved to home/default position: 17 mm.")

    def emergency_stop(self):
        self.add_status("EMERGENCY STOP requested.")
        self.main_window.request_stop()
        if self.zaber is not None and self.zaber.axis is not None:
            self.zaber.axis.stop()
