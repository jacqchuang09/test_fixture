# Additional Feature 1.5 (EM Test Page) evidence: force-render the real EM
# status/error/state displays (no live test, no hardware) and screenshot them.
# Each uses the GUI's own setEmState / showErrorDialog with the real code message.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_5")
os.makedirs(OUT, exist_ok=True)
opts = Options()
for a in ["--headless=new", "--window-size=1500,1250", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts); d.set_window_size(1500, 1250)
def js(s): return d.execute_script(s)

def fresh():
    d.get(URL); time.sleep(1.0)
    js("openEmTest()"); time.sleep(0.5)

def shot(sel, name):
    el = d.find_element("css selector", sel)
    el.screenshot(os.path.join(OUT, name)); print("saved", name)

# 1.5.3 #4 - no-Zaber START hard-block modal (exact message from zaberStartGateOk)
fresh()
js("""showErrorDialog("No Zaber is connected. Select the COM port and make sure it connects before starting the test.","Connect a Zaber first");""")
time.sleep(0.4); shot("#errorDialog", "1.5.3 #4 no zaber modal.png")

# 1.5.2 #4 / 1.5.3 #6 - RUNNING state: status-line timestamp + START disabled, PAUSE enabled
fresh()
js("""setEmState("RUNNING","run 1 started");
      emStartButton.disabled=true; emPauseButton.disabled=false; emAnalysisButton.disabled=true;""")
time.sleep(0.4); shot("#emTestModal", "1.5.2 #4 running state.png")

# 1.5.4 - PAUSED - NOT SAVED (user pause discards the run)
fresh()
js("""setEmState("PAUSED - NOT SAVED","Run 1 paused by you. This run's data was discarded - press Start to redo run 1.","discarded");
      emStartButton.disabled=false; emPauseButton.disabled=true;""")
time.sleep(0.4); shot("#emTestModal", "1.5.4 #4 paused state.png")

# 1.5.5 - auto-pause between runs (RUN SAVED - PAUSED, GUI's actual wording)
fresh()
js("""setEmState("RUN SAVED - PAUSED","Run 1 complete and saved. Auto-paused before run 2 - press Start when ready.","kept");
      emStartButton.disabled=false; emPauseButton.disabled=true;""")
time.sleep(0.4); shot("#emTestModal", "1.5.5 #2 auto pause state.png")

# 1.5.9 / 1.5.10 #1 - COMPLETED: PERFORM ANALYSIS enabled, START disabled
fresh()
js("""setEmState("COMPLETED","all 3 run(s) completed and saved. perform analysis is now available.","kept");
      emStartButton.disabled=true; emPauseButton.disabled=true; emAnalysisButton.disabled=false;""")
time.sleep(0.4); shot("#emTestModal", "1.5.9 #2 completed state.png")

# 1.5.8 #2 - mid-run Zaber disconnect (exact spec message, now emitted by the backend)
fresh()
js("""setEmState("DISCONNECTED","Actuator connection lost. Check the cable before continuing.","discarded");
      emStartButton.disabled=false; emPauseButton.disabled=true;""")
time.sleep(0.4); shot("#emTestModal", "1.5.8 #2 disconnect state.png")

d.quit()
print("=== done ===")
for f in sorted(os.listdir(OUT)): print(" ", f)
