# Recapture the four Verify/reverify message screenshots after the GUI message
# strings were updated to match the spec. UI states only; no hardware.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence")

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--window-size=1500,1150")
opts.add_argument("--force-device-scale-factor=2")
opts.add_argument("--hide-scrollbars")
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1150)

def load():
    d.get(URL); time.sleep(1.0)
def js(s, *a): return d.execute_script(s, *a)
def setval(i, v):
    js("""const el=document.getElementById(arguments[0]);el.value=arguments[1];
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));""", i, v)
def fill_valid():
    for i, v in [("sensorYear","26"),("sensorMonth","06"),("sensorDay","23"),
                 ("sensorBatch","01"),("sensorNumber","01"),("sensorLocation","B")]:
        setval(i, v)
    time.sleep(0.2)
def verify(): js("verifySettings()"); time.sleep(0.6)
def msg(): return js("const m=document.getElementById('mainMessage');return m?m.textContent.trim():''")
def cap(name): time.sleep(0.35); d.save_screenshot(os.path.join(OUT, name)); print("SAVED", name)

# 1.1.7 #2 - blank Save Folder
load()
js("const e=document.getElementById('saveFolder');e.value='';e.dataset.baseSaveFolder='';")
verify(); print("  #2:", msg())
cap("1.1.7 #2 save folder blank message.png")

# 1.1.7 #4 - blank Sensor Type (forced; dropdown has no blank option in normal use)
load()
js("const e=document.getElementById('sensorType');e.value='';e.dispatchEvent(new Event('change',{bubbles:true}));")
verify(); print("  #4:", msg())
cap("1.1.7 #4 sensor type blank message.png")

# 1.1.7 #5 - incomplete Sensor ID (segments left blank)
load()
verify(); print("  #5:", msg())
cap("1.1.7 #5 incomplete sensor id message.png")

# 1.1.8 #2 - edited after verify
load()
fill_valid(); verify()
if js("return !document.getElementById('testConfig').classList.contains('hidden')"):
    setval("saveFolder", js("return document.getElementById('saveFolder').value")+"/x")
    time.sleep(0.4)
    print("  1.1.8 #2:", msg(), "| hidden:", js("return document.getElementById('testConfig').classList.contains('hidden')"))
    cap("1.1.8 #2 reverify message.png")
else:
    print("  WARN: testConfig did not reveal; 1.1.8 not captured")

d.quit()
print("done")
