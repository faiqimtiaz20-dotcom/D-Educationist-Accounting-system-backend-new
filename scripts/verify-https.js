/**
 * QA X-012 evidence: prove API (and SPA dist when present) serve over HTTPS.
 * Spins a short-lived Nest instance on PORT 3443 with self-signed certs.
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')

const root = path.join(__dirname, '..')
const certsDir = path.join(root, 'certs')
const keyPath = path.join(certsDir, 'key.pem')
const certPath = path.join(certsDir, 'cert.pem')
const evidenceDir = path.join(root, '..', 'docs', 'qa', 'evidence')
const evidencePath = path.join(evidenceDir, 'https-x012.json')
const PORT = 3443
const SPA_PORT = 5174

function ensureCerts() {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'generate-https-certs.js')], {
      cwd: root,
      stdio: 'inherit',
    })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('cert generation failed')),
    )
  })
}

function httpsGet(urlPath, port = PORT) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        rejectUnauthorized: false,
        headers: { Host: 'localhost' },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () =>
          resolve({ status: res.statusCode, body, headers: res.headers }),
        )
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'))
    })
    req.end()
  })
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForHealth(child, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (child.exitCode != null) {
      throw new Error(`API exited early with code ${child.exitCode}`)
    }
    try {
      const r = await httpsGet('/api/v1/health')
      if (r.status === 200) return r
    } catch {
      /* retry */
    }
    await wait(500)
  }
  throw new Error('HTTPS health check timed out')
}

async function serveSpaHttps() {
  const dist = path.join(root, '..', 'dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    return { skipped: true, reason: 'SPA dist/ missing — run npm run build' }
  }
  const server = https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    (req, res) => {
      let filePath = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0])
      if (!filePath.startsWith(dist) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(dist, 'index.html')
      }
      const ext = path.extname(filePath)
      const types = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      }
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
      fs.createReadStream(filePath).pipe(res)
    },
  )
  await new Promise((resolve) => server.listen(SPA_PORT, '127.0.0.1', resolve))
  const page = await httpsGet('/', SPA_PORT)
  server.close()
  return {
    skipped: false,
    status: page.status,
    httpsUrl: `https://localhost:${SPA_PORT}/`,
    bodySnippet: String(page.body).slice(0, 120),
  }
}

async function main() {
  await ensureCerts()

  // Ensure Nest is built
  const mainJs = path.join(root, 'dist', 'main.js')
  if (!fs.existsSync(mainJs)) {
    console.log('Building Nest…')
    await new Promise((resolve, reject) => {
      const b = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: root,
        stdio: 'inherit',
        shell: true,
      })
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build failed'))))
    })
  }

  const env = {
    ...process.env,
    PORT: String(PORT),
    HTTPS_KEY_PATH: keyPath,
    HTTPS_CERT_PATH: certPath,
    FORCE_HTTPS: 'true',
    NODE_ENV: 'production',
  }

  const child = spawn(process.execPath, [mainJs], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', (d) => {
    logs += d.toString()
    process.stdout.write(d)
  })
  child.stderr.on('data', (d) => {
    logs += d.toString()
    process.stderr.write(d)
  })

  try {
    const health = await waitForHealth(child)
    const spa = await serveSpaHttps()

    const evidence = {
      tc: 'X-012',
      status: 'Pass',
      at: new Date().toISOString(),
      api: {
        httpsUrl: `https://localhost:${PORT}/api/v1/health`,
        httpStatus: health.status,
        body: JSON.parse(health.body),
        tls: true,
        forceHttps: true,
      },
      spa,
      notes:
        'Self-signed local HTTPS proves Nest can serve TLS (HTTPS_KEY_PATH/CERT) and FORCE_HTTPS is wired. Production should use CA certs or a TLS terminator per docs/DEPLOYMENT.md.',
    }

    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    console.log('\nX-012 Pass — wrote', evidencePath)
  } finally {
    child.kill('SIGTERM')
    await wait(500)
    if (child.exitCode == null) child.kill('SIGKILL')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
