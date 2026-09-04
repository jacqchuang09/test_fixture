// Applied 2026-07-14: reconcile the Manual-analysis spec to the new behavior
// where Manual analysis requires a real dropped CAP file (same 8-channel layout
// as EM/Shear) and shows a "Capacitance data needed" prompt when it is missing,
// instead of the old force-only "No capacitance data" empty state.
//
// Ran against:
//   Feature 1.10 (Manual Analysis) test-plan doc  -> reviseManualCap()
//   Combined v2 User Stories doc                  -> reviseStories3() + fixStoryPlacement()
//
// Net doc changes:
//   1.10 doc: revised 1.10.2 #3, revised 1.10.3 #2, inserted new 1.10.1 #3.
//   Stories : reworded the force-only summary + the two "No capacitance data"
//             empty-state list items, inserted one new "Capacitance file required"
//             story under Story 1.10.1 (Manual Analysis Window).

function reviseManualCap(){
  var DOC='1WEPQc12fajNlvKLRF4vVRBHkHhv_EFc_Sx1cA6qyTZI';
  var doc=DocumentApp.openById(DOC);
  var body=doc.getBody();
  var tables=body.getTables(), table=null;
  for(var i=0;i<tables.length;i++){var t=tables[i];if(t.getNumRows()>0&&t.getRow(0).getNumCells()>=5&&t.getRow(0).getCell(0).getText().trim()==='CoS'){table=t;break;}}
  if(!table){Logger.log('NO TABLE');return;}
  function norm(s){return s.replace(/\s+/g,' ').trim();}
  function rowByCode(code){
    var re=new RegExp('^'+code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\s|$)');
    for(var r=1;r<table.getNumRows();r++){ if(re.test(norm(table.getRow(r).getCell(0).getText()))) return r; }
    return -1;
  }
  var rep=[];
  var r1=rowByCode('1.10.2 #3');
  if(r1>=0){
    if(table.getRow(r1).getCell(1).getText().indexOf('Capacitance data needed')<0){
      table.getRow(r1).getCell(0).setText('1.10.2 #3 The Capacitance plot tabs use the real dropped CAP file.');
      table.getRow(r1).getCell(1).setText('Given no capacitance (CAP) file has been added to the CAP subfolder, When Perform Analysis is pressed, Then a "Capacitance data needed" dialog appears (as in EM and Shear) and the Capacitance vs Force and Capacitance vs Time tabs do not open until a CAP file is added.');
      rep.push('revised 1.10.2#3');
    } else rep.push('skip 1.10.2#3');
  } else rep.push('MISS 1.10.2#3');
  var r2=rowByCode('1.10.3 #2');
  if(r2>=0){
    if(table.getRow(r2).getCell(1).getText().indexOf('real measured capacitance')<0){
      table.getRow(r2).getCell(0).setText('1.10.3 #2 The interactive Capacitance plots use the real dropped CAP file.');
      table.getRow(r2).getCell(1).setText('Given a capacitance (CAP) file has been added to the CAP subfolder (same 8-channel layout as EM and Shear), When the manual analysis runs, Then the Capacitance vs Force and Capacitance vs Time interactive plots show the real measured capacitance.');
      rep.push('revised 1.10.3#2');
    } else rep.push('skip 1.10.3#2');
  } else rep.push('MISS 1.10.3#2');
  if(rowByCode('1.10.1 #3')<0){
    var ref=rowByCode('1.10.1 #2');
    if(ref>=0){
      var tmpl=table.getRow(ref).copy();
      tmpl.getCell(0).setText('1.10.1 #3 Manual analysis requires a capacitance (CAP) file, like EM and Shear.');
      tmpl.getCell(1).setText('Given a completed manual run, When Perform Analysis is pressed and no CAP file is present in the test folder CAP subfolder, Then a "Capacitance data needed" dialog appears and no analysis window opens. When the operator adds the capacitance file (same layout as EM and Shear) to the CAP subfolder and presses Perform Analysis again, Then the manual analysis runs and the Capacitance vs Force and Capacitance vs Time plots show the real measured capacitance.');
      for(var c=2;c<tmpl.getNumCells();c++) tmpl.getCell(c).setText('');
      table.insertTableRow(ref+1,tmpl);
      rep.push('inserted 1.10.1#3');
    } else rep.push('MISS ref 1.10.1#2');
  } else rep.push('skip 1.10.1#3');
  doc.saveAndClose();
  Logger.log(rep.join(' | '));
}

// User Stories doc: reword the three "No capacitance data" list items to the new
// required-CAP-file behavior. (Insertion of the new story was done by
// fixStoryPlacement below, anchored to the Manual-specific list item.)
function reviseStories3(){
  var DOC='1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME';
  var doc=DocumentApp.openById(DOC);
  var tabs=doc.getTabs();
  var body=null;
  for(var i=0;i<tabs.length;i++){var b=tabs[i].asDocumentTab().getBody();if(b.getText().indexOf('Manual Analysis Plots')>=0){body=b;break;}}
  if(!body){Logger.log('no body');return;}
  var rep=[];
  var paras=body.getParagraphs();
  for(var p=0;p<paras.length;p++){
    var el=paras[p]; var txt=el.getText();
    if(txt.indexOf('No capacitance data')>=0 && txt.indexOf('Capacitance data needed')<0){
      if(txt.indexOf('records force only')>=0){
        el.setText('Because manual analysis now reads real capacitance from a dropped CAP file (same layout as EM and Shear), the Force vs Time graph plots the recorded force, and the Capacitance vs Force and Capacitance vs Time graphs show the real capacitance once a CAP file is added; if no CAP file has been added, a "Capacitance data needed" prompt is shown.');
        rep.push('reworded force-only@'+p);
      } else if(txt.indexOf('rather than measured capacitance')>=0){
        el.setText('Because manual analysis reads capacitance from a dropped CAP file, if no CAP file has been added the Capacitance vs Force and Capacitance vs Time tabs do not open and a "Capacitance data needed" prompt is shown (as in EM and Shear); once a CAP file is added they show the real measured capacitance.');
        rep.push('reworded tabs@'+p);
      } else if(txt.indexOf('interactive plots')>=0){
        el.setText('The Capacitance vs Force and Capacitance vs Time interactive plots show the real capacitance from the dropped CAP file (same 8-channel layout as EM and Shear); if no CAP file has been added, a "Capacitance data needed" prompt is shown instead.');
        rep.push('reworded interactive@'+p);
      }
    }
  }
  doc.saveAndClose();
  Logger.log(rep.join(' | '));
}

// Insert the new "Capacitance file required" story under Story 1.10.1, anchored to
// the Manual-specific list item ("Perform Analysis is selected from the Manual
// Testing Window") so it does not land under the EM section. Idempotent: removes any
// existing copy first.
function fixStoryPlacement(){
  var DOC='1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME';
  var doc=DocumentApp.openById(DOC);
  var tabs=doc.getTabs(); var body=null;
  for(var i=0;i<tabs.length;i++){var b=tabs[i].asDocumentTab().getBody();if(b.getText().indexOf('Manual Analysis Plots')>=0){body=b;break;}}
  if(!body){Logger.log('no body');return;}
  var rep=[];
  var lis=body.getListItems();
  for(var q=lis.length-1;q>=0;q--){
    if(lis[q].getText().indexOf('Capacitance file required')>=0){ lis[q].removeFromParent(); rep.push('removed@'+q); }
  }
  lis=body.getListItems(); var anchor=null;
  for(var r=0;r<lis.length;r++){
    if(lis[r].getText().indexOf('Perform Analysis is selected from the Manual Testing Window')>=0){anchor=lis[r];break;}
  }
  if(anchor){
    var parent=anchor.getParent(); var idx=parent.getChildIndex(anchor);
    var li=anchor.copy();
    li.setText('Capacitance file required, like EM and Shear: when Perform Analysis is pressed with no capacitance (CAP) file in the test folder CAP subfolder, a "Capacitance data needed" dialog appears and no analysis window opens. After the operator adds the CAP file (same layout as EM and Shear) and presses Perform Analysis again, the Capacitance vs Force and Capacitance vs Time plots show the real capacitance.');
    parent.insertListItem(idx+1, li);
    rep.push('inserted after manual anchor idx='+idx);
  } else rep.push('no manual anchor');
  doc.saveAndClose();
  Logger.log(rep.join(' | '));
}
