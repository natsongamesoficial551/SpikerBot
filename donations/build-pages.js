const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(process.argv[2] || 'pages-checkout');
const assets = path.join(output, 'doar');
fs.mkdirSync(assets, { recursive: true });
for (const [source, destination] of [
  ['checkout.html', 'index.html'],
  ['checkout.css', 'checkout.css'],
  ['checkout.js', 'checkout.js']
]) {
  fs.copyFileSync(path.join(__dirname, source), path.join(assets, destination));
}
fs.copyFileSync(path.join(__dirname, 'pages-worker.mjs'), path.join(output, '_worker.js'));
