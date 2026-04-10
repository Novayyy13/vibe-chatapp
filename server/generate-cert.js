const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Generate self-signed certificate
const { privateKey, certificate } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Create certificate
const cert = certificate;

// Write to files
fs.writeFileSync(path.join(__dirname, 'key.pem'), privateKey);
fs.writeFileSync(path.join(__dirname, 'cert.pem'), cert);

console.log('SSL certificates generated successfully!');