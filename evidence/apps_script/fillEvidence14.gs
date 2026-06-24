// Feature 1.4 Evidence column. 3 screenshots cover the UI-verifiable rows; all
// hardware/behavioral rows stay blank. File IDs are hardcoded (DocumentApp only,
// no DriveApp) so it runs regardless of folder ownership.
function fillEvidence14() {
  var DOC_ID = '1CNOWSlOPN8aOv4_WNI_r1a1-LZ2uC42kWieXfywyMYU';
  var OVERVIEW = ['1.4.1 #1 calibration window.png', '1NNQ_RI-JVBiViIkiCbAF8Xcbq5-ntFe5'];
  var INCR     = ['1.4.3 #5 increment distance snap message.png', '1RWcHwUFVJBs9ocvxsU1XvMNyWFlTsO1C'];
  var EXTR     = ['1.4.5 #7 extrusion distance snap message.png', '1gE_1ViwozDKplsacerM0QGwkFWzSHa-C'];
  var MAP = {
    '1.4.1 #1': OVERVIEW, '1.4.1 #2': OVERVIEW, '1.4.1 #3': OVERVIEW,
    '1.4.1 #3.1': OVERVIEW, '1.4.1 #3.2': OVERVIEW, '1.4.1 #3.3': OVERVIEW, '1.4.1 #3.4': OVERVIEW,
    '1.4.3 #3': INCR, '1.4.3 #5': INCR,
    '1.4.5 #6': OVERVIEW, '1.4.5 #7': EXTR,
    '1.4.7 #1': OVERVIEW
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
  Logger.log('fillEvidence14 filled ' + filled + ': ' + seen.join(', '));
}
