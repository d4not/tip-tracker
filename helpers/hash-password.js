#!/usr/bin/env node
// Generate a bcrypt hash suitable for ADMIN_PASSWORD_HASH.
//   node helpers/hash-password.js 'my secret'
// or pipe it:   echo 'my secret' | node helpers/hash-password.js

'use strict';

const bcrypt = require('bcryptjs');

function read() {
  if (process.argv[2]) return Promise.resolve(process.argv[2]);
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
  });
}

read().then((pw) => {
  if (!pw) {
    process.stderr.write('Usage: node helpers/hash-password.js <password>\n');
    process.exit(2);
  }
  const hash = bcrypt.hashSync(pw, 12);
  process.stdout.write(hash + '\n');
});
