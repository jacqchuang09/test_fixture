# Supplement: re-open the sample EM analysis and capture the Report Output table
# scrolled right to reveal the Runs Analyzed / Redo Reasons columns (1.6.6 #4/#5).
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
SAMPLE = "/Users/jacqueline/Downloads/ZaberTkinterGUI/web_preview/sample_data/03 09 26_325mm2_EM"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_6")

opts = Options()
for a in ["--headless=new", "--window-size=1600,1400", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1600, 1400)
def js(s, *a): return d.execute_script(s, *a)

d.get(URL); time.sleep(1.0)
js("analyzeFolderAs(arguments[0],'EM','325');", SAMPLE)
for i in range(90):
    if js("return document.getElementById('emAnalysisModal').open === true"): break
    time.sleep(1)
js("showAnalysisTab('em','reportOutput');"); time.sleep(2.0)

# scroll the report table's horizontal scroll container fully right
maxed = js("""var p=document.getElementById('em-reportOutput');
   var sc=[...p.querySelectorAll('*')].find(e=>e.scrollWidth>e.clientWidth+20);
   if(sc){sc.scrollLeft=sc.scrollWidth; return sc.scrollLeft;} return -1;""")
print("scrolled report container to", maxed)
time.sleep(1.0)
# header text to confirm the columns are present
print("headers:", js("""var p=document.getElementById('em-reportOutput');
   return [...p.querySelectorAll('th,td')].map(c=>c.textContent.trim()).filter(t=>/runs analyzed|redo reason/i.test(t));"""))
el = d.find_element("css selector", "#emAnalysisModal")
el.screenshot(os.path.join(OUT, "1.6.6 #4 runs analyzed redo reasons.png"))
print("saved 1.6.6 #4 runs analyzed redo reasons.png")
d.quit()
