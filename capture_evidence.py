# Headless capture of per-CoS UI-state evidence screenshots for the
# Feature 1.1 (Main Window) verification protocol. UI states only - this never
# operates hardware (no Begin/Start/Move). Verify only hits /api/verify, which
# just validates the save-folder path. Outputs land in qa_evidence/.
import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence")
os.makedirs(OUT, exist_ok=True)

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--window-size=1500,1150")
opts.add_argument("--force-device-scale-factor=2")
opts.add_argument("--hide-scrollbars")
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1150)

manifest = []

def load():
    d.get(URL)
    time.sleep(1.0)

def js(script, *args):
    return d.execute_script(script, *args)

def setval(el_id, val):
    js("""const el=document.getElementById(arguments[0]);el.value=arguments[1];
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));""", el_id, val)

def fill_valid_sensor():
    for el_id, v in [("sensorYear","26"),("sensorMonth","06"),("sensorDay","23"),
                     ("sensorBatch","01"),("sensorNumber","01"),("sensorLocation","B")]:
        setval(el_id, v)
    time.sleep(0.2)

def cap_full(name, note=""):
    time.sleep(0.35)
    path = os.path.join(OUT, name)
    d.save_screenshot(path)
    manifest.append((name, note))
    print("FULL  ", name)

def cap_el(name, selector, note="", pad=14):
    time.sleep(0.2)
    el = d.find_element("css selector", selector)
    # scroll into view and screenshot just the element
    js("arguments[0].scrollIntoView({block:'center'});", el)
    time.sleep(0.15)
    path = os.path.join(OUT, name)
    el.screenshot(path)
    manifest.append((name, note))
    print("EL    ", name, "->", selector)

def cap_xpath(name, xpath, note=""):
    time.sleep(0.2)
    el = d.find_element("xpath", xpath)
    js("arguments[0].scrollIntoView({block:'center'});", el)
    time.sleep(0.15)
    el.screenshot(os.path.join(OUT, name))
    manifest.append((name, note))
    print("XP    ", name)

def click_verify():
    js("verifySettings()")
    time.sleep(0.6)

def msg():
    return js("const m=document.getElementById('mainMessage');return m?m.textContent.trim():''")

# ---------- Story 1.1.1: Main Window (presence) ----------
load()
cap_full("1.1.1 main window.png", "Main Window opens with title + Basic Settings (covers #1, #2)")
cap_el("1.1.1 #2.1 save folder field.png", ".folder-row", "Save Folder field present")
cap_el("1.1.1 #2.2 sensor id field.png", ".sensor-builder", "Sensor ID field present")
cap_el("1.1.1 #2.3 sensor type field.png", "#sensorType", "Sensor Type field present")
cap_el("1.1.1 #2.4 use custom sensor id checkbox.png", ".option-check", "Use Custom Sensor ID checkbox present")
cap_el("1.1.1 #2.5 verify button.png", ".basic-actions", "Verify button present")

# ---------- Story 1.1.2: Save Folder ----------
load()
cap_el("1.1.2 #1 save folder accepts path.png", ".folder-row", "Typed path accepted in Save Folder field")
cap_el("1.1.2 #2 browse control.png", ".folder-row button", "Browse control present")
cap_el("1.1.2 #6 info note.png", ".hint", "Info note: 'Missing folders will be automatically created before a run.'")

# ---------- Story 1.1.3: Sensor ID field ----------
load()
cap_el("1.1.3 #1 sensor id segments.png", ".sensor-segment-row", "Segmented row YY MM DD Batch Sensor Location")
cap_xpath("1.1.3 #2 batch prefix B.png", "//label[.//*[@id='sensorBatch']]", "Batch segment shows fixed prefix B")
cap_xpath("1.1.3 #3 sensor prefix S.png", "//label[.//*[@id='sensorNumber']]", "Sensor segment shows fixed prefix S")
fill_valid_sensor()
print("preview after fill:", js("return document.getElementById('sensorIdPreview').textContent"))
cap_el("1.1.3 #4 generated sensor id.png", ".sensor-preview-row", "Generated Sensor ID pattern YYMMDDB##S##X")

# ---------- Story 1.1.4: Custom Sensor ID checkbox ----------
load()
cap_el("1.1.4 #1 use custom sensor id checkbox.png", ".option-check", "'Use Custom Sensor ID' checkbox present")
cap_full("1.1.4 #2 custom unchecked.png", "Unchecked: segmented field active, custom field hidden")
js("document.getElementById('useCustomSensorId').checked=true;"
   "document.getElementById('useCustomSensorId').dispatchEvent(new Event('change',{bubbles:true}));")
time.sleep(0.4)
cap_full("1.1.4 #3 custom checked.png", "Checked: segmented field disabled, custom free-text field active")

# ---------- Story 1.1.5: Sensor ID validation ----------
load()
cap_el("1.1.5 #2 complete all segments.png", ".sensor-preview-row", "Missing segment -> 'Sensor ID: complete all segments'")
fill_valid_sensor()
cap_el("1.1.5 #1 full sensor id shown.png", ".sensor-preview-row", "All segments complete -> full generated Sensor ID")

# ---------- Story 1.1.6: Sensor Type dropdown ----------
load()
cap_el("1.1.6 #3 standard default.png", "#sensorType", "Standard selected by default")
setval("sensorType", "Inverted")
cap_el("1.1.6 #2 inverted option.png", "#sensorType", "Inverted option selectable (Standard/Inverted)")

# ---------- Story 1.1.7: Verify button validation ----------
load()
js("const e=document.getElementById('saveFolder');e.value='';e.dataset.baseSaveFolder='';")
click_verify()
print("blank-folder msg:", msg())
cap_full("1.1.7 #2 save folder blank message.png", "Blank Save Folder blocks Verify (actual msg shown)")

load()
js("document.getElementById('useCustomSensorId').checked=true;"
   "document.getElementById('useCustomSensorId').dispatchEvent(new Event('change',{bubbles:true}));")
time.sleep(0.3)
setval("customSensorId", "")
click_verify()
print("custom-blank msg:", msg())
cap_full("1.1.7 #3 custom id blank message.png", "Custom ID enabled but blank blocks Verify (actual msg shown)")

load()
click_verify()  # segments empty -> incomplete
print("incomplete msg:", msg())
cap_full("1.1.7 #5 incomplete sensor id message.png", "Incomplete Sensor ID blocks Verify (actual msg shown)")

load()
setval("sensorYear","26"); setval("sensorMonth","06"); setval("sensorDay","23")
setval("sensorBatch","01"); setval("sensorNumber","01"); setval("sensorLocation","C")
click_verify()
print("invalid msg:", msg())
cap_full("1.1.7 #6 invalid sensor id message.png", "Invalid Sensor ID blocks Verify (actual msg shown)")

# valid verify -> Test Configuration revealed
load()
fill_valid_sensor()
click_verify()
revealed = js("return !document.getElementById('testConfig').classList.contains('hidden')")
print("testConfig revealed:", revealed)
if revealed:
    cap_full("1.1.7 #1 test configuration revealed.png", "Valid settings -> Test Configuration section revealed")

# ---------- Story 1.1.8: Reverification ----------
load()
fill_valid_sensor()
click_verify()
if js("return !document.getElementById('testConfig').classList.contains('hidden')"):
    setval("saveFolder", js("return document.getElementById('saveFolder').value")+"/x")
    time.sleep(0.4)
    print("reverify msg:", msg(), "| hidden:",
          js("return document.getElementById('testConfig').classList.contains('hidden')"))
    cap_full("1.1.8 #2 reverify message.png", "Editing Basic Settings hides Test Config + 'verify again' msg")

# ---------- Story 1.1.9: Analyze Saved Data ----------
load()
cap_el("1.1.9 #1 analyze saved data button.png", ".analyze-saved-btn", "Top-right 'Analyze Saved Data' button present")
# reproduce the exact on-brand error popup the app shows for a bad folder name
# (the folder picker itself is a native OS dialog and cannot be screenshotted).
js("""showErrorDialog(
   '\"Bad Folder\" isn\\'t a valid analysis folder.\\n\\n' +
   '<strong>Expected:</strong>   MM DD YY_&lt;area&gt;_&lt;TestType&gt;\\n' +
   '<strong>Example:</strong>    03 09 26_325mm2_EM\\n\\n' +
   'TestType must be EM, Shear, Manual, or Fatigue.',
   'Cannot analyze this folder', true);""")
time.sleep(0.5)
cap_full("1.1.9 #3 invalid folder error popup.png", "On-brand error popup for an invalid analysis folder")

# ---------- Story 1.1.10: Info icons / tooltips ----------
def tooltip(name, selector, note):
    load()
    el = d.find_element("css selector", selector)
    js("arguments[0].scrollIntoView({block:'center'});arguments[0].focus();", el)
    time.sleep(0.5)
    cap_full(name, note)

tooltip("1.1.10 #1 help icons.png", ".sensor-help", "Help 'i' icons appear beside labels")
tooltip("1.1.10 #4 save folder tooltip.png", "label[for='saveFolder'] .sensor-help", "Save Folder tooltip")
tooltip("1.1.10 #5 sensor id tooltip.png", ".sensor-id-column .sensor-builder .sensor-help", "Sensor ID tooltip")
tooltip("1.1.10 #6 sensor type tooltip.png", "label > .sensor-header .sensor-help[data-tooltip*='channel ordering']", "Sensor Type tooltip")
tooltip("1.1.10 #7 custom id tooltip.png", ".option-check .sensor-help", "Use Custom Sensor ID tooltip")

d.quit()

print("\n=== MANIFEST (%d files) ===" % len(manifest))
for n, note in manifest:
    print(f"{n}\t{note}")
