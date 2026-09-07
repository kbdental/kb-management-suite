// Checks EVERY inline <script> in the app. Kept in the repo, not a scratch
// directory: the previous copies lived in an ephemeral scratchpad and were
// lost when the container was recycled, taking the whole regression suite
// with them.
const fs = require('fs');
const file = process.argv[2] || __dirname + '/../index.html';
const html = fs.readFileSync(file, 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, bad = 0, checked = 0;
while ((m = re.exec(html))) {
  i++;
  const body = m[1];
  if (!body.trim()) continue;
  const line = html.slice(0, m.index).split('\n').length;
  checked++;
  try { new Function(body); }
  catch (e) { bad++; console.log('SYNTAX ERROR in block #' + i + ' (line ' + line + '): ' + e.message); }
}
console.log(bad ? ('FAILED — ' + bad + ' of ' + checked + ' blocks bad')
                : ('SYNTAX OK — all ' + checked + ' inline script blocks parse'));
process.exit(bad ? 1 : 0);
