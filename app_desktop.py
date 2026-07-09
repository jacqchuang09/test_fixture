# Double-clickable desktop launcher for the Zaber/FUTEK GUI.
# It starts the same local HTTP backend used by the browser version, then shows
# the page in a native window (pywebview) instead of a browser tab.
# Build into a .app/.exe with: pyinstaller app_desktop.spec

import sys
import threading
import time
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
from hardware import STATE


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
        # Closing the whole app while a test run is physically in progress would abandon
        # the actuator mid-motion. Ask with pywebview's NATIVE confirmation dialog rather
        # than the in-page one: while the OS is trying to close the window the in-page
        # dialog is not reliably clickable (its OK button appears dead), and it is a
        # dead-end anyway (dismissing it neither closes the app nor stops the test). The
        # native dialog gives a real, working choice:
        #   Cancel -> keep the app open, the test keeps running.
        #   OK     -> stop the run safely (the run loop halts and returns the actuator to
        #             home), WAIT for that to finish, then let the app close.
        if not ENGINE.is_running():
            return True
        close_anyway = window.create_confirmation_dialog(
            "Test in progress",
            "A test is running. Closing will stop it and return the actuator to a safe "
            "position. Close the app anyway?",
        )
        if not close_anyway:
            return False
        STATE.stop()   # request a safe stop; the run loop halts and homes the actuator
        # Hold the close until the run thread has actually finished homing, so the
        # actuator is never left mid-motion when the process exits and the server stops.
        deadline = time.time() + 30.0
        while ENGINE.is_running() and time.time() < deadline:
            time.sleep(0.1)
        return True

    window.events.closing += _on_closing

    try:
        webview.start()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
