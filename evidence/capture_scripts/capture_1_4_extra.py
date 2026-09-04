# Additional Feature 1.4 (Calibration) evidence: force-render the real Fuji-test
# output-box states + error modals (no hardware, no Fuji run) and screenshot them.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_4")
os.makedirs(OUT, exist_ok=True)
opts = Options()
for a in ["--headless=new", "--window-size=1500,1150", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts); d.set_window_size(1500, 1150)
def js(s): return d.execute_script(s)

def open_calib():
    d.get(URL); time.sleep(1.0)
    js("initializeCalibrationSettings(); setPositionReadout(17); calibrationModal.showModal();"); time.sleep(0.5)

def shot(sel, name):
    d.find_element("css selector", sel).screenshot(os.path.join(OUT, name)); print("saved", name)

# 1.4.6 #1/#2 + 1.4.5 #1 - Fuji running: output box "Fuji Film Test started" + headers + streaming, FUJI PRESS pill
open_calib()
js("""setCalibrationOutput(["[2:00:00 PM] Fuji Film Test started.","Time (s) | Force (N)","0.000 s | 0.0 N","0.100 s | 6.3 N","0.200 s | 12.8 N"]);
      setCalibrationControlsLocked(true, "FUJI PRESS", "pressing to 20 N - 12.8 N", "discarded");
      document.getElementById("fujiFilmButton").textContent = "Pushing... Target: 20 N";""")
time.sleep(0.4); shot("#calibrationModal", "1.4.6 #1 fuji running output.png")

# 1.4.6 #3 - Fuji completed successfully
open_calib()
js("""setCalibrationOutput(["[2:00:00 PM] Fuji Film Test started.","Time (s) | Force (N)","0.000 s | 0.0 N","1.900 s | 19.8 N","2.000 s | 20.0 N"]);
      addCalibrationUpdate("Fuji Film Test Completed Successfully.");
      setCalibrationControlsLocked(false, "READY", "calibration controls ready.", "kept");""")
time.sleep(0.4); shot("#calibrationModal", "1.4.6 #3 fuji completed.png")

# 1.4.8 #5 - FUTEK load cell failure message (exact engine string) shown in the calibration log
open_calib()
js("""addCalibrationUpdate("ERROR: Could not connect to the FUTEK load cell. Confirm it is plugged in and that you are running on Windows.");
      setCalibrationControlsLocked(false, "ERROR", "load cell connection failed.", "discarded");""")
time.sleep(0.4); shot("#calibrationModal", "1.4.8 #5 futek message.png")

# 1.4.8 #4 - Zaber connection modal (Open Calibration / pre-move gate)
open_calib()
js("""showErrorDialog("Could not connect to the Zaber actuator on COM3. Check the connection and try again.","Connect a Zaber first");""")
time.sleep(0.4); shot("#errorDialog", "1.4.8 #4 zaber connection modal.png")

# 1.4.10 #2 - mid-calibration actuator disconnect dialog (exact backend message)
open_calib()
js("""showDisconnectDialog("Actuator connection lost. Check the cable before continuing.");""")
time.sleep(0.4); shot("#errorDialog", "1.4.10 #2 disconnect dialog.png")

d.quit()
print("=== done ===")
for f in sorted(os.listdir(OUT)): print(" ", f)
