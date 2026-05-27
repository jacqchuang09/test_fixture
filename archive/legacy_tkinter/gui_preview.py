import tkinter as tk
from tkinter import filedialog, ttk


class ZaberGuiPreview:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Zaber Stage Material Testing Setup")
        self.root.geometry("900x720")
        self.root.minsize(760, 620)

        self.saved_path = tk.StringVar()
        self.sensor_id = tk.StringVar()
        self.sensor_type = tk.StringVar(value="Standard")
        self.test_type = tk.StringVar(value="EM")
        self.n_runs = tk.IntVar(value=3)
        self.zaber_comport = tk.StringVar(value="COM3")
        self.surface_area = tk.StringVar(value="325mm2")
        self.pause_between_runs = tk.BooleanVar(value=True)

        self._style()
        self._build()

    def _style(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Title.TLabel", font=("Segoe UI", 20, "bold"))
        style.configure("Subtitle.TLabel", font=("Segoe UI", 10), foreground="#5f6368")
        style.configure("Section.TLabelframe", padding=12)
        style.configure("Section.TLabelframe.Label", font=("Segoe UI", 12, "bold"))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), padding=10)
        style.configure("Big.TButton", font=("Segoe UI", 11, "bold"), padding=12)

    def _build(self):
        main = ttk.Frame(self.root, padding=24)
        main.pack(fill="both", expand=True)

        ttk.Label(main, text="Zaber Stage Material Testing Setup", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            main,
            text="Preview mode: layout only. Hardware will be wired after this screen looks right.",
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(4, 20))

        self._basic_settings(main)
        self._test_config(main)
        self._status(main)
        self._buttons(main)

    def _basic_settings(self, parent):
        card = ttk.LabelFrame(parent, text="Basic Settings", style="Section.TLabelframe")
        card.pack(fill="x", pady=(0, 16))

        ttk.Label(card, text="Save Folder").grid(row=0, column=0, sticky="w", pady=6)
        ttk.Entry(card, textvariable=self.saved_path).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(card, text="Browse", command=self._browse).grid(row=0, column=2, sticky="ew")

        ttk.Label(card, text="Sensor ID").grid(row=1, column=0, sticky="w", pady=6)
        ttk.Entry(card, textvariable=self.sensor_id).grid(row=1, column=1, columnspan=2, sticky="ew", padx=8)

        ttk.Label(card, text="Sensor Type").grid(row=2, column=0, sticky="w", pady=6)
        ttk.Combobox(
            card,
            textvariable=self.sensor_type,
            values=("Standard", "Inverted"),
            state="readonly",
        ).grid(row=2, column=1, columnspan=2, sticky="ew", padx=8)

        card.columnconfigure(1, weight=1)

    def _test_config(self, parent):
        card = ttk.LabelFrame(parent, text="Test Configuration", style="Section.TLabelframe")
        card.pack(fill="x", pady=(0, 16))

        ttk.Label(card, text="Test Type").grid(row=0, column=0, sticky="w", pady=6)
        ttk.Combobox(
            card,
            textvariable=self.test_type,
            values=("EM", "Shear"),
            state="readonly",
        ).grid(row=0, column=1, sticky="ew", padx=8)

        ttk.Label(card, text="Number of Runs").grid(row=0, column=2, sticky="w", padx=(24, 0))
        ttk.Spinbox(card, from_=1, to=100, textvariable=self.n_runs, width=8).grid(row=0, column=3, sticky="ew", padx=8)

        ttk.Label(card, text="Zaber COM Port").grid(row=1, column=0, sticky="w", pady=6)
        ttk.Entry(card, textvariable=self.zaber_comport).grid(row=1, column=1, sticky="ew", padx=8)

        ttk.Label(card, text="Surface Area").grid(row=1, column=2, sticky="w", padx=(24, 0))
        ttk.Entry(card, textvariable=self.surface_area).grid(row=1, column=3, sticky="ew", padx=8)

        ttk.Checkbutton(
            card,
            text="Pause between runs",
            variable=self.pause_between_runs,
        ).grid(row=2, column=1, columnspan=2, sticky="w", pady=(10, 0))

        card.columnconfigure(1, weight=1)
        card.columnconfigure(3, weight=1)

    def _status(self, parent):
        card = ttk.LabelFrame(parent, text="Current Status", style="Section.TLabelframe")
        card.pack(fill="both", expand=True, pady=(0, 16))

        self.status = tk.Text(card, height=10, wrap="word", font=("Consolas", 10), bg="#f8f9fa")
        self.status.pack(fill="both", expand=True)
        self.status.insert("end", "[Preview] GUI loaded successfully.\n")
        self.status.insert("end", "[Preview] Choose settings, then open the test/control windows.\n")
        self.status.configure(state="disabled")

    def _buttons(self, parent):
        row = ttk.Frame(parent)
        row.pack(fill="x")

        ttk.Button(row, text="Begin Test", style="Big.TButton", command=self._open_test_window).pack(
            side="left", fill="x", expand=True, padx=(0, 8)
        )
        ttk.Button(row, text="Open Calibration", style="Big.TButton", command=self._open_calibration).pack(
            side="left", fill="x", expand=True, padx=8
        )
        ttk.Button(row, text="Control Panel", style="Big.TButton", command=self._open_control).pack(
            side="left", fill="x", expand=True, padx=(8, 0)
        )

    def _browse(self):
        folder = filedialog.askdirectory()
        if folder:
            self.saved_path.set(folder)

    def _open_test_window(self):
        win = tk.Toplevel(self.root)
        win.title("Zaber Control Stage")
        win.geometry("720x500")
        ttk.Label(win, text="Zaber Control Stage", font=("Segoe UI", 18, "bold")).pack(anchor="w", padx=20, pady=20)
        text = tk.Text(win, height=14, bg="#f8f9fa", font=("Consolas", 10))
        text.pack(fill="both", expand=True, padx=20, pady=(0, 16))
        text.insert("end", "[Preview] Test window opened.\n")
        text.insert("end", "[Preview] Hardware Start / Pause / Stop controls will go here.\n")
        row = ttk.Frame(win, padding=(20, 0, 20, 20))
        row.pack(fill="x")
        ttk.Button(row, text="Start").pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(row, text="Pause").pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(row, text="Stop").pack(side="left", fill="x", expand=True, padx=(6, 0))

    def _open_calibration(self):
        win = tk.Toplevel(self.root)
        win.title("Calibration")
        win.geometry("620x520")
        ttk.Label(win, text="Calibration: Lower Load Cell + Fuji Film Test", font=("Segoe UI", 15, "bold")).pack(
            anchor="w", padx=20, pady=20
        )
        ttk.Label(win, text="Position: 0.00 mm").pack(anchor="w", padx=20)
        ttk.Label(win, text="Force: 0.0 lbs").pack(anchor="w", padx=20, pady=(4, 16))
        ttk.Button(win, text="Move Up").pack(fill="x", padx=20, pady=5)
        ttk.Button(win, text="Move Down").pack(fill="x", padx=20, pady=5)
        ttk.Button(win, text="Begin Fuji Film Pushing").pack(fill="x", padx=20, pady=5)
        ttk.Button(win, text="Extract Feature").pack(fill="x", padx=20, pady=5)

    def _open_control(self):
        win = tk.Toplevel(self.root)
        win.title("Zaber Control Panel")
        win.geometry("640x420")
        ttk.Label(win, text="Zaber Control Panel", font=("Segoe UI", 18, "bold")).pack(anchor="w", padx=20, pady=20)
        ttk.Label(win, text="COM Port").pack(anchor="w", padx=20)
        ttk.Entry(win, textvariable=self.zaber_comport).pack(fill="x", padx=20, pady=6)
        ttk.Button(win, text="Connect").pack(fill="x", padx=20, pady=6)
        ttk.Button(win, text="Home").pack(fill="x", padx=20, pady=6)
        ttk.Button(win, text="Park / Unpark").pack(fill="x", padx=20, pady=6)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    ZaberGuiPreview().run()
