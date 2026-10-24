const {existsSync}=require('node:fs');
const path=require('node:path');

// Production samples remain local. Missing samples skip only their own tests;
// malformed samples and failed assertions still fail normally.
function fixtureOptions(names){
 const missing=(Array.isArray(names)?names:[names]).filter(name=>!existsSync(path.join(__dirname,'fixtures',name)));
 return {skip:missing.length?`Local fixture not supplied: ${missing.join(', ')}`:false};
}

module.exports={fixtureOptions};
