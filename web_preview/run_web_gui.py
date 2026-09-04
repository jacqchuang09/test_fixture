# entry point for the local python backend.
# this stays the import target for app_desktop.py and the PyInstaller spec
# (hiddenimports=["run_web_gui"]); the heavy logic now lives in the
# hardware / analysis / server modules.
import os
import socket
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer

import config
from config import HOST, PREFERRED_PORT, PROJECT_ROOT
from server import Handler


def set_desktop_window(window):
    # desktop launcher hands us the pywebview window so the folder picker can
    # use the native dialog. stored on config so the Handler sees the live value.
    config.DESKTOP_WINDOW = window


def open_browser(url):
    # double-click runs should open chrome automatically.
    try:
      subprocess.Popen(["open", "-a", "Google Chrome", url])
    except Exception:
      subprocess.Popen(["open", url])


def find_free_port(preferred):
    # try 8765 first, but move to another open port if it is already busy.
    # use 8765 when possible, otherwise pick a free port.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, preferred))
            return preferred
        except OSError:
            pass

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def create_server():
    # build the local server and return it with the page url.
    # shared by the cli launcher (main) and the desktop launcher (app_desktop.py).
    os.chdir(PROJECT_ROOT)
    port = find_free_port(PREFERRED_PORT)
    server = ThreadingHTTPServer((HOST, port), Handler)
    url = f"http://{HOST}:{port}/index.html"
    return server, url


def main():
    # command line entry point used by: python3 -u run_web_gui.py --no-open
    # start the local server that connects the browser to python.
    server, url = create_server()
    if "--no-open" not in sys.argv:
        threading.Timer(0.4, open_browser, args=(url,)).start()
    print(f"Zaber browser GUI running at {url}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
