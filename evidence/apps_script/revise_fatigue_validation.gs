// Applied 2026-07-14: correct the Fatigue START-validation spec (1.11.7 #3), which
// claimed "any blank/invalid field blocks START with a validation message". That is
// not how the live GUI behaves:
//   - Out-of-range numeric fields SNAP to their nearest allowed limit on change/blur
//     (snapNumberInput in shared.js), with a message naming the limit. They are
//     auto-corrected, not blocked.
//   - Blank fields fall back to their defaults at START (config() in main.js coerces
//     upper->20, frequency->1, cycles-> >=1).
//   - The ONLY START-blocking validation is cyclicalBounds().isValid, i.e. the upper
//     force bound must be greater than the lower force bound; otherwise START shows
//     "upper force bound must be higher than lower force bound." (startCyclicalTest
//     in fatigue.js).
//
// Ran against:
//   Feature 1.11 (Fatigue) test-plan doc  -> row 1.11.7 #3 (both cells)
//   Combined v2 User Stories doc          -> the two "blank/invalid" list items
//                                            (the "block START" story and the
//                                            "Unhappy path - invalid field" story).
// The disconnect hard-block story ("STATE.connection_lost = True # hard-block Start")
// is a different concept and was intentionally left untouched.

function reviseFatigueValidation(){
  var rep=[];
  var d=DocumentApp.openById('1kGlBWCZMUqrkMB9sWKied55lngmYhdMNz42SggQMoow');
  var tables=d.getBody().getTables(), table=null;
  for(var i=0;i<tables.length;i++){var t=tables[i];if(t.getNumRows()>0&&t.getRow(0).getNumCells()>=5&&t.getRow(0).getCell(0).getText().trim()==='CoS'){table=t;break;}}
  var ri=-1;
  for(var r=1;r<table.getNumRows();r++){ if(/^1\.11\.7 #3(\s|$)/.test(table.getRow(r).getCell(0).getText().replace(/\s+/g,' ').trim())){ri=r;break;} }
  if(ri>=0){
    if(table.getRow(ri).getCell(1).getText().indexOf('snaps to the nearest')<0){
      table.getRow(ri).getCell(0).setText('1.11.7 #3 Out-of-range fields snap to their allowed range and blank fields fall back to defaults; START is blocked only when the upper force bound is not above the lower force bound.');
      table.getRow(ri).getCell(1).setText('Given a fatigue field value is out of range, When the field commits (change or blur), Then it snaps to the nearest allowed limit and a message names that limit; and given a field is left blank, it falls back to its default when START is clicked. Given the upper force bound is not greater than the lower force bound, When START is clicked, Then START is blocked and "upper force bound must be higher than lower force bound." is displayed; otherwise the fatigue test proceeds.');
      rep.push('revised 1.11.7#3');
    } else rep.push('skip 1.11.7#3');
    d.saveAndClose();
  } else rep.push('MISS 1.11.7#3');
  var doc=DocumentApp.openById('1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME');
  var tabs=doc.getTabs();
  for(var b=0;b<tabs.length;b++){
    var body=tabs[b].asDocumentTab().getBody();
    var paras=body.getParagraphs();
    for(var p=0;p<paras.length;p++){
      var el=paras[p]; var txt=el.getText();
      if(txt.indexOf('blank/invalid')>=0 && txt.indexOf('snap')<0){
        if(txt.indexOf('Unhappy path')>=0){
          el.setText('Unhappy path - out-of-range or blank field: out-of-range fatigue fields snap to their allowed range (with a message), and blank fields fall back to their defaults, so START is not blocked; START is blocked only when the upper force bound is not greater than the lower force bound.');
          rep.push('reworded unhappy b'+b+'p'+p);
        } else if(txt.indexOf('block START')>=0){
          el.setText('Out-of-range fatigue fields snap to their allowed range on change or blur (with a message naming the limit), and blank fields fall back to their defaults, so START is not blocked on a blank or out-of-range field. START is blocked only when the upper force bound is not greater than the lower force bound, which shows "upper force bound must be higher than lower force bound.".');
          rep.push('reworded block b'+b+'p'+p);
        }
      }
    }
  }
  doc.saveAndClose();
  Logger.log(rep.join(' | '));
}
