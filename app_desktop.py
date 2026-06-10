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

    window = webview.create_window("Zaber / FUTEK Test GUI", url, width=1280, height=860)

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
