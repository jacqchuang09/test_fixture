# Headless capture of Feature 1.6 (EM Analysis Page) evidence.
# Runs the REAL EM analysis on the bundled sample dataset (no hardware, no test
# run - pure data analysis on saved FUT/CAP files via analyzeFolderAs), then
# screenshots each of the 6 analysis tabs and the "some fields blank" popup.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
SAMPLE = "/Users/jacqueline/Downloads/ZaberTkinterGUI/web_preview/sample_data/03 09 26_325mm2_EM"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_6")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1600,2000", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1600, 2000)

def js(s, *a): return d.execute_script(s, *a)

d.get(URL); time.sleep(1.0)

# Kick off the real analysis on the saved sample folder (async); poll for the window.
js("""window.__a=null;
      analyzeFolderAs(arguments[0],'EM','325').then(()=>window.__a='ok').catch(e=>window.__a='err:'+e);""", SAMPLE)
opened = False
for i in range(90):
    st = js("return window.__a")
    if js("return document.getElementById('emAnalysisModal').open === true"):
        opened = True; print("analysis window open after", i, "s; promise:", st); break
    if st and str(st).startswith("err"):
        print("ERROR:", st); break
    time.sleep(1)
print("opened:", opened)

def cap_tab(key, name):
    js("showAnalysisTab('em', arguments[0]);", key)
    time.sleep(2.5)  # let matplotlib SVG / Plotly render
    el = d.find_element("css selector", "#emAnalysisModal")
    el.screenshot(os.path.join(OUT, name))
    print("saved", name)

if opened:
    cap_tab("rawSignals",         "1.6.2 #1 raw signals tab.png")
    cap_tab("pressureSensitivity","1.6.3 #1 pressure sensitivity tab.png")
    cap_tab("allChannelsRuns",    "1.6.4 #1 all channels runs tab.png")
    cap_tab("summary",            "1.6.5 #1 summary stats tab.png")
    cap_tab("reportOutput",       "1.6.6 #1 report output tab.png")
    cap_tab("interactive",        "1.6.7 #1 interactive tab.png")
    time.sleep(3)  # plotly needs longer
    el = d.find_element("css selector", "#emAnalysisModal")
    el.screenshot(os.path.join(OUT, "1.6.7 #1 interactive tab.png"))
    print("re-saved interactive after plotly settle")

    # 1.6.6 #7 - "some fields are blank" popup when Copy Values is clicked with blanks
    js("showAnalysisTab('em', 'reportOutput');"); time.sleep(1.5)
    clicked = js("""var b=[...document.querySelectorAll('#em-reportOutput button')]
                      .find(x=>/copy values/i.test(x.textContent)); if(b){b.click();return true;} return false;""")
    print("copy values clicked:", clicked)
    time.sleep(1.0)
    # screenshot whatever dialog/popup appeared (search open dialogs)
    pop = js("""var dlgs=[...document.querySelectorAll('dialog')].filter(x=>x.open);
                return dlgs.length? dlgs[dlgs.length-1].id || 'unnamed' : '';""")
    print("open popup:", pop)
    if pop:
        try:
            el = d.find_element("css selector", "dialog[open]:last-of-type")
            el.screenshot(os.path.join(OUT, "1.6.6 #7 some fields blank popup.png"))
            print("saved popup")
        except Exception as e:
            print("popup shot failed:", e)

d.quit()
print("=== done ===")
for f in sorted(os.listdir(OUT)): print(" ", f)
