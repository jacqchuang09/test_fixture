# Headless capture of Feature 1.9 (Manual Testing Window) UI evidence.
# SAFETY: this script NEVER clicks motion/run buttons. It only opens the window,
# flips the Distance/Force mode toggle (panel switch only, no motion), focuses
# info icons to reveal CSS tooltips, dispatches input/change events on fields to
# trigger snap/limit messages, and screenshots. No /api motion calls are made.
import os, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

URL = "http://127.0.0.1:8765/index.html"
OUT = os.path.join(os.path.dirname(__file__), "qa_evidence_1_9")
os.makedirs(OUT, exist_ok=True)

opts = Options()
for a in ["--headless=new", "--window-size=1500,1300", "--force-device-scale-factor=2", "--hide-scrollbars"]:
    opts.add_argument(a)
d = webdriver.Chrome(options=opts)
d.set_window_size(1500, 1300)

def js(s, *a):
    return d.execute_script(s, *a)

def shot(name):
    d.find_element("css selector", "#manualTestModal").screenshot(os.path.join(OUT, name))
    print("saved", name)

saved = []
def cap(name):
    shot(name); saved.append(name)

d.get(URL); time.sleep(1.0)

# --- Open the Manual Testing Window (no motion) ---
js("openManualTest()"); time.sleep(0.7)
modal_open = js("return document.getElementById('manualTestModal').open===true")
title = js("return document.querySelector('#manualTestModal h2').textContent.trim()")
print("manual modal open:", modal_open, "title:", title)

# === 1. Overview in DISTANCE mode (default) ===
# Covers 1.9.1 #1/#2, 1.9.2 #1, 1.9.5 #1/#2, 1.9.6 #1, 1.9.8 #1, 1.9.13 #1.
cap("1.9.1 #1 manual testing window.png")

# === 2. FORCE mode ===
js("setManualControlMode('force')"); time.sleep(0.4)
cap("1.9.2 #2 force mode.png")

# Report force-mode move-button labels + Target Force tooltip (pending confirmations).
force_btns = js("""
  return {
    release: document.getElementById('manualReleaseButton').textContent.trim(),
    compression: document.getElementById('manualCompressionButton').textContent.trim(),
    home: document.getElementById('manualHomeButton').textContent.trim()
  };
""")
target_force_tip = js("""
  var f = document.getElementById('manualPrimaryControlField');
  var s = f ? f.querySelector('.sensor-help') : null;
  return s ? s.getAttribute('data-tooltip') : null;
""")

# Back to distance mode for the distance-field snap messages.
js("setManualControlMode('distance')"); time.sleep(0.4)

# === 3. Snap / limit messages ===
def snap(field_id, value, name, force_mode=False):
    if force_mode:
        js("setManualControlMode('force')"); time.sleep(0.3)
    else:
        js("setManualControlMode('distance')"); time.sleep(0.3)
    js("""
      var el = document.getElementById(arguments[0]);
      el.focus();
      el.value = arguments[1];
      el.dispatchEvent(new Event('change', {bubbles:true}));
    """, field_id, value)
    time.sleep(0.4)
    msg = js("return document.querySelector('#manualState .state-message').textContent.trim()")
    print("snap %s=%s -> %r" % (field_id, value, msg))
    cap(name)
    return msg

m_inc = snap("manualIncrementDistance", "99", "1.9.3 #1 increment distance snap message.png")
m_spd = snap("manualActuatorSpeed", "99", "1.9.3 #2 actuator speed snap message.png")
m_tgt = snap("manualTargetForce", "99", "1.9.3 #3 target force snap message.png", force_mode=True)

# Reset distance mode before tooltip captures.
js("setManualControlMode('distance')"); time.sleep(0.3)

# === 4. Tooltips (1.9.13 #4-#8) ===
# Focus each info icon so the CSS :focus::after tooltip shows, then screenshot.
tooltips = {}
def tip(field_id, name, force_mode=False):
    if force_mode:
        js("setManualControlMode('force')"); time.sleep(0.3)
    else:
        js("setManualControlMode('distance')"); time.sleep(0.3)
    text = js("""
      var f = document.getElementById(arguments[0]);
      var s = f.querySelector('.sensor-help');
      s.scrollIntoView({block:'center'});
      s.focus();
      return s.getAttribute('data-tooltip');
    """, field_id)
    time.sleep(0.4)
    print("tooltip [%s]: %r" % (field_id, text))
    tooltips[field_id] = text
    cap(name)
    return text

tip("manualModeField", "1.9.13 #4 control by tooltip.png")
tip("manualPrimaryControlField", "1.9.13 #5 increment distance tooltip.png")  # distance mode
tip("manualSpeedField", "1.9.13 #6 actuator speed tooltip.png")
tip("manualPrimaryControlField", "1.9.13 #7 target force tooltip.png", force_mode=True)  # force mode
# Drag Position tooltip (distance mode; the drag card is disabled in force mode).
js("setManualControlMode('distance')"); time.sleep(0.3)
drag_tip = js("""
  var card = document.getElementById('manualDragCard');
  var s = card.querySelector('.sensor-help');
  s.scrollIntoView({block:'center'});
  s.focus();
  return s.getAttribute('data-tooltip');
""")
time.sleep(0.4)
tooltips["manualDragPosition"] = drag_tip
print("tooltip [manualDragPosition]: %r" % drag_tip)
cap("1.9.13 #8 drag position tooltip.png")

d.quit()

# === Report ===
print("\n=== SAVED FILES ===")
for f in saved:
    print(" ", f)

print("\n=== FORCE-MODE MOVE BUTTON LABELS ===")
print("  release/up button   (#manualReleaseButton)    :", repr(force_btns["release"]))
print("  compression/down btn(#manualCompressionButton):", repr(force_btns["compression"]))
print("  home button         (#manualHomeButton)       :", repr(force_btns["home"]))

print("\n=== TARGET FORCE INFO-ICON TOOLTIP (force mode) ===")
print(" ", repr(target_force_tip))

print("\n=== CAPTURED TOOLTIP TEXTS ===")
for k, v in tooltips.items():
    print("  [%s]: %r" % (k, v))

print("\n=== SNAP MESSAGES (actual vs expected) ===")
checks = [
    ("manualIncrementDistance", m_inc, "Increment Distance must be between 0.1 and 12 mm."),
    ("manualActuatorSpeed", m_spd, "Actuator Speed can be up to 2 mm/s."),
    ("manualTargetForce", m_tgt, "Target Force can be up to 32 N."),
]
for fid, actual, expected in checks:
    ok = (actual == expected)
    print("  %-26s %s\n      actual:   %r\n      expected: %r" % (fid, "OK" if ok else "MISMATCH", actual, expected))
print("=== done ===")
