#!/usr/bin/env python3
"""
Headless-Selenium capture of Feature 1.10 (Manual Analysis Page) UI evidence.

SAFETY: This script never clicks any motion / START / Move / Home / Pause / Begin
button. It only opens the manual window (auto-samples force readings via
/api/read-force, NO motion) and runs data analysis (performManualAnalysis ->
/api/perform-analysis), then screenshots the resulting modal tabs.
"""

import os
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa_evidence_1_10")
os.makedirs(OUT_DIR, exist_ok=True)


def shot(driver, selector, filename):
    """Screenshot a single element by CSS selector into OUT_DIR."""
    el = driver.find_element("css selector", selector)
    path = os.path.join(OUT_DIR, filename)
    ok = el.screenshot(path)
    print(f"  saved: {filename}  ({'ok' if ok else 'FAILED'})")
    return path


def main():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=1600,1700")
    opts.add_argument("--force-device-scale-factor=2")
    opts.add_argument("--hide-scrollbars")
    driver = webdriver.Chrome(options=opts)
    try:
        driver.set_window_size(1600, 1700)
        driver.get(URL)
        time.sleep(1.0)

        # Open the manual window. Its auto-sampler collects force readings into
        # manualData via /api/read-force -- this performs NO motion.
        driver.execute_script("openManualTest()")
        time.sleep(1.0)

        # The manual window is now Start-gated: it opens idle and records nothing
        # until Start. For UI-evidence of the analysis plots we seed a simulated
        # compression curve into manualData (NO hardware, NO Start, NO motion) and
        # analyze that -- the same in-memory path a real recording feeds.
        driver.execute_script(
            "manualData.length=0;"
            "for(var i=0;i<=80;i++){var t=i*0.1;var f=Math.max(0,22*Math.sin(Math.PI*i/80));"
            "manualData.push({time:t,force:f,capacitance:null});}"
        )
        n = driver.execute_script("return manualData.length")
        print(f"seeded manualData.length: {n}")

        # Run analysis (analysis only -- no motion).
        driver.execute_script("performManualAnalysis()")

        # Poll up to 60s for the modal to open.
        opened = False
        for _ in range(60):
            try:
                opened = driver.execute_script(
                    "var m=document.getElementById('manualAnalysisModal'); return !!(m && m.open===true)"
                )
            except Exception:
                opened = False
            if opened:
                break
            time.sleep(1.0)
        print(f"manualAnalysisModal open === true : {opened}")

        if not opened:
            # Detect the "no data" dialog case for reporting.
            try:
                err = driver.execute_script(
                    "var d=document.getElementById('errorDialog'); return d? d.open : 'n/a'"
                )
            except Exception:
                err = "n/a"
            print(f"Modal did not open. errorDialog open state: {err}")
            return

        # Report the modal H2 title text.
        h2 = driver.execute_script(
            "var m=document.getElementById('manualAnalysisModal'); var h=m.querySelector('h2'); return h? h.textContent.trim() : '(no h2)'"
        )
        print(f"Modal <h2> text: {h2!r}")

        # Report the tab button labels.
        labels = driver.execute_script(
            "var m=document.getElementById('manualAnalysisModal');"
            "return Array.prototype.map.call(m.querySelectorAll('.analysis-tabs .tab-button, .tab-button'), function(b){return b.textContent.trim();});"
        )
        print(f"Tab labels (raw query): {labels}")

        tabs = [
            ("capForce",    "1.10.2 #1 capacitance vs force tab.png", 2.0),
            ("forceTime",   "1.10.2 #1.2 force vs time tab.png",      2.0),
            ("capTime",     "1.10.2 #1.3 capacitance vs time tab.png", 2.0),
            ("interactive", "1.10.3 #1 interactive tab.png",          3.0),
        ]

        for key, fname, presleep in tabs:
            driver.execute_script("showAnalysisTab('manual', arguments[0])", key)
            time.sleep(presleep)
            # Report whether the cap tabs show an empty-state message.
            if key in ("capForce", "capTime"):
                panel_id = "manual-" + key
                txt = driver.execute_script(
                    "var p=document.getElementById(arguments[0]); return p? p.textContent : '';", panel_id
                )
                has_empty = "No capacitance data" in (txt or "")
                print(f"  [{key}] empty-state 'No capacitance data' present: {has_empty}")
            shot(driver, "#manualAnalysisModal", fname)

        print("Done.")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
