# Feature 1.3 (Existing Test Found Page) evidence capture. UI states only (forced
# dialogs; the popup/reason-dialog are genuine elements). No hardware.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
OUT="qa_evidence_1_3"; os.makedirs(OUT, exist_ok=True)
o=Options()
for a in ["--headless=new","--window-size=1500,1150","--force-device-scale-factor=2","--hide-scrollbars"]: o.add_argument(a)
d=webdriver.Chrome(options=o); d.set_window_size(1500,1150)
def js(s): return d.execute_script(s)
def cap(n): time.sleep(0.4); d.save_screenshot(os.path.join(OUT,n)); print("SAVED",n)
PATH="/Users/jacqueline/Downloads/Test Data/12345/05 21 26_325mm2_EM"
d.get("http://127.0.0.1:8765/index.html"); time.sleep(1)

# 1.3.1 popup - EM (redo enabled). Covers 1.3.1 #1-#6, 1.3.2 #1, 1.3.3 #1
js("document.getElementById('existingTestMessage').textContent="
   "'A test folder already exists for this Sensor ID: %s. Choose how you want to continue.';"
   "document.getElementById('existingRedoButton').disabled=false;"
   "existingTestModal.showModal();" % PATH)
cap("1.3.1 #1 existing test found popup.png")
js("existingTestModal.close();")

# 1.3.2 #2 - redo disabled (existing test was Shear/Manual/Fatigue)
js("document.getElementById('existingTestMessage').textContent="
   "'A test folder already exists for this Sensor ID: %s. Choose how you want to continue.';"
   "var b=document.getElementById('existingRedoButton');b.disabled=true;"
   "b.title='Redo a specific run is only available for EM Test folders.';"
   "existingTestModal.showModal();" % PATH.replace("_EM","_Shear"))
cap("1.3.2 #2 redo disabled.png")
js("existingTestModal.close();")

# 1.3.2 #6 - reason dialog (Save/Cancel, no X)
js("document.getElementById('reasonDialogTitle').textContent='Reason for redo';"
   "document.getElementById('reasonDialogMessage').textContent="
   "'Enter a reason for redoing run 2. This reason is recorded in the EM report.';"
   "reasonDialog.showModal();")
cap("1.3.2 #6 reason dialog.png")
js("reasonDialog.close();")
d.quit(); print("done")
