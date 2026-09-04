// Fix the increment-range max that revise14c missed: its pattern had unescaped
// regex parens "(min)/(max)". Also correct the "limits"-tab increment phrasings
// (0.1 to 15 mm). Code caps both the calibration and manual increment at 12 mm.
function revise14d() {
  var US = '1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME';
  var EDITS = [
    ['0.1 mm \\(min\\) to 15 mm \\(max\\)', '0.1 mm (min) to 12 mm (max)'],
    ['snaps back into 0.1 to 15 mm', 'snaps back into 0.1 to 12 mm'],
    ['snaps into 0.1 to 15 mm', 'snaps into 0.1 to 12 mm'],
    ['manual increment is bounded 0.1-15 mm', 'manual increment is bounded 0.1-12 mm']
  ];
  var doc = DocumentApp.openById(US);
  var tabs = doc.getTabs();
  function walk(list) {
    for (var i = 0; i < list.length; i++) {
      var tab = list[i];
      var body = tab.asDocumentTab().getBody();
      for (var e = 0; e < EDITS.length; e++) body.replaceText(EDITS[e][0], EDITS[e][1]);
      var kids = tab.getChildTabs();
      if (kids && kids.length) walk(kids);
    }
  }
  walk(tabs);
  doc.saveAndClose();
  Logger.log('revise14d done');
}
