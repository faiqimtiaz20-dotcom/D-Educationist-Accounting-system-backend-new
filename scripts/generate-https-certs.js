/**
 * Generate local self-signed TLS certs for HTTPS smoke / QA X-012.
 * Production should use CA-issued certificates from the hosting platform.
 */
const fs = require('fs')
const path = require('path')
const selfsigned = require('selfsigned')

async function main() {
  const outDir = path.join(__dirname, '..', 'certs')
  fs.mkdirSync(outDir, { recursive: true })

  const attrs = [{ name: 'commonName', value: 'localhost' }]
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  })

  const keyPath = path.join(outDir, 'key.pem')
  const certPath = path.join(outDir, 'cert.pem')
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(certPath, pems.cert)

  console.log('Wrote', keyPath)
  console.log('Wrote', certPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
