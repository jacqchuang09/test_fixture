// STAGE 2 - revise spec text to match the live GUI across the per-feature
// test-plan docs (1.4, 1.5, 1.7, 1.8, 1.9, 1.10). 1.11 already done.
// Each [from,to]; from is taken verbatim from the live docs. Reports MISS if a
// literal is not found so nothing fails silently.
function reviseAll() {
  var JOBS = [
    // ---- 1.4 Calibration: 1.4.8 #4 add "the" ----
    { doc: '1CNOWSlOPN8aOv4_WNI_r1a1-LZ2uC42kWieXfywyMYU', repl: [
      ['Could not connect to Zaber actuator on', 'Could not connect to the Zaber actuator on']
    ]},
    // ---- 1.5 EM: 1.5.5 #2 auto-pause wording ----
    { doc: '1km-tZKZMmD-R3wkLEx3DkOfAXpVg65og7aPdxt_Bww0', repl: [
      ['display “EM Testing will automatically pause between runs” and indicate which run is next (e.g., “click start to begin run 2”)',
       'display the per-run auto-pause status (e.g., “Run 1 complete and saved. Auto-paused before run 2 - press Start when ready.”)'],
      ['displays “EM Testing will automatically pause between runs” and indicates which run is next (e.g., “click start to begin run 2”)',
       'displays the per-run auto-pause status (e.g., “Run 1 complete and saved. Auto-paused before run 2 - press Start when ready.”)']
    ]},
    // ---- 1.7 Shear: 1.7.11 #4-#8 tooltips ----
    { doc: '1F6WV2q7UuCk_JuEqIeRMGSv05uXI76hLXXvjHnaKcgo', repl: [
      ['Shows only the most recent number of seconds on the live graph. If Cumulative Time is enabled, the full test timeline is shown instead.',
       'When Cumulative Time is off, the shear graph shows only the last selected number of seconds.'],
      ['Sets the lowest force value shown on the graph’s Y-axis.',
       'Lowest force value shown on the shear graph y-axis.'],
      ['Sets the highest force value shown on the graph’s Y-axis.',
       'Highest force value shown on the shear graph y-axis.'],
      ['Shows or hides real-time data point markers from the load cell on the live graph.',
       'Shows individual live force readings on top of the graph line.'],
      ['Displays the full test timeline instead of only the last selected seconds.',
       'When on, the shear graph shows the entire run from start to finish and ignores Last Seconds to Display.']
    ]},
    // ---- 1.8 Shear Analysis: tabs, detection labels, report fields ----
    { doc: '1pdF5DMnNebZ69NPbuzCrT_YmUspfg0sSrCV6rfi-Bo0', repl: [
      ['Plots, Failure Checks, Report Output, and Interactive',
       'Plot, Detection Table, Report Output, and Interactive'],
      ['one row of negative values (pF), else None',
       'a per-channel “negative CAP” row, else “none”'],
      ['one row of delta values (pF), else None',
       'a per-channel “delta_CAP_gt_10pF” row, else “none”'],
      ['Sensor ID, Test Result (Pass/Fail), Shorted Channels (Ch 1-8), Test Date (DD/MM/YEAR), Test Taker Initials, Test Version, and the Vena Vitals Wearable iOS App code (SW0004)',
       'Sensor Lot Number, Site, Test Date, Shear Fixture, Shear Test software (SW002), Vena Vitals Wearable iOS App (SW0004), Shorted CH(S) Via Shear, FPQC-S-001 Shearing Test Results, and Sign off']
    ]},
    // ---- 1.9 Manual: 1.9.13 #4/#5/#7 tooltips ----
    { doc: '1_lc1ZObPQ5EpC_aQcPz5KwJyGCByd4kICEeq_ptPN58', repl: [
      ['Choose whether manual actuator control is based on distance movement or target force.',
       'Distance mode moves the actuator by a chosen millimeter increment. Force mode simulates compression until the selected target force is reached.'],
      ['Distance in millimeters that the actuator moves for each Move Up or Move Down action.',
       'Distance used for each Move Up or Move Down click. Move Down adds distance from the actuator baseline; Move Up subtracts it.'],
      ['Speed of actuator movement in millimeters per second.',
       'Assumed actuator travel speed used to estimate elapsed time on the manual preview graphs. Default is 2.0 mm/s.']
    ]},
    // ---- 1.10 Manual Analysis: title + cap empty-state ----
    { doc: '1WEPQc12fajNlvKLRF4vVRBHkHhv_EFc_Sx1cA6qyTZI', repl: [
      ['Manual Analysis Data and Plots', 'Manual Analysis Plots'],
      ['display placeholder/defaulted data rather than measured capacitance',
       'show a “No capacitance data” empty state rather than measured capacitance'],
      ['render placeholder/defaulted data', 'show a “No capacitance data” empty state']
    ]}
  ];

  var report = [];
  for (var j = 0; j < JOBS.length; j++) {
    var doc = DocumentApp.openById(JOBS[j].doc);
    var body = doc.getBody();
    var tag = JOBS[j].doc.slice(0, 6);
    for (var k = 0; k < JOBS[j].repl.length; k++) {
      var from = JOBS[j].repl[k][0], to = JOBS[j].repl[k][1];
      var lit = from.replace(/[.*+?^$|(){}[\]\\]/g, '\\$&');
      var hit = body.findText(lit);
      if (!hit) { report.push('MISS[' + tag + ']: ' + from.slice(0, 35)); continue; }
      body.replaceText(lit, to);
      report.push('ok[' + tag + ']: ' + from.slice(0, 22));
    }
    doc.saveAndClose();
  }
  var out = report.join('  |  ');
  Logger.log(out);
  return out;
}
