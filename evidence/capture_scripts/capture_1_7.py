# Headless capture of Feature 1.7 (Shear Test Page) evidence.
# UI state only - opens the Shear Testing Window (no hardware, no recording).
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_7")
os.makedirs(OUT, exist_ok=True)
opts = Options()
for a in ["--headless=new", "--window-size=1500,1250", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts); d.set_window_size(1500, 1250)
def js(s, *a): return d.execute_script(s, *a)

d.get(URL); time.sleep(1.0)
js("openShearTest()"); time.sleep(0.7)

def cap(name, note=""):
    el = d.find_element("css selector", "#shearTestModal")
    el.screenshot(os.path.join(OUT, name)); print("saved", name, note)

cap("1.7.1 #1 shear testing window.png", "overview: title, graph axes, controls, buttons, info icons")

# 1.7.11 #4-#8 - focus each info icon to show its tooltip (.sensor-help:focus::after)
tips = [
    ("1.7.11 #4 last seconds tooltip.png", "last selected number of seconds"),
    ("1.7.11 #5 y-axis min tooltip.png",   "Lowest force value shown on the shear"),
    ("1.7.11 #6 y-axis limit tooltip.png", "Highest force value shown on the shear"),
    ("1.7.11 #7 show markers tooltip.png",  "individual live force readings"),
    ("1.7.11 #8 cumulative time tooltip.png", "entire run from start to finish"),
]
for name, needle in tips:
    found = js("""var n=arguments[0];
        var el=[...document.querySelectorAll('#shearTestModal .sensor-help')]
                 .find(s=>(s.getAttribute('data-tooltip')||'').indexOf(n)>=0);
        if(el){el.scrollIntoView({block:'center'}); el.focus(); return el.getAttribute('data-tooltip');}
        return null;""", needle)
    time.sleep(0.5)
    print("  tooltip:", repr(found))
    cap(name)
    js("document.activeElement && document.activeElement.blur();"); time.sleep(0.2)

d.quit()
print("=== done ===")
for f in sorted(os.listdir(OUT)): print(" ", f)
