const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(process.argv[2] || 'pages-checkout');
const assets = path.join(output, 'doar');
const server = 'https://spikerbot.onrender.com';
fs.mkdirSync(assets, { recursive: true });
const html = fs.readFileSync(path.join(__dirname, 'checkout.html'), 'utf8')
  .replace('<meta name="checkout-api" content="">', `<meta name="checkout-api" content="${server}">`);
fs.writeFileSync(path.join(assets, 'index.html'), html);
for (const name of ['checkout.css', 'checkout.js']) {
  fs.copyFileSync(path.join(__dirname, name), path.join(assets, name));
}
fs.writeFileSync(path.join(output, '_redirects'), '/ /doar/ 302\n');
fs.writeFileSync(path.join(output, '_headers'), `/*
  Cache-Control: no-store
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src ${server}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`);
