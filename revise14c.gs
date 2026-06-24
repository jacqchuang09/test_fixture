// Feature 1.4: the user-stories doc is multi-tab; getBody() only reached the
// detailed-criteria tab. This walks ALL tabs and applies the summary-section
// phrasings (compact wording differs from the detailed section). Shared
// patterns (button labels, etc.) re-run harmlessly on already-edited tabs.
function revise14c() {
  var US = '1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME';
  var EDITS = [
    // 1.4.1 #2 banner -> status pill (summary wording: "A banner reads")
    ['A banner reads ["“”]Error Check Active: Movement will stop if a significant force increase is detected["“”]',
     'A status pill shows the current state (e.g., “READY: calibration window ready”)'],
    ['Confirm popup title, error-check banner, and all controls are present',
     'Confirm popup title, status pill, and all controls are present'],
    // button labels
    ['Start Fuji Film Test button', 'Start Fuji button'],
    ['Begin Calibration Test', 'Start Fuji'],
    // 1.4.3 #3 - summary max was wrong (15 -> 12 mm, matches code + detailed section)
    ['0.1 mm (min) to 15 mm (max)', '0.1 mm (min) to 12 mm (max)'],
    // 1.4.3 #4 blank -> default (summary note)
    ['Blocked - blank: ["“”]Fill in Increment Distance before continuing["“”]',
     'Blank: uses the default increment of 0.1 mm'],
    // 1.4.3 #5 - summary said "blocked/exceeds range"; code snaps to the limit
    ['Blocked - exceeds range: ["“”]Increment Distance exceeds the maximum allowed range["“”]',
     'Out of range: snaps to the nearest limit and shows “Increment Distance must be between 0.1 and 12 mm”'],
    // 1.4.3 #6 message case
    ['Increment Distance must be a valid number', 'increment distance must be a valid number'],
    // 1.4.7 Exit -> "x" close (summary criterion, narrative, story title)
    ['an Exit button that closes only the Calibration popup',
     'an “x” close button (top-right) that closes only the Calibration popup'],
    ['I want an Exit button on the Calibration popup window',
     'I want a close button on the Calibration popup window'],
    ['Story 1.4.7: Exit Button', 'Story 1.4.7: Close Button']
  ];
  var doc = DocumentApp.openById(US);
  var tabs = doc.getTabs();
  var names = [];
  function walk(list) {
    for (var i = 0; i < list.length; i++) {
      var tab = list[i];
      names.push(tab.getTitle());
      var body = tab.asDocumentTab().getBody();
      for (var e = 0; e < EDITS.length; e++) body.replaceText(EDITS[e][0], EDITS[e][1]);
      var kids = tab.getChildTabs();
      if (kids && kids.length) walk(kids);
    }
  }
  walk(tabs);
  doc.saveAndClose();
  Logger.log('revise14c tabs(' + tabs.length + '): ' + names.join(', '));
}
