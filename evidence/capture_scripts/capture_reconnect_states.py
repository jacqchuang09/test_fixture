# Capture the post-disconnect calibration states (jog/Home/Fuji reconnect gate) and
# the Manual disconnect Start-resume state added in the disconnect-handling work.
# States are forced with the GUI's own setters using the real code messages.
# NO hardware, NO motion, NO Start/Stop - pure display evidence.
import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
BASE = os.path.dirname(__file__)


def newd():
    opts = Options()
    for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
        opts.add_argument(a)
    d = webdriver.Chrome(options=opts)
    d.set_window_size(1500, 1300)
    return d


def cap(d, feat, sel, name):
    outdir = os.path.join(BASE, "qa_evidence_" + feat)
    os.makedirs(outdir, exist_ok=True)
    d.find_element("css selector", sel).screenshot(os.path.join(outdir, name))
    print("saved", feat, name)


# 1.4.10 #4 - calibration jog reconnect gate: after a Zaber drop the window sits in
# DISCONNECTED with the controls re-enabled so a jog/Home/Fuji press can retry.
d = newd()
d.get(URL)
time.sleep(1.0)
d.execute_script("initializeCalibrationSettings(); calibrationModal.showModal();")
d.execute_script('setCalibrationControlsLocked(false,"DISCONNECTED",'
                 '"actuator disconnected - use the Zaber Launcher, then press a control to reconnect.","discarded");')
time.sleep(0.4)
cap(d, "1_4", "#calibrationModal", "1.4.10 #4 jog reconnect gate (disconnected).png")

# 1.4.10 #5 - RECONNECTING lock: while the connection check runs after a jog/Home/Fuji
# press, every control is locked and the RECONNECTING pill explains the state.
d.execute_script('setCalibrationControlsLocked(true,"RECONNECTING",'
                 '"reconnecting to the Zaber - please wait…","discarded");')
time.sleep(0.4)
cap(d, "1_4", "#calibrationModal", "1.4.10 #5 reconnecting lock.png")
d.quit()

# 1.9.11 #5 - Manual disconnect -> Start-gated DISCONNECTED: the live sampler stops and
# Start is re-armed; pressing Start after reconnecting resumes a fresh live readout.
d = newd()
d.get(URL)
time.sleep(1.0)
d.execute_script("openManualTest();")
time.sleep(0.6)
d.execute_script('setManualSessionActive(false); setManualState("DISCONNECTED",'
                 '"actuator disconnected - use the Zaber Launcher, then press Start to resume the live readout.");')
time.sleep(0.4)
cap(d, "1_9", "#manualTestModal", "1.9.11 #5 disconnect start-resume.png")
d.quit()

print("=== done ===")
