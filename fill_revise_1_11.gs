// STAGE 1 - Feature 1.11 (Fatigue) doc: fill the 4 remaining tooltip Evidence
// cells (1.11.15 #5-#8) AND revise the spec text to match the live GUI.
// Runs as chuangjacq via the bound Apps Script project.
function fillRevise111() {
  var DOC = '1kGlBWCZMUqrkMB9sWKied55lngmYhdMNz42SggQMoow';
  var BASE = 'https://drive.google.com/file/d/';
  var doc = DocumentApp.openById(DOC);

  // ---- 1) Fill Evidence cells for 1.11.15 #5-#8 ----
  var MAP = {
    '1.11.15 #5': ['1.11.15 #2 tooltip lower_force_bound.png', '1iYFCRADpRywE8YhnhLUJXSVr2zdb1mlx'],
    '1.11.15 #6': ['1.11.15 #3 tooltip upper_force_bound.png', '1xLt7yKtL7CSCUyrsguPV3vOF6yo4xEFl'],
    '1.11.15 #7': ['1.11.15 #4 tooltip frequency.png',          '1iXO7auw6-miQW_m91bTt-JvzZDVQtiPy'],
    '1.11.15 #8': ['1.11.15 #5 tooltip number_of_cycles.png',   '1vhBniGglDNTSL-3BHT-GL1k9kmudN1HZ']
  };
  var tables = doc.getBody().getTables(), table = null;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.getNumRows() > 0 && t.getRow(0).getNumCells() >= 5 && t.getRow(0).getCell(0).getText().trim() === 'CoS') { table = t; break; }
  }
  var EVIDENCE = 4, filled = [];
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
    filled.push(key);
  }

  // ---- 2) Revise spec text to match the GUI (plain replaceText) ----
  var body = doc.getBody();
  var REPL = [
    // 1.11.3 #1 lower-bound field (CoS + Given/Then)
    ['accept a positive integer, strictly greater than 0; default = 1 N',
     'accept a whole number of at least 1 N (preview clamp floor is 0); default = 1 N'],
    ['accepts a positive integer strictly greater than 0 and defaults to 1 N',
     'accepts a whole number of at least 1 N and defaults to 1 N'],
    // 1.11.4 #1 upper-bound field
    ['accept a positive integer at most 32 N; default = 20 N',
     'accept a whole number from 0 to 32 N; default = 20 N'],
    ['accepts a positive integer at most 32 N and defaults to 20 N',
     'accepts a whole number from 0 to 32 N and defaults to 20 N'],
    // 1.11.5 #1 frequency field
    ['accept a positive integer (Hz) controlling cycles per second; default = 1 Hz',
     'accept a whole number from 1 to 5 Hz controlling cycles per second; default = 1 Hz'],
    ['accepts a positive integer in Hz controlling cycles per second and defaults to 1 Hz',
     'accepts a whole number from 1 to 5 Hz controlling cycles per second and defaults to 1 Hz'],
    // 1.11.15 #4 waveform tooltip - append the two GUI sentences (inside the quotes)
    ['cycle the actuator between the lower and upper force bounds.”',
     'cycle the actuator between the lower and upper force bounds. Sine is a smooth press/release. Square holds at each bound.”'],
    // 1.11.15 #5 lower tooltip
    ['Minimum force in Newtons during each cycle. Must be lower than the upper force bound.',
     'Lowest force target in each fatigue cycle. Example: cycle between 1 N and 20 N.'],
    // 1.11.15 #6 upper tooltip
    ['Maximum force in Newtons during each cycle. Cannot exceed 32 N and must be higher than the lower force bound.',
     'Highest force target in each fatigue cycle. The actuator compresses the sensor repeatedly up to this force.'],
    // 1.11.15 #7 frequency tooltip
    ['Number of cycles completed per second, measured in Hz.',
     'Number of fatigue cycles per second.'],
    // 1.11.15 #8 number-of-cycles tooltip
    ['Total number of force cycles to run. The estimated test duration is calculated from this value and the frequency.',
     'Total fatigue cycles to run. Default is 28800 cycles.']
  ];
  var replReport = [];
  for (var k = 0; k < REPL.length; k++) {
    // escape regex metacharacters in the search literal
    var lit = REPL[k][0].replace(/[.*+?^$|(){}[\]\\]/g, '\\$&');
    body.replaceText(lit, REPL[k][1]);
    replReport.push(REPL[k][0].slice(0, 40));
  }

  doc.saveAndClose();
  var out = 'FILLED: ' + filled.join(', ') + '  ||  REVISED(' + replReport.length + '): ' + replReport.join(' / ');
  Logger.log(out);
  return out;
}
