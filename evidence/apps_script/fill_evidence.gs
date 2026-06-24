/**
 * Fills the Evidence column of the Feature 1.1 verification table with links to
 * the screenshot files in Drive. Idempotent: re-running re-sets the same cells.
 * Matches each row by the CoS code at the start of its first cell (e.g. "1.1.3 #2").
 * Only rows present in MAP are touched; everything else is left untouched.
 */
function fillEvidence() {
  var DOC_ID = '12zNNhUWGXDKq3lS0YQPdMMfPg5xdm14VHMDjFWhvo5Y';
  var BASE = 'https://drive.google.com/file/d/';

  // CoS code -> [display filename, Drive file id]
  var MAP = {
    '1.1.1 #1':   ['1.1.1 main window.png', '1dpf4YiZOyq26jO0RXT6kyv2DpdSAMmNM'],
    '1.1.1 #2':   ['1.1.1 main window.png', '1dpf4YiZOyq26jO0RXT6kyv2DpdSAMmNM'],
    '1.1.1 #2.1': ['1.1.1 #2.1 save folder field.png', '1eQ0tCuYKexb9Co3Hwym_Nb9MbT1EzNbk'],
    '1.1.1 #2.2': ['1.1.1 #2.2 sensor id field.png', '1TZohhUIg6qiLgDdyR_T3SC1o1rae1V_e'],
    '1.1.1 #2.3': ['1.1.1 #2.3 sensor type field.png', '1C97Ox3QxZdXNaPF14iqiPAo9hyNIV3Nf'],
    '1.1.1 #2.4': ['1.1.1 #2.4 use custom sensor id checkbox.png', '1vMdB0C37y4XoPf32t-5do90AQqslQkNk'],
    '1.1.1 #2.5': ['1.1.1 #2.5 verify button.png', '1XVrQ_ZlZszzwbhCITlo6qqtqcTfSKNTA'],
    '1.1.2 #1':   ['1.1.2 #1 save folder accepts path.png', '1G7x5hnFLJjnxRaguvk-wkWpcO-HBw4hn'],
    '1.1.2 #2':   ['1.1.2 #2 browse control.png', '1mdqMrKBOcAYLHIFa-rG9sp-_zboDAG0m'],
    '1.1.2 #6':   ['1.1.2 #6 info note.png', '156Sxo7n9rXaLq0RVi_yp-vVJaavu_zL7'],
    '1.1.3 #1':   ['1.1.3 #1 sensor id segments.png', '17v3UIQybEmA5Iu_zUv0fiMYn6ZFLltyk'],
    '1.1.3 #2':   ['1.1.3 #2 batch prefix B.png', '1HORnK5cPHLwQJxwecz7R9D7ysHJQAPuw'],
    '1.1.3 #3':   ['1.1.3 #3 sensor prefix S.png', '1jyx-IYOReJVC9MnC0TQg8uQ9Cg8P2YuI'],
    '1.1.3 #4':   ['1.1.3 #4 generated sensor id.png', '1m2F9N4PyPJY8_UXGyB0OZVWSP3sVAVi5'],
    '1.1.4 #1':   ['1.1.4 #1 use custom sensor id checkbox.png', '1DGzmZFRX3T4ClyD0rbLYzfK_uCRFhEh9'],
    '1.1.4 #2':   ['1.1.4 #2 custom unchecked.png', '1nLNXqVMjsN0pbcUDbztr2DqTeWV3o7fD'],
    '1.1.4 #3':   ['1.1.4 #3 custom checked.png', '1qhBcinw2qeM67AscVvDfN8Cr_igQYTo3'],
    '1.1.5 #1':   ['1.1.5 #1 full sensor id shown.png', '1reaFd3wfiz9-WESg7OYTL0EA7ij7FSpO'],
    '1.1.5 #2':   ['1.1.5 #2 complete all segments.png', '1NOQ-HRPXxcgM-wkvsNJUsJpN0pkXmyBR'],
    '1.1.6 #2':   ['1.1.6 #2 inverted option.png', '1ILl72fYEIOL3IMc2CUdX5zK9GA64gaNE'],
    '1.1.6 #3':   ['1.1.6 #3 standard default.png', '17pepaXBffMWC9TQ7hBAu-FSdDJHZ14sl'],
    '1.1.7 #1':   ['1.1.7 #1 test configuration revealed.png', '1lm7dqUnmDgPbddEOs9rAmCTX_FwrajHA'],
    '1.1.7 #3':   ['1.1.7 #3 custom id blank message.png', '1Wbew3KV5WB4z2qXqPQE3au72bmbG7bFj'],
    '1.1.7 #6':   ['1.1.7 #6 invalid sensor id message.png', '16UmHX77QVAXusHpac13ONfaXgl3l-0kg'],
    '1.1.7 #2':   ['1.1.7 #2 save folder blank message.png', '1yqpFfc6Su5sT8wVv9pz3hu4lRmXblWVC'],
    '1.1.7 #4':   ['1.1.7 #4 sensor type blank message.png', '1pqlwTCeicUXvTK1yxdymjxlXXwUVF2uW'],
    '1.1.7 #5':   ['1.1.7 #5 incomplete sensor id message.png', '1ZCV62DhlQYRuUBv5Rd7SulODGP8BgLKp'],
    '1.1.8 #2':   ['1.1.8 #2 reverify message.png', '1PRkftT62bBlrEDxHPoyt85SIQ0s8ADG5'],
    '1.1.9 #1':   ['1.1.9 #1 analyze saved data button.png', '1Vdw-7i2m1nc4ObpsFIGMEnQsj8jD6SmZ'],
    '1.1.9 #3':   ['1.1.9 #3 invalid folder error popup.png', '12u7K64ul-TFm5Ihki_768IZDWV93_dcT'],
    '1.1.10 #1':  ['1.1.10 #1 help icons.png', '1w8cy_JXlfrR4iOduI327u1vkMrwLIFcg'],
    '1.1.10 #4':  ['1.1.10 #4 save folder tooltip.png', '1kZb41JaYJaajg4MqtYNp5ZWTNrLMXoSL'],
    '1.1.10 #5':  ['1.1.10 #5 sensor id tooltip.png', '1k32kkR6ghs7oG9PTB6Yvp3auqsUhVuTL'],
    '1.1.10 #6':  ['1.1.10 #6 sensor type tooltip.png', '1JJ2i47FVdSmtIl0OdIGxQmH-0zBbOoy7'],
    '1.1.10 #7':  ['1.1.10 #7 custom id tooltip.png', '1k5VaoGm80PSbDDhdm9UgKGVZ_ZVw6gOM']
  };

  var doc = DocumentApp.openById(DOC_ID);
  var tables = doc.getBody().getTables();
  var table = null;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.getNumRows() > 0 && t.getRow(0).getNumCells() >= 5 &&
        t.getRow(0).getCell(0).getText().trim() === 'CoS') { table = t; break; }
  }
  if (!table) throw new Error('Feature 1.1 table (header "CoS") not found.');

  var EVIDENCE = 4; // CoS | Test | Pass | Deviation | Evidence | Acceptable
  var filled = 0, keysUsed = {};
  for (var r = 1; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    if (row.getNumCells() <= EVIDENCE) continue;
    var m = row.getCell(0).getText().trim().match(/^(\d+\.\d+\.\d+\s*#[\d.]+)/);
    if (!m) continue;
    var key = m[1].replace(/\s+/g, ' ');
    if (!MAP[key]) continue;
    var name = MAP[key][0];
    var url = BASE + MAP[key][1] + '/view';
    var cell = row.getCell(EVIDENCE);
    cell.clear();
    cell.setText(name);
    cell.editAsText().setLinkUrl(0, name.length - 1, url);
    filled++; keysUsed[key] = true;
  }
  doc.saveAndClose();

  var missing = [];
  for (var k in MAP) { if (!keysUsed[k]) missing.push(k); }
  Logger.log('Filled ' + filled + ' Evidence cell(s).');
  if (missing.length) Logger.log('MAP keys not matched to a row: ' + missing.join(', '));
}

/** Feature 1.2 fill. Hardcoded file ids + DocumentApp only (no DriveApp), so it
 *  needs no access to the Drive folder - writing a link is just text. */
function fillEvidence12() {
  var DOC_ID = '13BZhDWKT7RPe__xT0e2RQ8RqyvHlSZRWQLN1rU4gHJ8';
  var BASE = 'https://drive.google.com/file/d/';
  var MAP = {
    '1.2.1 #1':['1.2.1 #1 test configuration window.png','1BSRh9lDU6Fm891_kH8ZsdlxEi71S9GKT'],
    '1.2.1 #2':['1.2.1 #1 test configuration window.png','1BSRh9lDU6Fm891_kH8ZsdlxEi71S9GKT'],
    '1.2.1 #2.1':['1.2.1 #2.1 test type field.png','1cirCM85CZdMdaFoR6dyISOvCq7VeJcim'],
    '1.2.1 #2.2':['1.2.1 #2.2 surface area field.png','1oA_O7FQwtcCbzGfSl5AoCzqxG71rC6-V'],
    '1.2.1 #2.3':['1.2.1 #2.3 number of runs field.png','1WXo5nMPFXaSYPrOn6ustyZ9HF0_zjMGd'],
    '1.2.1 #2.4':['1.2.1 #2.4 zaber com port field.png','1JkxmuC3zF3K7yrgfv64cB0Y9ZFC4p5V2'],
    '1.2.1 #2.5':['1.2.1 #2.5 run to redo field.png','1cq6ACxs1QSqK0FMnwm0NSHfBylS9UYdJ'],
    '1.2.1 #2.6':['1.2.1 #2.6 begin test button.png','13dAD4mw_Acz8ODgZean1DZyhGp0qMliI'],
    '1.2.1 #2.7':['1.2.1 #2.7 open calibration button.png','1ANpcJfVhU6nakIk1LTjYk7oLt_57-Cd5'],
    '1.2.1 #3':['1.2.2 #2 em state.png','14ORZFkGLYggfg3FH2QoJBcEm4A0ekkb1'],
    '1.2.2 #1':['1.2.2 #1 test type dropdown.png','1gJ4MR8XXfXokWL4GT3VqE4F-8QS23dCL'],
    '1.2.2 #1.1':['1.2.2 #2 em state.png','14ORZFkGLYggfg3FH2QoJBcEm4A0ekkb1'],
    '1.2.2 #1.2':['1.2.2 #3 shear state.png','1tN2y7iqtx-LD5gTJlzbFvHwPG5o-8Zc3'],
    '1.2.2 #1.3':['1.2.2 #4 manual state.png','1AcUYtH27ySq8n8_TkKF5FYKK-8LEoqfw'],
    '1.2.2 #1.4':['1.2.2 #5 fatigue state.png','13mhbAIUmBnp2bQInKSkzmsQDptSArKp_'],
    '1.2.2 #2':['1.2.2 #2 em state.png','14ORZFkGLYggfg3FH2QoJBcEm4A0ekkb1'],
    '1.2.2 #3':['1.2.2 #3 shear state.png','1tN2y7iqtx-LD5gTJlzbFvHwPG5o-8Zc3'],
    '1.2.2 #4':['1.2.2 #4 manual state.png','1AcUYtH27ySq8n8_TkKF5FYKK-8LEoqfw'],
    '1.2.2 #5':['1.2.2 #5 fatigue state.png','13mhbAIUmBnp2bQInKSkzmsQDptSArKp_'],
    '1.2.3 #1':['1.2.3 #1 number of runs default.png','1aBMYNbhHKalX5HUJAg6B1ukI8NNvm4UW'],
    '1.2.3 #3':['1.2.3 #3 number of runs snap message.png','1utb_R-CMSNQldsh90QhuZjLk_TBc0o5h'],
    '1.2.4 #2':['1.2.4 #2 com port placeholder.png','1omXUmQyrZWeOqwEpSV7i3owGQSB9NyuP'],
    '1.2.5 #1':['1.2.5 #1 surface area default.png','11zQJaCBU9z58abZVyrGqgrp3dvN_AMaJ'],
    '1.2.5 #3':['1.2.5 #3 surface area snap message.png','1D1ikGmCdOm0pzZiePyLhT4JjwGCN-rO2'],
    '1.2.6 #1':['1.2.6 #1 run to redo disabled.png','1bJTeZOUl4RT7vr2mjvKzqtVRFPL4LQV7'],
    '1.2.7 #2':['1.2.7 #2 test type has a value.png','1tytR0ywr7Sy2VMH4gop34x0dSYBtex6c'],
    '1.2.7 #3':['1.2.7 #3 number of runs blank message.png','1FPFGG82qQ1u4ZlM2amNuTErbmz-ePggy'],
    '1.2.7 #4':['1.2.7 #4 number of runs invalid message.png','13JLOjnRSfexdSVeDak7AzMCP5eHkYjVU'],
    '1.2.7 #5':['1.2.7 #5 com port blank message.png','1eDhKsGYu5HaUdDeOlRB_qQdICKn9o_MR'],
    '1.2.7 #6':['1.2.7 #6 surface area blank message.png','12tvqsNv5V8skESTPDvAjvvk5i2kl-p08'],
    '1.2.7 #7':['1.2.7 #7 surface area invalid message.png','1fyeVuEOGhUiPH_yFAJfRpJ_AlUlmXp4T'],
    '1.2.7 #8':['1.2.7 #8 select run to redo message.png','125W85ssKiAqwijbGhCVi-KePOBTziKO0'],
    '1.2.8 #1':['1.2.8 #1 calibration window.png','1sSMocUR-53ZR5vZ6B4Bv2YoEIZAgl7bI'],
    '1.2.9 #1':['1.2.9 #1 help icons.png','1hrx1ePI54bvSmpPhDE3mivD1MIqkWCiG'],
    '1.2.9 #2':['1.2.9 #7 surface area tooltip.png','1Fdi3ROogScldbIftDrYx_j9tfOLJToU0'],
    '1.2.9 #4':['1.2.9 #4 test type tooltip.png','1M_OijZTyzN_6LDH7ig2IG1mXqzPU3krg'],
    '1.2.9 #5':['1.2.9 #5 number of runs tooltip.png','1k5B06ep33YEZH6zJBwOV3usC9ovm7sSK'],
    '1.2.9 #6':['1.2.9 #6 run to redo tooltip.png','1kRmrAbQpjHscMdx7s9Gcw4skavDD6E8e'],
    '1.2.9 #7':['1.2.9 #7 surface area tooltip.png','1Fdi3ROogScldbIftDrYx_j9tfOLJToU0'],
    '1.2.9 #8':['1.2.9 #8 zaber com port tooltip.png','1fHN9ETj7I9fsdep5yZ2DctVp68zy_DdW']
  };
  var doc = DocumentApp.openById(DOC_ID);
  var tables = doc.getBody().getTables(), table = null;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    if (t.getNumRows() > 0 && t.getRow(0).getNumCells() >= 5 &&
        t.getRow(0).getCell(0).getText().trim() === 'CoS') { table = t; break; }
  }
  if (!table) throw new Error('Feature 1.2 table (header "CoS") not found.');
  var EVIDENCE = 4, filled = 0;
  for (var r = 1; r < table.getNumRows(); r++) {
    var row = table.getRow(r);
    if (row.getNumCells() <= EVIDENCE) continue;
    var mm = row.getCell(0).getText().trim().match(/^(\d+\.\d+\.\d+\s*#[\d.]+)/);
    if (!mm) continue;
    var key = mm[1].replace(/\s+/g, ' ');
    if (!MAP[key]) continue;
    var name = MAP[key][0], url = BASE + MAP[key][1] + '/view';
    var cell = row.getCell(EVIDENCE);
    cell.clear(); cell.setText(name);
    cell.editAsText().setLinkUrl(0, name.length - 1, url);
    filled++;
  }
  doc.saveAndClose();
  Logger.log('Filled ' + filled + ' Evidence cell(s).');
}
