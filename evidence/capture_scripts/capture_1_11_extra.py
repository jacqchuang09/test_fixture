# Extra Feature 1.11 evidence: the waveform-DEPENDENT frequency limit.
# Selecting Square lowers the max to 1 Hz (default 0.25); an out-of-range value
# snaps with the square-specific message. NO hardware, no Start/Stop.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_11")
os.makedirs(OUT, exist_ok=True)
opts = Options()
for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts); d.set_window_size(1500, 1300)
def js(s, *a): return d.execute_script(s, *a)

d.get(URL); time.sleep(1.0)
js("openCyclicalTest()"); time.sleep(0.8)

# Select Square -> max becomes 1 Hz, default 0.25 (waveform-dependent limit).
js("var w=document.getElementById('waveformType'); w.value='Square';"
   "w.dispatchEvent(new Event('change',{bubbles:true}));"); time.sleep(0.5)
freq_default = js("return document.getElementById('waveformFrequency').value")
freq_max = js("return document.getElementById('waveformFrequency').max")
print("square default freq:", freq_default, " max:", freq_max)
d.find_element("css selector", "#cyclicalTestModal").screenshot(os.path.join(OUT, "1.11.2 #1 square waveform selected.png"))
print("saved square waveform selected")

# Out-of-range frequency on Square -> snaps to 1 Hz with the square message.
js("var e=document.getElementById('waveformFrequency'); e.value='99';"
   "e.dispatchEvent(new Event('change',{bubbles:true}));"); time.sleep(0.5)
msg = js("return document.getElementById('cyclicalState').textContent.replace(/\\s+/g,' ').trim()")
print("square freq snap:", repr(msg))
d.find_element("css selector", "#cyclicalTestModal").screenshot(os.path.join(OUT, "1.11.5 #2 square frequency snap.png"))
print("saved square frequency snap")

d.quit()
print("=== done ===")
