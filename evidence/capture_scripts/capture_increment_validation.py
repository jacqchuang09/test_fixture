# Capture Feature 1.4.3 #6 evidence: a non-numeric Increment Distance (".", "-", "+")
# is blocked with "increment distance must be a valid number" instead of jogging the
# 0.1 default. Forces the state via JS - the move is BLOCKED before any motion, so this
# performs NO hardware motion.
import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_4")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1300)
d.get(URL)
time.sleep(1.0)

# open the calibration window, enter a non-numeric increment, and click Move Down.
# calibrationMove blocks (no motion) and logs the validation error.
d.execute_script("initializeCalibrationSettings(); document.getElementById('calibrationModal').showModal();")
d.execute_script("var e=document.getElementById('incrementDistance'); e.value='.'; calibrationMove('down');")
time.sleep(0.4)
d.find_element("css selector", "#calibrationModal").screenshot(
    os.path.join(OUT, "1.4.3 #6 increment must be a valid number.png"))
print("saved 1.4.3 #6 increment validation")
d.quit()
