// Apply the same GUI-matching revisions to the combined User Stories doc.
// Walks every tab. The Zaber-message change is scoped to Calibration only
// (Manual/Fatigue keep their own GUI wording). Reports per-pair hit counts.
function reviseUserStories() {
  var DOC = '1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME';
  var REPL = [
    // --- 1.4 Calibration Zaber message (scoped: "move" not "movement"/"test") ---
    ['move should be blocked and display "Could not connect to Zaber actuator on',
     'move should be blocked and display "Could not connect to the Zaber actuator on'],
    ['the move is blocked; display "Could not connect to Zaber actuator on',
     'the move is blocked; display "Could not connect to the Zaber actuator on'],
    // --- 1.5 EM auto-pause ---
    ['display “EM Testing will automatically pause between runs” and indicate which run is next (e.g., “click start to begin run 2”)',
     'display the per-run auto-pause status (e.g., “Run 1 complete and saved. Auto-paused before run 2 - press Start when ready.”)'],
    // --- 1.7 Shear tooltips ---
    ['Shows only the most recent number of seconds on the live graph. If Cumulative Time is enabled, the full test timeline is shown instead.',
     'When Cumulative Time is off, the shear graph shows only the last selected number of seconds.'],
    ['Sets the lowest force value shown on the graph’s Y-axis.',
     'Lowest force value shown on the shear graph y-axis.'],
    ['Sets the highest force value shown on the graph’s Y-axis.',
     'Highest force value shown on the shear graph y-axis.'],
    ['Shows or hides real-time data point markers from the load cell on the live graph.',
     'Shows individual live force readings on top of the graph line.'],
    ['Displays the full test timeline instead of only the last selected seconds.',
     'When on, the shear graph shows the entire run from start to finish and ignores Last Seconds to Display.'],
    // --- 1.8 Shear Analysis ---
    ['Plots, Failure Checks, Report Output, and Interactive',
     'Plot, Detection Table, Report Output, and Interactive'],
    ['one row of negative values (pF), else None',
     'a per-channel “negative CAP” row, else “none”'],
    ['one row of delta values (pF), else None',
     'a per-channel “delta_CAP_gt_10pF” row, else “none”'],
    ['Sensor ID, Test Result (Pass/Fail), Shorted Channels (Ch 1-8), Test Date (DD/MM/YEAR), Test Taker Initials, Test Version, and the Vena Vitals Wearable iOS App code (SW0004)',
     'Sensor Lot Number, Site, Test Date, Shear Fixture, Shear Test software (SW002), Vena Vitals Wearable iOS App (SW0004), Shorted CH(S) Via Shear, FPQC-S-001 Shearing Test Results, and Sign off'],
    // --- 1.9 Manual tooltips ---
    ['Choose whether manual actuator control is based on distance movement or target force.',
     'Distance mode moves the actuator by a chosen millimeter increment. Force mode simulates compression until the selected target force is reached.'],
    ['Distance in millimeters that the actuator moves for each Move Up or Move Down action.',
     'Distance used for each Move Up or Move Down click. Move Down adds distance from the actuator baseline; Move Up subtracts it.'],
    ['Speed of actuator movement in millimeters per second.',
     'Assumed actuator travel speed used to estimate elapsed time on the manual preview graphs. Default is 2.0 mm/s.'],
    // --- 1.10 Manual Analysis ---
    ['Manual Analysis Data and Plots', 'Manual Analysis Plots'],
    ['display placeholder/defaulted data rather than measured capacitance',
     'show a “No capacitance data” empty state rather than measured capacitance'],
    ['render placeholder/defaulted data', 'show a “No capacitance data” empty state'],
    // --- 1.11 Fatigue field bounds + tooltips ---
    ['accept a positive integer, strictly greater than 0; default = 1 N',
     'accept a whole number of at least 1 N (preview clamp floor is 0); default = 1 N'],
    ['accept a positive integer at most 32 N; default = 20 N',
     'accept a whole number from 0 to 32 N; default = 20 N'],
    ['accept a positive integer (Hz) controlling cycles per second; default = 1 Hz',
     'accept a whole number from 1 to 5 Hz controlling cycles per second; default = 1 Hz'],
    ['cycle the actuator between the lower and upper force bounds.”',
     'cycle the actuator between the lower and upper force bounds. Sine is a smooth press/release. Square holds at each bound.”'],
    ['Minimum force in Newtons during each cycle. Must be lower than the upper force bound.',
     'Lowest force target in each fatigue cycle. Example: cycle between 1 N and 20 N.'],
    ['Maximum force in Newtons during each cycle. Cannot exceed 32 N and must be higher than the lower force bound.',
     'Highest force target in each fatigue cycle. The actuator compresses the sensor repeatedly up to this force.'],
    ['Number of cycles completed per second, measured in Hz.',
     'Number of fatigue cycles per second.'],
    ['Total number of force cycles to run. The estimated test duration is calculated from this value and the frequency.',
     'Total fatigue cycles to run. Default is 28800 cycles.']
  ];

  var doc = DocumentApp.openById(DOC);
  var bodies = [];
  var tabs = doc.getTabs ? doc.getTabs() : null;
  if (tabs && tabs.length) {
    var stack = tabs.slice();
    while (stack.length) {
      var tab = stack.shift();
      bodies.push(tab.asDocumentTab().getBody());
      var ch = tab.getChildTabs();
      for (var i = 0; i < ch.length; i++) stack.push(ch[i]);
    }
  } else {
    bodies.push(doc.getBody());
  }

  var report = [];
  for (var k = 0; k < REPL.length; k++) {
    var from = REPL[k][0], to = REPL[k][1];
    var lit = from.replace(/[.*+?^$|(){}[\]\\]/g, '\\$&');
    var n = 0;
    for (var b = 0; b < bodies.length; b++) {
      if (bodies[b].findText(lit)) { bodies[b].replaceText(lit, to); n++; }
    }
    report.push((n ? n + 'x' : 'MISS') + ':' + from.slice(0, 20));
  }
  doc.saveAndClose();
  var out = 'tabs/bodies=' + bodies.length + ' || ' + report.join('  |  ');
  Logger.log(out);
  return out;
}
