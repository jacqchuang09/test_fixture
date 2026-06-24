# Headless capture of Feature 1.5 (EM Test Page) evidence.
# UI state only - opens the EM Testing Window exactly as openEmTest() does and
# screenshots the genuine on-open state. NO hardware: START is never clicked.
# Everything else in 1.5 (state machine, motion, force limits, disconnects,
# analysis) is behavioral/hardware and stays blank in the doc.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_5")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1300)

def js(s): return d.execute_script(s)

d.get(URL); time.sleep(1.0)
# Open the EM Testing Window the same way Begin Test does (no hardware involved).
js("openEmTest()")
time.sleep(0.8)

print("pill:", js("return document.querySelector('#emState .state-tag').textContent"))
print("start disabled:", js("return document.getElementById('emStartButton').disabled"))
print("pause disabled:", js("return document.getElementById('emPauseButton').disabled"))
print("analysis disabled:", js("return document.getElementById('emAnalysisButton').disabled"))
print("status:", js("return document.getElementById('emStatus').textContent"))

el = d.find_element("css selector", "#emTestModal")
name = "1.5.1 #1 em testing window.png"
el.screenshot(os.path.join(OUT, name))
print("saved", name)
d.quit()
