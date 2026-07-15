# Capture evidence for the three new test cases:
#   1.7.12 #1  Shear target-band flag (green when live force is 1.4-1.6 N)
#   1.9.14 #1  Manual position shown from home (home = 0 mm)
#   1.1.12 #1  Zaber connect message shown from home
# States are forced with the GUI's own display setters. NO hardware, NO motion.
import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
BASE = os.path.dirname(__file__)


def newd():
    o = Options()
    for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
        o.add_argument(a)
    d = webdriver.Chrome(options=o)
    d.set_window_size(1500, 1300)
    return d


def cap(d, feat, sel, name):
    out = os.path.join(BASE, "qa_evidence_" + feat)
    os.makedirs(out, exist_ok=True)
    d.find_element("css selector", sel).screenshot(os.path.join(out, name))
    print("saved", feat, name)


# 1.7.12 #1 - shear target-band flag GREEN (live force inside 1.4-1.6 N)
d = newd()
d.get(URL)
time.sleep(1.0)
d.execute_script("openShearTest();")
time.sleep(0.6)
d.execute_script('setShearState("RUNNING","live shear force: 1.500 N."); updateShearForceFlag(1.5);')
time.sleep(0.4)
cap(d, "1_7", "#shearTestModal", "1.7.12 #1 target-band flag green.png")
d.quit()

# 1.9.14 #1 - manual position from home (drag readout "position: X mm from home", slider 0-24)
d = newd()
d.get(URL)
time.sleep(1.0)
d.execute_script("openManualTest();")
time.sleep(0.6)
cap(d, "1_9", "#manualTestModal", "1.9.14 #1 position from home.png")
d.quit()

# 1.1.12 #1 - Zaber connect confirmation shown from home
d = newd()
d.get(URL)
time.sleep(1.0)
d.execute_script('setMainMessage("Connected to Zaber on COM3. Current position: 0.10 mm from home.","");')
time.sleep(0.4)
cap(d, "1_1", "#mainMessage", "1.1.12 #1 connect message from home.png")
d.quit()

print("=== done ===")
