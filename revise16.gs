// Feature 1.6 spec reconciliation: Summary Stats metric list (1.6.5 #2) and
// Report Output columns (1.6.6 #1/#4/#5) revised to match the GUI. Both docs,
// all tabs. Uses "." wildcards (not backslashes) to match literal parens.
function revise16() {
  var SUMMARY = 'PS at Inflection, Max kPa, and Max CAP, each reported per channel (CH1-CH8) as Mean, Std, CoV, Min, and Max';
  var EDITS = [
    ['PS at Inflection and Pressure at Inflection, each with its COV column; the Max CAP section and the Center-4-channels avg-mean / avg-COV pressure columns should be removed', SUMMARY],
    ['PS at Inflection and Pressure at Inflection, each with its COV column, and the Max CAP section and the Center-4-channels avg-mean / avg-COV pressure columns are removed', SUMMARY],
    ['PS at Inflection and Pressure at Inflection, each with its COV column. The Max CAP section and the Center-4-channels avg-mean / avg-COV pressure columns were removed', SUMMARY],
    ['shown .trimmed to match the real tracker sheet. should be', 'shown should be'],
    ['shown .trimmed to match the real tracker sheet.:', 'shown:'],
    ['Fabrication Type, Eco Block ID, Run Number Tested, Run Number Counted,', 'Eco Block ID, Run # Tested, Run # Counted,'],
    ['Shorted Channel status .auto-checked by the pipeline., Runs Analyzed, and Redo Reasons', 'Shorted Channel status (auto-checked by the pipeline), and Notes'],
    ['Shorted Channel status, Runs Analyzed, and Redo Reasons', 'Shorted Channel status, and Notes'],
    ['The Runs Analyzed column should list the exact run numbers included in the analysis .e.g., 1, 3, 4.', 'The Run # Counted column should report the number of runs included in the analysis'],
    ['Runs Analyzed column lists the exact run numbers included in the analysis .e.g., 1, 3, 4.', 'Run # Counted column reports the number of runs included in the analysis'],
    ['Runs Analyzed column: Lists the exact run numbers included in the analysis .e.g., 1, 3, 4.', 'Run # Counted column: Reports the number of runs included in the analysis'],
    ['The Redo Reasons column should record the reason captured for each redo, so the report documents why a run was repeated', 'The Notes column should be available for recording notes about the analysis, such as redo reasons'],
    ['Redo Reasons column records the reason captured for each redo so the report documents why a run was repeated', 'Notes column is available for recording notes about the analysis, such as redo reasons'],
    ['Redo Reasons column: Records the reason captured for each redo .from Story 1.3.2., so the report documents why a run was repeated', 'Notes column: Available for recording notes about the analysis, such as redo reasons'],
    ['that Runs Analyzed lists the active set, and that Redo Reasons shows the captured reason', 'that the analysis uses only the active run set and the captured redo reason is recorded in Notes']
  ];
  var DOCS = ['1U_pLoYeX_Zhwk97c4QsgJG3sXOSn5izHMvokrPs2UpQ', '1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME'];
  var report = [];
  for (var di = 0; di < DOCS.length; di++) {
    var doc = DocumentApp.openById(DOCS[di]);
    var tabs = doc.getTabs();
    var n = 0;
    function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var body = list[i].asDocumentTab().getBody();
        for (var e = 0; e < EDITS.length; e++) body.replaceText(EDITS[e][0], EDITS[e][1]);
        var kids = list[i].getChildTabs();
        if (kids && kids.length) walk(kids);
        n++;
      }
    }
    walk(tabs);
    doc.saveAndClose();
    report.push(DOCS[di].slice(0, 8) + ' (' + n + ' tabs)');
  }
  Logger.log('revise16: ' + report.join(' | '));
}
