# Re-capture ONLY 1.9.13 #6 (Target Force tooltip, force mode) after aligning
# the tooltip wording to the spec. No motion, no /api calls.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_9")
os.makedirs(OUT, exist_ok=True)
opts = Options()
for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts); d.set_window_size(1500, 1300)
def js(s, *a): return d.execute_script(s, *a)

d.get(URL); time.sleep(1.0)
js("openManualTest()"); time.sleep(0.7)
js("setManualControlMode('force')"); time.sleep(0.4)
text = js("""
  var f = document.getElementById('manualPrimaryControlField');
  var s = f.querySelector('.sensor-help');
  s.scrollIntoView({block:'center'});
  s.focus();
  return s.getAttribute('data-tooltip');
""")
time.sleep(0.4)
print("target force tooltip now: %r" % text)
d.find_element("css selector", "#manualTestModal").screenshot(os.path.join(OUT, "1.9.13 #6 target force tooltip.png"))
print("saved 1.9.13 #6 target force tooltip.png")
d.quit()
