require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const base = 'http://127.0.0.1:3001/api/v1'

async function req(method, path, token, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

async function main() {
  const out = {}

  const health = await req('GET', '/health')
  out.health = {
    status: health.status,
    milestone: health.data?.milestone,
  }

  const info = await req('GET', '/')
  out.info = {
    status: info.status,
    milestone: info.data?.milestone,
    version: info.data?.version,
  }

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  out.login = { status: login.status, hasAccess: Boolean(login.data?.accessToken) }
  const token = login.data?.accessToken
  if (!token) {
    console.log(JSON.stringify(out, null, 2))
    throw new Error('Login failed — cannot continue M3 checks')
  }

  const endpoints = [
    '/universities',
    '/sub-agents',
    '/vendors',
    '/bank-accounts',
    '/expense-categories',
    '/petty-cash-categories',
    '/currencies',
    '/fx-rates',
    '/gl-accounts',
  ]
  out.lists = {}
  for (const path of endpoints) {
    const r = await req('GET', path, token)
    out.lists[path] = {
      status: r.status,
      count: Array.isArray(r.data) ? r.data.length : null,
      error: r.status >= 400 ? r.data?.message || r.data : undefined,
    }
  }

  // Create + delete a university round-trip
  const created = await req('POST', '/universities', token, {
    name: 'M3 Smoke Test University',
    countryName: 'UK',
    countryCode: 'GB',
    defaultCommissionRate: 12.5,
    currencyCode: 'GBP',
  })
  out.createUniversity = {
    status: created.status,
    id: created.data?.id,
    error: created.status >= 400 ? created.data?.message || created.data : undefined,
  }
  if (created.data?.id) {
    const del = await req('DELETE', `/universities/${created.data.id}`, token)
    out.deleteUniversity = { status: del.status, success: del.data?.success }
  }

  const prisma = new PrismaClient()
  out.db = {
    universities: await prisma.university.count({ where: { deletedAt: null } }),
    subAgents: await prisma.subAgent.count({ where: { deletedAt: null } }),
    vendors: await prisma.vendor.count({ where: { deletedAt: null } }),
    bankAccounts: await prisma.bankAccount.count({ where: { deletedAt: null } }),
    glAccounts: await prisma.glAccount.count(),
    pettyCats: await prisma.pettyCashCategory.count(),
    expenseCats: await prisma.expenseCategory.count(),
    countries: await prisma.country.count(),
  }
  await prisma.$disconnect()

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
