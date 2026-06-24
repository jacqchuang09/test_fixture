# Headless capture of Feature 1.11 (Fatigue Test Page) UI evidence.
# HARDWARE SAFETY: this script NEVER clicks Start/Stop/Pause or any motion
# control and makes no /api motion calls. It only opens the window, sets/reads
# field values, focuses info icons, and screenshots the modal.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_11")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1300)
def js(s, *a): return d.execute_script(s, *a)
def shot(name):
    d.find_element("css selector", "#cyclicalTestModal").screenshot(os.path.join(OUT, name))
    print("saved", name)

d.get(URL); time.sleep(1.0)

# Open the Fatigue Testing Window (no hardware action involved).
js("openCyclicalTest()"); time.sleep(0.8)
print("modal open:", js("return document.getElementById('cyclicalTestModal').open===true"))
print("modal title:", js("return document.querySelector('#cyclicalTestModal h2').textContent.trim()"))

# --- Capture 2: waveform options (must be exactly ['Sine','Square']) ---
waveform_opts = js("return [...document.getElementById('waveformType').options].map(o=>o.value)")
print("WAVEFORM OPTIONS:", waveform_opts)

# --- Capture 1: overview (idle graph, defaults) ---
time.sleep(0.4)
shot("1.11.1 #1 fatigue testing window.png")

# --- Capture 3: snap / limit messages ---
def state_text():
    return js("return document.getElementById('cyclicalState').textContent.replace(/\\s+/g,' ').trim()")
def set_change(el_id, val):
    js("var e=document.getElementById(arguments[0]); e.value=arguments[1];"
       "e.dispatchEvent(new Event('change',{bubbles:true}));", el_id, val)
    time.sleep(0.4)

snap = []
def snap_case(el_id, val, fname, reset_id=None, reset_val=None):
    set_change(el_id, val)
    msg = state_text()
    shot(fname)
    snap.append((el_id, val, fname, msg))
    print("SNAP %s=%s -> %r" % (el_id, val, msg))
    if reset_id:
        set_change(reset_id, reset_val)

snap_case("cyclicalUpperForce", "99", "1.11.3 #1 upper force snap.png", "cyclicalUpperForce", "20")
snap_case("waveformFrequency",  "99", "1.11.4 #1 frequency snap.png",   "waveformFrequency", "1")
snap_case("cyclicalLowerForce", "0",  "1.11.5 #1 lower force snap.png",  "cyclicalLowerForce", "1")
snap_case("cyclicalCycleCount", "0",  "1.11.6 #1 cycle count snap.png",  "cyclicalCycleCount", "28800")
time.sleep(0.3)

# --- Capture 4: tooltips (Story 1.11.15) ---
helps = js("return [...document.querySelectorAll('#cyclicalTestModal .sensor-help')].map(h=>h.getAttribute('data-tooltip'))")
labels = js("""return [...document.querySelectorAll('#cyclicalTestModal .sensor-help')].map(h=>{
  var lbl=h.closest('label'); var t=lbl?lbl.querySelector('.label-text'):null;
  return t?t.textContent.trim():(lbl?lbl.textContent.trim():'(no label)');});""")

def slug(s):
    return "".join(c.lower() if c.isalnum() else "_" for c in s).strip("_")

tooltips = []
for i, (lbl, tip) in enumerate(zip(labels, helps)):
    js("""var h=document.querySelectorAll('#cyclicalTestModal .sensor-help')[arguments[0]];
          h.scrollIntoView({block:'center'}); h.focus();""", i)
    time.sleep(0.4)
    fname = "1.11.15 #%d tooltip %s.png" % (i+1, slug(lbl))
    shot(fname)
    tooltips.append((lbl, tip))
    # blur so the next tooltip is the only one visible
    js("document.activeElement && document.activeElement.blur();"); time.sleep(0.15)

d.quit()

print("\n=== SAVED FILES ===")
for f in sorted(os.listdir(OUT)): print(" ", f)
print("\n=== WAVEFORM OPTIONS ===")
print(waveform_opts, "  exactly ['Sine','Square'] ->", waveform_opts == ["Sine", "Square"])
print("\n=== TOOLTIP TEXTS (#cyclicalTestModal .sensor-help) ===")
for lbl, tip in tooltips:
    print(" [%s] %s" % (lbl, tip))
print("\n=== SNAP MESSAGES ===")
for el_id, val, fname, msg in snap:
    print(" %s=%s -> %r" % (el_id, val, msg))
print("\n=== done ===")
