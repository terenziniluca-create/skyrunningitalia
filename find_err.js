const fs = require('fs');
const html = fs.readFileSync('public/dashboard-admin.html', 'utf8');

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!scriptMatch) {
  console.log('Script block not found!');
  process.exit(1);
}

try {
  new Function(scriptMatch[1]);
  console.log('✓ SUCCESS: JavaScript syntax in dashboard-admin.html is 100% VALID!');
} catch (e) {
  console.error('✗ SYNTAX ERROR:', e.message);
}
