// Feature 1.5 Evidence. One overview screenshot covers all the static-UI rows;
// the whole state-machine / motion / analysis side stays blank (behavioral).
function fillEvidence15() {
  var DOC_ID = '1km-tZKZMmD-R3wkLEx3DkOfAXpVg65og7aPdxt_Bww0';
  var OVERVIEW = ['1.5.1 #1 em testing window.png', '1HvXQ_ZYZtNvrfKrtuEMZuL9V0_G4UGmo'];
  var MAP = {
    '1.5.1 #1': OVERVIEW, '1.5.1 #2': OVERVIEW, '1.5.1 #3': OVERVIEW,
    '1.5.1 #3.1': OVERVIEW, '1.5.1 #3.2': OVERVIEW, '1.5.1 #3.3': OVERVIEW,
    '1.5.1 #4': OVERVIEW, '1.5.1 #4.1': OVERVIEW, '1.5.1 #4.2': OVERVIEW, '1.5.1 #4.3': OVERVIEW,
    '1.5.2 #1': OVERVIEW, '1.5.6 #1': OVERVIEW
  };
  var BASE = 'https://drive.google.com/file/d/';
  var doc = DocumentApp.openById(DOC_ID);
  var tables = doc.getBody().getTables(), table = null;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.getNumRows() > 0 && t.getRow(0).getNumCells() >= 5 && t.getRow(0).getCell(0).getText().trim() === 'CoS') { table = t; break; }
  }
  var EVIDENCE = 4, filled = 0, seen = [];
  for (var r = 1; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    if (row.getNumCells() <= EVIDENCE) continue;
    var m = row.getCell(0).getText().trim().match(/^(\d+\.\d+\.\d+\s*#[\d.]+)/);
    if (!m) continue;
    var key = m[1].replace(/\s+/g, ' ');
    if (!MAP[key]) continue;
    var name = MAP[key][0], url = BASE + MAP[key][1] + '/view';
    var cell = row.getCell(EVIDENCE);
    cell.clear(); cell.setText(name);
    cell.editAsText().setLinkUrl(0, name.length - 1, url);
    filled++; seen.push(key);
  }
  doc.saveAndClose();
  Logger.log('fillEvidence15 filled ' + filled + ': ' + seen.join(', '));
}
