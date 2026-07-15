# Supplementary capture: the forced confirm/error DIALOGS that are not tied to
# live motion (so they are safe to capture headlessly). NO motion, no Start/Stop,
# no /api calls. Each dialog is shown directly via the GUI's own helper
# (promptConfirm / showErrorDialog) with the exact text the window uses, then the
# dialog element is screenshotted.
#   1.9.12 #1   Manual close-mid-move confirm dialog
#   1.11.14 #1  Fatigue close-mid-run confirm dialog
#   1.10.1 #3   Manual analysis "Capacitance data needed" dialog (new behavior)
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
BASE = os.path.dirname(__file__)


def newd():
    o = Options()
    for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
        o.add_argument(a)
    dr = webdriver.Chrome(options=o)
    dr.set_window_size(1500, 1300)
    return dr


def cap(d, feat, sel, name):
    outdir = os.path.join(BASE, "qa_evidence_" + feat)
    os.makedirs(outdir, exist_ok=True)
    d.find_element("css selector", sel).screenshot(os.path.join(outdir, name))
    print("saved", feat, name)


# 1.9.12 #1 - Manual: closing during an active move shows the stop-and-close confirm.
d = newd(); d.get(URL); time.sleep(1.0)
d.execute_script("openManualTest();"); time.sleep(0.6)
d.execute_script('promptConfirm("The actuator is moving. Closing will stop motion and return it home. Continue?", '
                 '{title:"Actuator moving", confirmLabel:"Stop & Close", cancelLabel:"Cancel"});')
time.sleep(0.4)
cap(d, "1_9", "#confirmDialog", "1.9.12 #1 close mid-test dialog.png")
d.quit()

# 1.11.14 #1 - Fatigue: closing a running fatigue test shows the stop-and-close confirm.
d = newd(); d.get(URL); time.sleep(1.0)
d.execute_script("openCyclicalTest();"); time.sleep(0.6)
d.execute_script('promptConfirm("A fatigue test is in progress. Closing will stop the test and return the actuator to a safe position. Continue?", '
                 '{title:"Test in progress", confirmLabel:"Stop & Close", cancelLabel:"Cancel"});')
time.sleep(0.4)
cap(d, "1_11", "#confirmDialog", "1.11.14 #1 close mid-test dialog.png")
d.quit()

# 1.10.1 #3 - Manual analysis prompts for a CAP file when none is present (new behavior).
d = newd(); d.get(URL); time.sleep(1.0)
d.execute_script("openManualTest();"); time.sleep(0.6)
d.execute_script('showErrorDialog("Manual analysis needs capacitance data for every run. Add the capacitance file(s) for each run to the test folder\'s CAP folder, then run analysis again.", "Capacitance data needed");')
time.sleep(0.4)
cap(d, "1_10", "#errorDialog", "1.10.1 #3 capacitance data needed.png")
d.quit()

print("=== done ===")
