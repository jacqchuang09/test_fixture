// Feature 1.4 spec reconciliation - applies the same edits to BOTH the
// test-plan CoS doc and the user-stories doc. All curly quotes are written as
// “ / ” so the source stays pure ASCII. replaceText() is a no-op when
// a pattern is absent, so test-plan-only / user-stories-only edits are safe to
// run against both docs.
function revise14() {
  var EDITS = [
    // 1.4.1 #2 - drop the non-existent "Error Check Active" banner; reframe to the READY state pill
    ['a banner reading ["“”]Error Check Active: Movement will stop if a significant force increase is detected["“”]',
     'a status pill showing the current state (e.g., “READY: calibration window ready”)'],
    // 1.4.1 #3.3 - button label
    ['Start Fuji Film Test button', 'Start Fuji button'],
    // 1.4.5 #1 (and the "(Begin Calibration Test)" in 1.4.5 #6) - button label
    ['Begin Calibration Test', 'Start Fuji'],
    // 1.4.3 #4 - blank increment falls back to the 0.1 mm default (no block), CoS phrasing
    ['When the Increment Distance is blank, the move should be blocked and display ["“”]Fill in Increment Distance before continuing["“”]',
     'When the Increment Distance is left blank, the move should use the default increment of 0.1 mm'],
    // 1.4.3 #4 - Then phrasing (test-plan doc)
    ['the move is blocked and the system displays ["“”]Fill in Increment Distance before continuing["“”] and does not proceed',
     'the system uses the default increment of 0.1 mm'],
    // 1.4.3 #6 - match the GUI's lowercase log message
    ['Increment Distance must be a valid number', 'increment distance must be a valid number'],
    // 1.4.7 #1 - Exit -> "x" close
    ['an Exit button that closes only the Calibration popup',
     'an “x” close button (top-right) that closes only the Calibration popup'],
    ['When the user clicks Exit, Then the system closes only the Calibration popup',
     'When the user clicks the “x” close button, Then the system closes only the Calibration popup'],
    // 1.4.7 #2 - Exit -> "x" close
    ['Exit should be disabled while the Fuji Film Test is actively running',
     'The “x” close button should be disabled while the Fuji Film Test is actively running'],
    ['Then Exit is disabled and re-enables once the test completes or stops',
     'Then the “x” close button is disabled and re-enables once the test completes or stops'],
    // 1.4.11 #1 - Exit -> "x" close
    ['Exit should already be disabled during an active Fuji Film Test',
     'The “x” close button should already be disabled during an active Fuji Film Test'],
    ['Then Exit is already disabled', 'Then the “x” close button is already disabled'],
    // user-stories narrative + story title + dev note
    ['I want an Exit button on the Calibration popup window',
     'I want a close button on the Calibration popup window'],
    ['Story 1\\.4\\.7: Exit Button', 'Story 1\\.4\\.7: Close Button'],
    ['if we code Exit to be disabled', 'if we code the “x” close button to be disabled']
  ];
  var DOCS = [
    '1CNOWSlOPN8aOv4_WNI_r1a1-LZ2uC42kWieXfywyMYU', // Feature 1.4 test plan (CoS table)
    '1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME'  // user stories
  ];
  var report = [];
  for (var di = 0; di < DOCS.length; di++) {
    var doc = DocumentApp.openById(DOCS[di]);
    var body = doc.getBody();
    for (var i = 0; i < EDITS.length; i++) body.replaceText(EDITS[i][0], EDITS[i][1]);
    doc.saveAndClose();
    report.push(DOCS[di].slice(0, 8) + ' done');
  }
  Logger.log('revise14: ' + report.join(' | '));
}
