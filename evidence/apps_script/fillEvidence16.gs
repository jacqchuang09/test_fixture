// Feature 1.6 Evidence. 8 screenshots cover the analysis-window tabs/popup;
// behavioral rows (run-log styling, redo logic, Plotly interactions, missing-
// data handling) stay blank. Char-class regex (no backslashes) so the raw
// source injects cleanly.
function fillEvidence16() {
  var DOC_ID = '1U_pLoYeX_Zhwk97c4QsgJG3sXOSn5izHMvokrPs2UpQ';
  var RAW         = ['1.6.2 #1 raw signals tab.png', '1iiECfTHD8MEyJhRqjWfL6Gk6SqHgPEUz'];
  var PRESSURE    = ['1.6.3 #1 pressure sensitivity tab.png', '1ogocSGz_vn5HAYxsF6S_Xst3d2iPrsc9'];
  var ALLCH       = ['1.6.4 #1 all channels runs tab.png', '1-59H3u80hGTjYpnNW1vuROOFS1FvJslD'];
  var SUMMARY     = ['1.6.5 #1 summary stats tab.png', '1x1uTmWH1-h5uEeWmSthngD7oa2RexbWm'];
  var REPORT      = ['1.6.6 #1 report output tab.png', '1l3pY4mocd96jG-fKKmczll9_0Fq-TUWx'];
  var REPORTRIGHT = ['1.6.6 #1 report output (right columns).png', '1VPYmd9w5h_4NQ8KWrOG3U3L1UUZQCE1k'];
  var POPUP       = ['1.6.6 #7 some fields blank popup.png', '1eGS0_98qS5lpH4xqyemnN3nmBjDnrnhh'];
  var INTER       = ['1.6.7 #1 interactive tab.png', '1Gqks22nlBUzQ3VlEDwffEkJ_5yx_t49Q'];
  var MAP = {
    '1.6.1 #1': RAW, '1.6.1 #2': RAW,
    '1.6.2 #1': RAW, '1.6.2 #2': RAW,
    '1.6.3 #1': PRESSURE, '1.6.3 #2': PRESSURE,
    '1.6.4 #1': ALLCH, '1.6.4 #1.1': ALLCH, '1.6.4 #1.2': ALLCH, '1.6.4 #2': ALLCH,
    '1.6.5 #1': SUMMARY, '1.6.5 #2': SUMMARY, '1.6.5 #3': SUMMARY,
    '1.6.6 #1': REPORT, '1.6.6 #4': REPORTRIGHT, '1.6.6 #5': REPORTRIGHT, '1.6.6 #6': REPORT, '1.6.6 #7': POPUP,
    '1.6.7 #1': INTER, '1.6.7 #5': INTER,
    '1.6.8 #1': INTER, '1.6.8 #2': INTER
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
    var m = row.getCell(0).getText().trim().match(/^([0-9]+[.][0-9]+[.][0-9]+[ ]*#[0-9.]+)/);
    if (!m) continue;
    var key = m[1].replace(/[ ]+/g, ' ');
    if (!MAP[key]) continue;
    var name = MAP[key][0], url = BASE + MAP[key][1] + '/view';
    var cell = row.getCell(EVIDENCE);
    cell.clear(); cell.setText(name);
    cell.editAsText().setLinkUrl(0, name.length - 1, url);
    filled++; seen.push(key);
  }
  doc.saveAndClose();
  Logger.log('fillEvidence16 filled ' + filled + ': ' + seen.join(', '));
}
