import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from calibration_window import CalibrationWindow
from control_window import ControlWindow
from zaber_cli import ZaberCLI
from zaber_control_stage import ZaberControlStage


class ImprovedMainWindow:
    """Modern setup window with the original hardware test logic attached."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Zaber Stage Material Testing Setup")
        self.root.geometry("900x750")
        self.root.minsize(760, 620)

        self.saved_path = tk.StringVar()
        self.sensor_id = tk.StringVar()
        self.sensor_type = tk.StringVar(value="Standard")
        self.test_type = tk.StringVar(value="EM")
        self.n_runs = tk.IntVar(value=3)
        self.current_run = tk.IntVar(value=1)
        self.zaber_comport = tk.StringVar(value="COM3")
        self.auto_pause = tk.BooleanVar(value=True)
        self.surface_area = tk.StringVar(value="325mm2")
        self.settings_verified = tk.BooleanVar(value=False)
        self.toggle_pause = tk.BooleanVar(value=False)
        self.stop_requested = tk.BooleanVar(value=False)
        self.is_warning_cancel = tk.BooleanVar(value=False)
        self.stage_window = None

        self._setup_styles()
        self._create_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _setup_styles(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Title.TLabel", font=("Segoe UI", 18, "bold"))
        style.configure("Caption.TLabel", foreground="#666666", font=("Segoe UI", 9))
        style.configure("Primary.TButton", padding=9)
        style.configure("Success.TButton", padding=9)

    def _create_ui(self):
        self.main_container = ttk.Frame(self.root, padding=20)
        self.main_container.pack(fill="both", expand=True)

        ttk.Label(
            self.main_container,
            text="Zaber Stage Material Testing Setup",
            style="Title.TLabel",
        ).pack(anchor="w", pady=(0, 18))

        self._create_basic_settings_card()
        self.test_config_frame = None
        self._create_bottom_buttons()

    def _create_basic_settings_card(self):
        card = ttk.LabelFrame(self.main_container, text="Basic Settings", padding=15)
        card.pack(fill="x", pady=(0, 14))

        ttk.Label(card, text="Save Folder *").pack(anchor="w")
        row = ttk.Frame(card)
        row.pack(fill="x", pady=(4, 2))
        ttk.Entry(row, textvariable=self.saved_path).pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Browse", command=self.browse_folder).pack(side="left", padx=(8, 0))
        ttk.Label(
            card,
            text="Folder will be created automatically if it does not exist.",
            style="Caption.TLabel",
        ).pack(anchor="w", pady=(0, 10))

        ttk.Label(card, text="Sensor ID *").pack(anchor="w")
        ttk.Entry(card, textvariable=self.sensor_id).pack(fill="x", pady=(4, 10))

        ttk.Label(card, text="Sensor Type *").pack(anchor="w")
        ttk.Combobox(
            card,
            textvariable=self.sensor_type,
            values=("Standard", "Inverted"),
            state="readonly",
        ).pack(fill="x", pady=(4, 14))

        ttk.Button(card, text="Verify Settings", command=self.verify_settings).pack(fill="x")

    def _create_test_config_card(self):
        if self.test_config_frame is not None:
            self.test_config_frame.destroy()

        self.test_config_frame = ttk.LabelFrame(self.main_container, text="Test Configuration", padding=15)
        self.test_config_frame.pack(fill="x", pady=(0, 14), before=self.bottom_buttons)

        ttk.Label(self.test_config_frame, text="Test Type *").pack(anchor="w")
        ttk.Combobox(
            self.test_config_frame,
            textvariable=self.test_type,
            values=("EM", "Shear"),
            state="readonly",
        ).pack(fill="x", pady=(4, 10))

        ttk.Label(self.test_config_frame, text="Number of Runs").pack(anchor="w")
        ttk.Spinbox(self.test_config_frame, from_=1, to=100, textvariable=self.n_runs).pack(fill="x", pady=(4, 10))

        ttk.Label(self.test_config_frame, text="Zaber COM Port *").pack(anchor="w")
        ttk.Entry(self.test_config_frame, textvariable=self.zaber_comport).pack(fill="x", pady=(4, 10))

        ttk.Checkbutton(
            self.test_config_frame,
            text="Automatically pause between runs",
            variable=self.auto_pause,
        ).pack(anchor="w", pady=(0, 10))

        ttk.Label(self.test_config_frame, text="Surface Area *").pack(anchor="w")
        ttk.Entry(self.test_config_frame, textvariable=self.surface_area).pack(fill="x", pady=(4, 2))

    def _create_bottom_buttons(self):
        self.bottom_buttons = ttk.Frame(self.main_container)
        self.bottom_buttons.pack(fill="x", pady=(4, 0))

        self.begin_test_btn = ttk.Button(
            self.bottom_buttons,
            text="Begin Test",
            command=self.begin_test,
            state="disabled",
        )
        self.begin_test_btn.pack(side="left", fill="x", expand=True, padx=(0, 6))

        ttk.Button(
            self.bottom_buttons,
            text="Open Calibration",
            command=self.open_calibration,
        ).pack(side="left", fill="x", expand=True, padx=6)

        ttk.Button(
            self.bottom_buttons,
            text="Control Panel",
            command=self.open_control_panel,
        ).pack(side="left", fill="x", expand=True, padx=(6, 0))

    def browse_folder(self):
        folder = filedialog.askdirectory(title="Select Save Folder")
        if folder:
            self.saved_path.set(folder)

    def verify_settings(self):
        if not self.saved_path.get().strip():
            messagebox.showerror("Missing Save Folder", "Please select a save folder.")
            return
        if not self.sensor_id.get().strip():
            messagebox.showerror("Missing Sensor ID", "Please enter a sensor ID.")
            return

        folder_path = Path(self.saved_path.get()).expanduser()
        try:
            folder_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            messagebox.showerror("Folder Error", f"Could not create folder:\n{exc}")
            return

        self.saved_path.set(str(folder_path))
        self.settings_verified.set(True)
        self._create_test_config_card()
        self.begin_test_btn.config(state="normal")
        messagebox.showinfo("Settings Verified", "Settings verified successfully.")

    def begin_test(self):
        if not self.settings_verified.get():
            messagebox.showerror("Verify Settings", "Please verify settings before beginning a test.")
            return

        self.stage_window = ZaberControlStage(self.root, self)

    def open_calibration(self):
        CalibrationWindow(self.root, self)

    def open_control_panel(self):
        ControlWindow(self.root, self, ZaberCLI())

    def log_status(self, text):
        print(text)
        if self.stage_window is not None:
            self.stage_window.add_status(text)
        self.root.update()

    def warning(self, text):
        result = messagebox.askokcancel("Warning", text)
        self.is_warning_cancel.set(0 if result else 1)
        return result

    def error(self, text):
        messagebox.showerror("Error", text)
        self.log_status(f"ERROR: {text}")

    def run_selected_test(self):
        if self.test_type.get() == "EM":
            self.run_em_test_sequence()
        else:
            try:
                from shear_window import ShearWindow
            except Exception as exc:
                messagebox.showerror(
                    "Shear Dependency Error",
                    "Could not start the Shear window. This usually means matplotlib, pythonnet, "
                    "Mono/.NET, or the FUTEK driver is missing.\n\n"
                    f"Details: {exc}",
                )
                return
            ShearWindow(self.root, self)

    def run_em_test_sequence(self):
        self.stop_requested.set(False)
        n_runs = self.n_runs.get()

        while self.current_run.get() <= n_runs and not self.stop_requested.get():
            current_run = self.current_run.get()
            self.log_status(f"Beginning run {current_run}/{n_runs}")
            state = self.run_tests(n_runs, current_run, self.zaber_comport.get())

            if state is None:
                self.log_status("Test stopped because hardware connection failed.")
                return

            is_paused = current_run == state
            self.log_status(f"Run {current_run} was paused" if is_paused else f"Run {current_run} completed")

            if current_run == n_runs and not is_paused:
                self.log_status("All runs complete")
                self.current_run.set(1)
                messagebox.showinfo("Testing Complete", f"All runs completed for sensor {self.sensor_id.get()}.")
                return

            self.current_run.set(state)
            if state <= n_runs or self.auto_pause.get():
                self.toggle_pause.set(True)
                return

    def request_stop(self):
        self.stop_requested.set(True)
        self.toggle_pause.set(True)

    def run_tests(self, n_runs, current_run, zaber_comport):
        try:
            import numpy as np
            import xlsxwriter
            from zaber_motion import Units
        except ImportError as exc:
            self.error(
                "Missing test dependency. Install requirements.txt before running a real EM test.\n\n"
                f"Details: {exc}"
            )
            return None

        try:
            from futek_cli import FUTEKDeviceCLI
        except Exception as exc:
            self.error(
                "Could not load FUTEKDeviceCLI. The copied futek_cli.py uses pythonnet/clr "
                "and requires a working .NET runtime plus the FUTEK.Devices driver/DLL.\n\n"
                f"Details: {exc}"
            )
            return None

        speed = 0.5
        upper_limit = 20
        extract = 12.75
        is_newer_usb225 = 1

        zaber = ZaberCLI()
        connection = zaber.connect(comport=zaber_comport)
        if connection == 0:
            self.error("Cannot connect to Zaber comport")
            return None

        futek = FUTEKDeviceCLI()
        try:
            zaber.axis.move_relative((extract - 1.8), Units.LENGTH_MILLIMETRES)
            current_position = zaber.axis.get_position()
            start_position_mm = (current_position * 0.047625) / 1000

            init_force = 1
            force_readings = [0] * 12000
            init_time = datetime.now()
            init_seconds = init_time.second + init_time.microsecond / 1e6

            if zaber.axis.is_parked():
                zaber.axis.unpark()

            zaber.axis.move_velocity(speed * 0.1, Units.VELOCITY_MILLIMETRES_PER_SECOND)
            init_val = 0
            force_idx = 0

            while True:
                if self.stop_requested.get():
                    zaber.axis.stop()
                    return current_run

                if self.toggle_pause.get() == 1:
                    ok = self.warning("Pausing this run will recalibrate the zaber machine and reset the current run.")
                    if ok:
                        zaber.axis.stop()
                        zaber.axis.wait_until_idle()
                        zaber.axis.move_absolute(17, Units.LENGTH_MILLIMETRES)
                        return current_run
                    self.toggle_pause.set(False)

                self.root.update()
                reading_force = futek.getNormalData()
                if is_newer_usb225:
                    reading_force = reading_force * (-4.44822)

                if init_force:
                    init_val = reading_force
                    init_force = 0

                stage_force = reading_force - init_val
                if force_idx < len(force_readings):
                    force_readings[force_idx] = stage_force
                force_idx += 1
                self.log_status(f"Force Value: {stage_force}")

                if stage_force >= upper_limit:
                    zaber.axis.stop()
                    break

            zaber.axis.move_velocity(-speed * 2, Units.VELOCITY_MILLIMETRES_PER_SECOND)
            while True:
                if self.stop_requested.get():
                    zaber.axis.stop()
                    return current_run

                if self.toggle_pause.get() == 1:
                    ok = self.warning("Pausing this run will recalibrate the zaber machine and reset the current run.")
                    if ok:
                        zaber.axis.stop()
                        zaber.axis.wait_until_idle()
                        zaber.axis.move_absolute(17, Units.LENGTH_MILLIMETRES)
                        return current_run
                    self.toggle_pause.set(False)

                self.root.update()
                reading_force = futek.getNormalData()
                if is_newer_usb225:
                    reading_force = reading_force * (-4.44822)

                stage_force = reading_force - init_val
                if force_idx < len(force_readings):
                    force_readings[force_idx] = stage_force
                force_idx += 1

                curr_pos = zaber.axis.get_position()
                last_position = (curr_pos * 0.047625) / 1000
                if last_position <= start_position_mm:
                    zaber.axis.stop()
                    break

            if zaber.axis.is_parked():
                zaber.axis.unpark()
            zaber.axis.move_absolute(17, Units.LENGTH_MILLIMETRES)

            self._save_run_file(current_run, force_readings, init_seconds)
            return int(current_run) + 1
        finally:
            futek.stop()
            futek.exit()
            zaber.disconnect()

    def _save_run_file(self, current_run, force_readings, init_seconds):
        path = Path(self.saved_path.get()) / f"Run {current_run}.xlsx"
        workbook = xlsxwriter.Workbook(path)
        worksheet = workbook.add_worksheet(str(current_run))

        worksheet.write("A1", "Index")
        worksheet.write("B1", "Load Cell")
        worksheet.write("C1", "Time")

        time_values = np.linspace(
            init_seconds,
            (len(force_readings) - 1) * 0.016 + init_seconds,
            len(force_readings),
        )

        for index in range(len(force_readings)):
            worksheet.write(index + 1, 0, index + 1)
            worksheet.write(index + 1, 1, force_readings[index])
            worksheet.write(index + 1, 2, time_values[index])

        workbook.close()
        self.log_status(f"Saved data file: {path}")

    def on_close(self):
        self.request_stop()
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = ImprovedMainWindow()
    app.run()
