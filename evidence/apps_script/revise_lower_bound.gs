// Applied 2026-07-15: update the Fatigue Lower Force Bound spec to match the GUI
// change (min 0.1 N, max 32 N, 0.1 N steps, default 1 N; no longer a whole-number
// >= 1 N integer field). The GUI snap message is "Lower Force Bound must be between
// 0.1 and 32 N."
//
// Docs updated:
//   Feature 1.11 (Fatigue) test-plan  -> reviseLowerBound()
//     Story 1.11.3 heading (dropped "Integer"), 1.11.3 #1 (field spec),
//     1.11.3 #3 (snap/round-to-whole -> snap to 0.1 N precision + new message).
//     1.11.3 #2 (upper<lower) and the 1.11.15 #5 tooltip were left as-is.
//   Combined User Stories             -> reviseLowerBound() + reviseB3Lower()
//     v2 tab (b0): heading, field spec, snap item.
//     v1 tab (b3, "v1 us"): heading (via reviseLowerBound broad match), field spec
//     ("positive integer, strictly greater than 0" -> new), and the ">0 rule"
//     verification note (reviseB3Lower).
// Upper Force Bound, Number of Runs, and Frequency wording were intentionally left
// untouched (out of scope for this change).

function reviseLowerBound(){
  var rep=[];
  var d=DocumentApp.openById('1kGlBWCZMUqrkMB9sWKied55lngmYhdMNz42SggQMoow');
  var tables=d.getBody().getTables(), table=null;
  for(var i=0;i<tables.length;i++){var t=tables[i];if(t.getNumRows()>0&&t.getRow(0).getNumCells()>=5&&t.getRow(0).getCell(0).getText().trim()==='CoS'){table=t;break;}}
  for(var r=1;r<table.getNumRows();r++){
    var c0=table.getRow(r).getCell(0);
    var s0=c0.getText().replace(/\s+/g,' ').trim();
    if(s0.indexOf('Lower Force Bound Integer Field')>=0){
      c0.setText('Story 1.11.3: Lower Force Bound Field'); rep.push('doc head r'+r);
    } else if(/^1\.11\.3 #1(\s|$)/.test(s0) && s0.indexOf('0.1 to 32 N')<0){
      c0.setText('1.11.3 #1 The Lower Force Bound field should accept a number from 0.1 to 32 N in 0.1 N steps; default = 1 N.');
      table.getRow(r).getCell(1).setText('Given the Lower Force Bound field, Then it accepts a number from 0.1 to 32 N in 0.1 N steps and defaults to 1 N.');
      rep.push('doc 1.11.3#1 r'+r);
    } else if(/^1\.11\.3 #3(\s|$)/.test(s0) && s0.indexOf('0.1 N precision')<0){
      c0.setText('1.11.3 #3 When an out-of-range value is entered, on commit the Lower Force Bound should snap to the nearest allowed value (0.1 N precision) and display a message stating the limit.');
      table.getRow(r).getCell(1).setText('Given an out-of-range value entered in the Lower Force Bound field, When the user commits the value, Then the system displays "Lower Force Bound must be between 0.1 and 32 N." and snaps the value to the nearest 0.1 N limit.');
      rep.push('doc 1.11.3#3 r'+r);
    }
  }
  d.saveAndClose();
  var doc=DocumentApp.openById('1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME');
  var tabs=doc.getTabs();
  for(var b=0;b<tabs.length;b++){
    var paras=tabs[b].asDocumentTab().getBody().getParagraphs();
    for(var p=0;p<paras.length;p++){
      var el=paras[p]; var t=el.getText();
      if(t.indexOf('Lower Force Bound Integer Field')>=0){
        el.setText('Story 1.11.3: Lower Force Bound Field'); rep.push('story head b'+b+'p'+p);
      } else if(t.indexOf('Lower Force Bound field should accept a whole number of at least 1 N')>=0){
        el.setText('The Lower Force Bound field should accept a number from 0.1 to 32 N in 0.1 N steps; default = 1 N.');
        rep.push('story spec b'+b+'p'+p);
      } else if(t.indexOf('on commit the Lower Force Bound should snap to the nearest allowed value and round to a whole number')>=0){
        el.setText('When an out-of-range value is entered, on commit the Lower Force Bound should snap to the nearest allowed value (0.1 N precision) and display a message stating the limit ("Lower Force Bound must be between 0.1 and 32 N").');
        rep.push('story snap b'+b+'p'+p);
      }
    }
  }
  doc.saveAndClose();
  Logger.log(rep.join(' | '));
}

// The legacy "v1 us" tab (index 3) uses older phrasing for the same field.
function reviseB3Lower(){
  var doc=DocumentApp.openById('1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME');
  var body=doc.getTabs()[3].asDocumentTab().getBody();
  var paras=body.getParagraphs();
  var rep=[];
  for(var p=0;p<paras.length;p++){
    var el=paras[p]; var t=el.getText();
    if(t.indexOf('positive integer, strictly greater than 0; default = 1 N')>=0){
      el.setText('Accepts a number from 0.1 to 32 N in 0.1 N steps; default = 1 N');
      rep.push('b3 spec p'+p);
    } else if(t.indexOf('Confirm default, the >0 rule, and the lower-vs-upper validation')>=0){
      el.setText('Verification: Confirm default, the 0.1 to 32 N range, and the lower-vs-upper validation');
      rep.push('b3 verify p'+p);
    }
  }
  doc.saveAndClose();
  Logger.log(rep.join(' | ') || 'no match');
}
