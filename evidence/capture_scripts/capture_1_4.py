# Headless capture of Feature 1.4 (Calibration Page) evidence screenshots.
# UI states only - never operates hardware. The modal is opened the same way the
# app does (initializeCalibrationSettings + showModal); no motion is triggered.
# The two snap messages are produced by the global snap-on-commit handler
# (dispatching a 'change' with an out-of-range value), which writes the limit
# message to the calibration log - exactly what an operator would see on commit.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_4")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1500,1500", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1500)
manifest = []

def js(s, *a): return d.execute_script(s, *a)

def open_calib():
    # fresh page each time so the calibration log starts clean. Clear the
    # remembered increment/extrusion so the gating (disabled Start) shows.
    d.get(URL); time.sleep(1.0)
    js("""try{localStorage.removeItem('zaberLastExtrusionDistance');
            localStorage.removeItem('zaberLastCalibrationIncrement');}catch(e){}
          initializeCalibrationSettings();
          setPositionReadout(17);
          calibrationModal.showModal();""")
    time.sleep(0.5)

def snap(id_, value):
    # commit an out-of-range value -> global snap handler clamps + logs the limit message
    js("""var e=document.getElementById(arguments[0]); e.value=arguments[1];
          e.dispatchEvent(new Event('change',{bubbles:true}));""", id_, value)
    time.sleep(0.4)

def cap_modal(name, note):
    el = d.find_element("css selector", "#calibrationModal")
    el.screenshot(os.path.join(OUT, name)); manifest.append((name, note)); print("MODAL", name)

# ---- 1: full Calibration Window overview ----
# Covers 1.4.1 #1 (title), #2 (READY state pill), #3/#3.1/#3.2/#3.3/#3.4 (controls),
# 1.4.5 #6 (extrusion field blank -> Start disabled = gating), 1.4.7 #1 (x close).
open_calib()
print("fuji disabled:", js("return document.getElementById('fujiFilmButton').disabled"))
cap_modal("1.4.1 #1 calibration window.png",
          "Calibration Window: title, READY pill, Current Status, Manual Increment Control, "
          "Start Fuji (disabled - extrusion blank), x close")

# ---- 2: Increment Distance out-of-range snap message ----
# Covers 1.4.3 #3 (range 0.1-12 enforced) and 1.4.3 #5 (snap + limit message).
open_calib()
snap("incrementDistance", "20")
print("increment after snap:", js("return document.getElementById('incrementDistance').value"))
print("log:", js("return document.getElementById('calibrationLog').textContent"))
cap_modal("1.4.3 #5 increment distance snap message.png",
          "Out-of-range Increment Distance snaps to 12 and logs 'Increment Distance must be between 0.1 and 12 mm.'")

# ---- 3: Extrusion Distance out-of-range snap message ----
# Covers 1.4.5 #7 (snap + limit message).
open_calib()
snap("extrusionDistance", "20")
print("extrusion after snap:", js("return document.getElementById('extrusionDistance').value"))
print("log:", js("return document.getElementById('calibrationLog').textContent"))
cap_modal("1.4.5 #7 extrusion distance snap message.png",
          "Out-of-range Extrusion Distance snaps to 12 and logs 'Extrusion Distance must be between 0.5 and 12 mm.'")

d.quit()
print("\n=== MANIFEST (%d) ===" % len(manifest))
for n, note in manifest: print(n, "\t", note)
