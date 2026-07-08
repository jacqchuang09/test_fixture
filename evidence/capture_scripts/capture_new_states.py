# Force-render the NEW-row UI states added in the latest reconciliation.
# Uses the GUI's own state setters / dialog helpers with the real code messages.
# NO hardware, NO motion, NO Start/Stop — pure display evidence.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
BASE = os.path.dirname(__file__)

def newd():
    opts = Options()
    for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
        opts.add_argument(a)
    d = webdriver.Chrome(options=opts); d.set_window_size(1500, 1300); return d

def cap(d, feat, sel, name):
    outdir = os.path.join(BASE, "qa_evidence_" + feat)
    os.makedirs(outdir, exist_ok=True)
    d.find_element("css selector", sel).screenshot(os.path.join(outdir, name)); print("saved", feat, name)

# 1.2.7 #11 - Begin Test live-connection gate: the real-rig Zaber block modal.
d = newd(); d.get(URL); time.sleep(1.0)
d.execute_script('showErrorDialog("Could not connect to the Zaber actuator on COM3. Check the connection and try again.","Connect a Zaber first");')
time.sleep(0.4); cap(d, "1_2", "#errorDialog", "1.2.7 #11 begin test live gate.png"); d.quit()

# 1.5.8 #5 - EM load-cell disconnect (distinct load-cell message; recovery context).
d = newd(); d.get(URL); time.sleep(1.0); d.execute_script("openEmTest()"); time.sleep(0.5)
d.execute_script('setEmState("DISCONNECTED","Load cell disconnected during the run. Run invalidated.","discarded");'
                 'emStartButton.disabled=false; emPauseButton.disabled=true;')
time.sleep(0.4); cap(d, "1_5", "#emTestModal", "1.5.8 #5 load cell recovery.png"); d.quit()

# 1.9.11 #4 - Manual load-cell drop -> stop AND return home.
d = newd(); d.get(URL); time.sleep(1.0); d.execute_script("openManualTest()"); time.sleep(0.5)
d.execute_script('setManualState("DISCONNECTED","Load cell disconnected during the move. Actuator stopped and returned home.");')
time.sleep(0.4); cap(d, "1_9", "#manualTestModal", "1.9.11 #4 load cell recovery.png"); d.quit()

# 1.11.12 #4 - Fatigue load-cell disconnect.
d = newd(); d.get(URL); time.sleep(1.0); d.execute_script("openCyclicalTest()"); time.sleep(0.5)
d.execute_script('setStatePill("cyclicalState","DISCONNECTED","Load cell disconnected during the fatigue test. Run invalidated.","discarded");')
time.sleep(0.4); cap(d, "1_11", "#cyclicalTestModal", "1.11.12 #4 load cell recovery.png"); d.quit()

print("=== done ===")
