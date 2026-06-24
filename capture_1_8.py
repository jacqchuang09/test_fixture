# Headless capture of Feature 1.8 (Shear Analysis Page). Runs the REAL shear
# analysis on the bundled sample (no hardware), screenshots each tab + the popup.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
SAMPLE = "/Users/jacqueline/Downloads/ZaberTkinterGUI/web_preview/sample_data/260310B01S02BA/04 17 26_50.27_Shear"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_8")
os.makedirs(OUT, exist_ok=True)
opts = Options()
for a in ["--headless=new", "--window-size=1600,2000", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts); d.set_window_size(1600, 2000)
def js(s, *a): return d.execute_script(s, *a)

d.get(URL); time.sleep(1.0)
js("window.__a=null; analyzeFolderAs(arguments[0],'Shear','50.27').then(()=>window.__a='ok').catch(e=>window.__a='err:'+e);", SAMPLE)
opened = False
for i in range(90):
    if js("return document.getElementById('shearAnalysisModal').open===true"): opened = True; break
    st = js("return window.__a")
    if st and str(st).startswith('err'): print("ERR:", st); break
    time.sleep(1)
print("shear analysis opened:", opened, "after ~%ds"%i)

def cap_tab(key, name):
    js("showAnalysisTab('shear', arguments[0]);", key); time.sleep(2.5)
    d.find_element("css selector", "#shearAnalysisModal").screenshot(os.path.join(OUT, name)); print("saved", name)

if opened:
    print("tabs:", js("return [...document.querySelectorAll('#shearAnalysisModal .tab-button')].map(b=>b.textContent.trim())"))
    cap_tab("plot",         "1.8.2 #1 plot tab.png")
    cap_tab("detection",    "1.8.3 #1 detection table tab.png")
    cap_tab("reportOutput", "1.8.4 #1 report output tab.png")
    cap_tab("interactive",  "1.8.5 #1 interactive tab.png")
    time.sleep(2)
    d.find_element("css selector", "#shearAnalysisModal").screenshot(os.path.join(OUT, "1.8.5 #1 interactive tab.png"))
    # 1.8.4 #3 - some-fields-blank popup on Copy Values
    js("showAnalysisTab('shear','reportOutput');"); time.sleep(1.2)
    clicked = js("""var b=document.getElementById('copyShearReportButton')
                    || [...document.querySelectorAll('#shear-reportOutput button')].find(x=>/copy values/i.test(x.textContent));
                    if(b){b.click(); return true;} return false;""")
    print("copy values clicked:", clicked); time.sleep(1.0)
    pop = js("""var dl=[...document.querySelectorAll('dialog')].filter(x=>x.open && x.id!=='shearAnalysisModal'); return dl.length?(dl[dl.length-1].id||'unnamed'):'';""")
    print("popup:", pop)
    if pop:
        try:
            d.find_element("css selector", "dialog[open]:last-of-type").screenshot(os.path.join(OUT, "1.8.4 #3 some fields blank popup.png"))
            print("saved popup")
        except Exception as e: print("popup shot failed:", e)

d.quit()
print("=== done ===")
for f in sorted(os.listdir(OUT)): print(" ", f)
