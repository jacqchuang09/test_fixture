// Corrective pass: the revise14 story-title replacement accidentally inserted
// literal backslashes ("Story 1\.4\.7: Close Button"). Match the stray chars
// with wildcards and write a clean title. Runs against both docs.
function revise14b() {
  var DOCS = [
    '1CNOWSlOPN8aOv4_WNI_r1a1-LZ2uC42kWieXfywyMYU',
    '1fQwvFA__vE8hv2X4nK9bV-_oReM2UhAF6aPegc7xxME'
  ];
  for (var d = 0; d < DOCS.length; d++) {
    var doc = DocumentApp.openById(DOCS[d]);
    doc.getBody().replaceText('Story 1.{1,2}4.{1,2}7: Close Button', 'Story 1.4.7: Close Button');
    doc.saveAndClose();
  }
  Logger.log('revise14b done');
}
