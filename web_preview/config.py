# shared configuration for the local python backend modules.
# computes the served web_preview folder (frozen-aware), the host/port, and
# holds the desktop window handle used by the native folder picker.
import sys
from pathlib import Path

# web_preview is the folder being served in the browser. When packaged with
# PyInstaller the app runs "frozen": files unpack into sys._MEIPASS, so the
# usual __file__ path no longer points at them.
if getattr(sys, "frozen", False):
    PROJECT_ROOT = Path(sys._MEIPASS)
    ROOT = PROJECT_ROOT / "web_preview"
else:
    ROOT = Path(__file__).resolve().parent
    PROJECT_ROOT = ROOT.parent

HOST = "127.0.0.1"
PREFERRED_PORT = 8765

# set by the desktop launcher via run_web_gui.set_desktop_window so the folder
# button can use the native pywebview dialog instead of an OS shell command.
DESKTOP_WINDOW = None

# add the project folder so the backend can import the hardware files.
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
