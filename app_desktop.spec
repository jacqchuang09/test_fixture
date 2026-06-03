# PyInstaller spec for the Zaber/FUTEK desktop app.
# Build on each OS separately (PyInstaller does not cross-compile):
#   Mac:     pyinstaller app_desktop.spec   ->  dist/ZaberGUI.app
#   Windows: pyinstaller app_desktop.spec   ->  dist\ZaberGUI\ZaberGUI.exe
import sys

block_cipher = None

# index.html is served from disk at runtime, so it must ship as a real file.
# The cli wrappers sit at the project root, which run_web_gui adds to sys.path.
datas = [
    ("web_preview/index.html", "web_preview"),
    ("web_preview/styles.css", "web_preview"),
    ("web_preview/js", "web_preview/js"),
    ("web_preview/vendor/plotly.min.js", "web_preview/vendor"),
    # bundled real sample dataset (+ generated plots) so EM analysis can be
    # demonstrated from saved data with no hardware/input stream attached.
    ("web_preview/sample_data", "web_preview/sample_data"),
    ("zaber_cli.py", "."),
    ("futek_cli.py", "."),
]

# The FUTEK load cell uses .NET DLLs via pythonnet — Windows only.
# The DLLs live in libs/windows/ and are copied next to the exe (dest ".") so
# pythonnet/.NET resolves them at runtime (see futek_cli._register_dll_dir).
binaries = []
if sys.platform.startswith("win"):
    for dll in (
        "FTD2XX_NET.dll",
        "FUTEK USB DLL.dll",
        "FUTEK.Devices.dll",
        "FUTEK_Devices.dll",
        "FUTEK_USB_DLL.dll",
        "Newtonsoft.Json.dll",
    ):
        binaries.append((f"libs/windows/{dll}", "."))

a = Analysis(
    ["app_desktop.py"],
    pathex=["web_preview"],
    binaries=binaries,
    datas=datas,
    hiddenimports=[
        "run_web_gui", "config", "hardware", "analysis", "server", "run_engine", "run_log", "futek_cli",
        "em_analysis", "shear_analysis", "manual_analysis", "plot_style",
        # matplotlib picks the SVG writer dynamically from savefig(format="svg"),
        # so PyInstaller's static scan misses it — bundle the backend explicitly.
        "matplotlib.backends.backend_svg", "matplotlib.backends.backend_agg",
        # zaber + serial are imported lazily inside hardware.py / zaber_cli.py,
        # so PyInstaller's static scan misses them — list them explicitly.
        "zaber_cli", "zaber_motion", "zaber_motion.ascii",
        "serial", "serial.tools", "serial.tools.list_ports",
        # em_analysis (Emilio's real EM pipeline) is imported lazily inside
        # analysis.py and pulls in the scientific stack. PyInstaller's hooks
        # collect the heavy packages, but the lazy import is listed explicitly.
        "em_analysis",
        "numpy", "pandas", "scipy", "scipy.signal", "scipy.ndimage",
        "matplotlib", "openpyxl",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ZaberGUI",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="ZaberGUI",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="ZaberGUI.app",
        icon=None,
        bundle_identifier="com.zaber.testgui",
    )
