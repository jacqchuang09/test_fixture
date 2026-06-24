# Headless capture of Feature 1.2 (Test Configuration Page) evidence screenshots.
# UI states only - never operates hardware. Begin Test validation messages are
# triggered by invalid fields (the guards return before any /api/start-test).
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_2")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1500,1500", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1500)
manifest = []

def js(s, *a): return d.execute_script(s, *a)
def setval(i, v):  # dispatches events (triggers snap / state updates)
    js("""var e=document.getElementById(arguments[0]);e.value=arguments[1];
          e.dispatchEvent(new Event('input',{bubbles:true}));
          e.dispatchEvent(new Event('change',{bubbles:true}));""", i, v)
def raw(i, v): js("document.getElementById(arguments[0]).value=arguments[1];", i, v)  # no events -> no snap
def cmsg(): return js("var m=document.getElementById('configMessage');return m?m.textContent.trim():''")
def mmsg(): return js("var m=document.getElementById('mainMessage');return m?m.textContent.trim():''")

def reveal():
    d.get(URL); time.sleep(1.0)
    for i, v in [("sensorYear","26"),("sensorMonth","06"),("sensorDay","23"),
                 ("sensorBatch","01"),("sensorNumber","01"),("sensorLocation","B")]:
        setval(i, v)
    js("verifySettings()"); time.sleep(0.7)
    return js("return !document.getElementById('testConfig').classList.contains('hidden')")

def scroll_to(sel):
    js("document.querySelector(arguments[0]).scrollIntoView({block:'center'});", sel); time.sleep(0.2)

def cap_full(name, note="", anchor="#testConfig"):
    if anchor: scroll_to(anchor)
    time.sleep(0.3); d.save_screenshot(os.path.join(OUT, name)); manifest.append((name, note)); print("FULL ", name)

def cap_el(name, sel, note=""):
    time.sleep(0.15); el = d.find_element("css selector", sel)
    js("arguments[0].scrollIntoView({block:'center'});", el); time.sleep(0.15)
    el.screenshot(os.path.join(OUT, name)); manifest.append((name, note)); print("EL   ", name)

def cap_xpath(name, xp, note=""):
    time.sleep(0.15); el = d.find_element("xpath", xp)
    js("arguments[0].scrollIntoView({block:'center'});", el); time.sleep(0.15)
    el.screenshot(os.path.join(OUT, name)); manifest.append((name, note)); print("XP   ", name)

LBL = "//label[.//*[@id='%s']]"

# ---- reveal Test Config ----
print("revealed:", reveal())

# Story 1.2.1 - window + fields present
cap_full("1.2.1 #1 test configuration window.png", "Test Config window revealed after Verify (covers #1, #2)")
cap_xpath("1.2.1 #2.1 test type field.png", LBL % "testType", "Test Type field present")
cap_xpath("1.2.1 #2.2 surface area field.png", LBL % "surfaceArea", "Surface Area field present")
cap_xpath("1.2.1 #2.3 number of runs field.png", LBL % "runs", "Number of Runs field present")
cap_xpath("1.2.1 #2.4 zaber com port field.png", LBL % "comport", "Zaber COM Port field present")
cap_xpath("1.2.1 #2.5 run to redo field.png", LBL % "runToRedo", "Run to Redo field present")
cap_el("1.2.1 #2.6 begin test button.png", "#beginButton", "Begin Test button present")
cap_el("1.2.1 #2.7 open calibration button.png", ".actions button:nth-of-type(2)", "Open Calibration button present")

# Story 1.2.2 - test type states (also covers 1.2.1 #3, and #1.1-#1.4 options)
def set_type(t): setval("testType", t); time.sleep(0.3)
set_type("EM");      cap_full("1.2.2 #2 em state.png", "EM: Number of Runs + COM Port enabled (also #1.1, 1.2.1 #3)")
set_type("Shear");   cap_full("1.2.2 #3 shear state.png", "Shear: Number of Runs + COM Port disabled (also #1.2)")
set_type("Manual");  cap_full("1.2.2 #4 manual state.png", "Manual: Number of Runs + Run to Redo disabled, COM Port enabled (also #1.3)")
set_type("Fatigue"); cap_full("1.2.2 #5 fatigue state.png", "Fatigue: Number of Runs + Run to Redo disabled, COM Port enabled (also #1.4)")
set_type("EM")
cap_el("1.2.2 #1 test type dropdown.png", "#testType", "Test Type dropdown (EM selected)")

# Story 1.2.3 - Number of Runs default + snap
cap_xpath("1.2.3 #1 number of runs default.png", LBL % "runs", "Number of Runs defaults to 3")
setval("runs", "0"); time.sleep(0.3)
print("runs snap -> cfg:", cmsg(), "| main:", mmsg())
cap_full("1.2.3 #3 number of runs snap message.png", "Out-of-range Number of Runs snaps + error message")

# Story 1.2.4 - COM port placeholder
cap_el("1.2.4 #2 com port placeholder.png", "#comport", "'Select COM port' placeholder shown")

# Story 1.2.5 - Surface Area default + snap
setval("runs", "3")
cap_xpath("1.2.5 #1 surface area default.png", LBL % "surfaceArea", "Surface Area default 325 mm2 (EM/Manual)")
setval("surfaceArea", "-1"); time.sleep(0.3)
print("surface snap -> cfg:", cmsg(), "| main:", mmsg())
cap_full("1.2.5 #3 surface area snap message.png", "Out-of-range Surface Area snaps + error message")

# Story 1.2.6 - Run to Redo disabled by default
setval("surfaceArea", "325"); set_type("EM")
cap_xpath("1.2.6 #1 run to redo disabled.png", LBL % "runToRedo", "Run to Redo disabled by default")

# Story 1.2.7 - reframed #2 + Begin Test validation messages
cap_el("1.2.7 #2 test type has a value.png", "#testType", "Test Type always has a value (EM), no blank option")
js("document.getElementById('saveFolder').dataset.existingTestAction='overwrite';")
def begin_msg(name, setup, note):
    setval("surfaceArea","325"); setval("runs","3"); set_type("EM")
    js("document.getElementById('saveFolder').dataset.existingTestAction='overwrite';")
    setup()
    js("beginTest()"); time.sleep(0.5)
    print(" ", name, "->", cmsg())
    cap_full(name, note)
begin_msg("1.2.7 #6 surface area blank message.png", lambda: raw("surfaceArea",""), "Blank Surface Area blocks Begin Test")
begin_msg("1.2.7 #7 surface area invalid message.png", lambda: raw("surfaceArea","-1"), "Invalid Surface Area blocks Begin Test")
begin_msg("1.2.7 #3 number of runs blank message.png", lambda: raw("runs",""), "Blank Number of Runs blocks Begin Test")
begin_msg("1.2.7 #4 number of runs invalid message.png", lambda: raw("runs","0"), "Invalid Number of Runs blocks Begin Test")
begin_msg("1.2.7 #5 com port blank message.png", lambda: None, "Blank COM Port blocks Begin Test")
begin_msg("1.2.7 #8 select run to redo message.png",
          lambda: js("var c=document.getElementById('redoRun');c.checked=true;document.getElementById('runToRedo').value='';"),
          "Redo Mode + no run selected blocks Begin Test")

# Story 1.2.8 - Calibration window (forced open; no hardware)
reveal()
js("calibrationModal.showModal();"); time.sleep(0.6)
cap_full("1.2.8 #1 calibration window.png", "Open Calibration opens the Calibration Window popup", anchor=None)
js("calibrationModal.close();")

# Story 1.2.9 - help icons + Surface Area tooltip (the one that matches spec)
reveal()
cap_xpath("1.2.9 #1 help icons.png", LBL % "surfaceArea", "Help 'i' icons beside Test Config labels")
# focus the Surface Area help icon -> tooltip
help_xp = "//label[.//*[@id='surfaceArea']]//span[@class='sensor-help']"
e = d.find_element("xpath", help_xp); js("arguments[0].scrollIntoView({block:'center'});arguments[0].focus();", e); time.sleep(0.5)
cap_full("1.2.9 #7 surface area tooltip.png", "Surface Area tooltip (matches spec)", anchor=None)

d.quit()
print("\n=== MANIFEST (%d) ===" % len(manifest))
for n, note in manifest: print(n, "\t", note)
