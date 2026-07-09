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

    # Tracks an in-progress stop-and-close so repeat close attempts don't re-prompt or
    # re-launch the worker.
    shutdown_state = {"active": False}

    def _finish_close():
        # Runs on a BACKGROUND thread so the GUI thread - and the "Closing…" overlay - stay
        # live while the actuator stops. Doing this wait inline in the close handler would
        # freeze the window (it runs on the GUI thread), so the overlay would never paint.
        # Stops the motion safely (a run halts + returns home; a jog halts in place), waits
        # for it to finish, then destroys the window (which lets webview.start() return and
        # shuts the server down in the finally below).
        STATE.stop()
        deadline = time.time() + 30.0
        while (ENGINE.is_running() or STATE._move_loop_active) and time.time() < deadline:
            time.sleep(0.1)
        try:
            window.destroy()
        except Exception:
            pass

    def _on_closing():
        # A stop-and-close is already underway: block any further manual close attempts
        # until the actuator has finished, then let the programmatic destroy through.
        if shutdown_state["active"]:
            return not (ENGINE.is_running() or STATE._move_loop_active)
        # Nothing moving -> close normally.
        if not (ENGINE.is_running() or STATE._move_loop_active):
            return True
        # Motion in progress. Ask with pywebview's NATIVE confirmation dialog (the in-page
        # one is not reliably clickable during an OS window-close, and is a dead-end). This
        # covers BOTH threaded runs (EM/Fatigue/Shear/Fuji, is_running) AND synchronous
        # manual/calibration jogs and force moves (_move_loop_active).
        close_anyway = window.create_confirmation_dialog(
            "Motion in progress",
            "A test or move is in progress. Closing will stop the motion safely and close "
            "the app. Close anyway?",
        )
        if not close_anyway:
            return False
        # Confirmed: raise the "Closing…" overlay so the operator sees why the window is
        # still open, then hand off to the background worker. Cancel THIS close; the worker
        # destroys the window once the actuator is safe.
        shutdown_state["active"] = True
        try:
            window.evaluate_js("window.showShutdownOverlay && showShutdownOverlay()")
        except Exception:
            pass
        threading.Thread(target=_finish_close, daemon=True).start()
        return False

    window.events.closing += _on_closing

    try:
        webview.start()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
