# Double-clickable desktop launcher for the Zaber/FUTEK GUI.
# It starts the same local HTTP backend used by the browser version, then shows
# the page in a native window (pywebview) instead of a browser tab.
# Build into a .app/.exe with: pyinstaller app_desktop.spec

import sys
import threading
from pathlib import Path

# Make run_web_gui importable whether running from source or from a frozen bundle.
if getattr(sys, "frozen", False):
    BASE = Path(sys._MEIPASS)
else:
    BASE = Path(__file__).resolve().parent
WEB_PREVIEW = BASE / "web_preview"
if str(WEB_PREVIEW) not in sys.path:
    sys.path.insert(0, str(WEB_PREVIEW))

import webview

import run_web_gui
from run_engine import ENGINE


def main():
    server, url = run_web_gui.create_server()

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # Size the window to the operator's screen and open it at the top, so the whole
    # GUI fits the full height of the screen (the old fixed 860 px got cut off on
    # shorter screens). Keeps a sensible width; leaves room for the OS taskbar/title
    # bar. Falls back to the fixed size if the screen can't be read.
    win_width, win_height, win_x, win_y = 1280, 860, None, None
    try:
        screen = webview.screens[0]
        win_width = min(1280, screen.width - 40)
        win_height = max(700, screen.height - 80)
        win_x = max(0, (screen.width - win_width) // 2)
        win_y = 0
    except Exception:
        pass

    window = webview.create_window(
        "Zaber / FUTEK Test GUI", url,
        width=win_width, height=win_height, x=win_x, y=win_y,
    )

    # let the backend's folder button use the native pywebview dialog.
    run_web_gui.set_desktop_window(window)

    def _on_closing():
        # Do not let the operator close the whole app while a test run is
        # physically in progress - that would abandon the actuator mid-motion.
        # Returning False cancels the close; a paused/idle test closes normally.
        if ENGINE.is_running():
            try:
                window.evaluate_js(
                    "window.showErrorDialog && showErrorDialog("
                    "'A test is running. Pause or stop it before closing the app.',"
                    "'Test in progress')"
                )
            except Exception:
                pass
            return False
        return True

    window.events.closing += _on_closing

    try:
        webview.start()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
