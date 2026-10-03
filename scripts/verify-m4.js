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
  out.health = { status: health.status, milestone: health.data?.milestone }

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  out.login = { status: login.status, hasAccess: Boolean(login.data?.accessToken) }
  const token = login.data?.accessToken
  if (!token) {
    console.log(JSON.stringify(out, null, 2))
    throw new Error('Login failed')
  }

  const list = await req('GET', '/students', token)
  out.list = {
    status: list.status,
    count: Array.isArray(list.data) ? list.data.length : null,
    error: list.status >= 400 ? list.data?.message || list.data : undefined,
  }

  const unis = await req('GET', '/universities', token)
  const uni = (unis.data || [])[0]
  const users = await req('GET', '/users', token)
  const counsellor = (users.data || []).find((u) => u.role?.code === 'COUNSELLOR')
  const branches = await req('GET', '/branches', token)
  const branch = (branches.data || []).find((b) => !b.isHeadOffice)

  const code = `STU-M4-${Date.now().toString().slice(-6)}`
  const created = await req('POST', '/students', token, {
    studentCode: code,
    fullName: 'M4 Smoke Student',
    cnicPassport: '99999-9999999-9',
    contact: '+92 300 9999999',
    email: 'm4.smoke@test.com',
    branchId: branch?.id,
    counsellorId: counsellor?.id,
    country: uni?.countryName || 'UK',
    universityId: uni?.id,
    course: 'MSc Test',
    intake: 'Sep-2026',
    studentGroup: 'G1',
    applicationStatus: 'Applied',
    tuitionFee: 10000,
    scholarship: 500,
    expectedCommissionRate: Number(uni?.defaultCommissionRate) || 15,
    currencyCode: uni?.currencyCode || 'GBP',
  })
  out.create = {
    status: created.status,
    id: created.data?.id,
    error: created.status >= 400 ? created.data?.message || created.data : undefined,
  }

  if (created.data?.id) {
    const patched = await req('PATCH', `/students/${created.data.id}`, token, {
      applicationStatus: 'Offer',
    })
    out.statusChange = {
      status: patched.status,
      applicationStatus: patched.data?.applicationStatus,
    }
    const hist = await req('GET', `/students/${created.data.id}/status-history`, token)
    out.history = {
      status: hist.status,
      count: Array.isArray(hist.data) ? hist.data.length : null,
    }
    const del = await req('DELETE', `/students/${created.data.id}`, token)
    out.delete = { status: del.status, success: del.data?.success }
  }

  const counsellorLogin = await req('POST', '/auth/login', null, {
    email: 'fatima@saa.com',
    password: 'ChangeMe123!',
  })
  const cToken = counsellorLogin.data?.accessToken
  const cList = await req('GET', '/students', cToken)
  const foreign = (list.data || []).find((s) => s.counsellorId !== counsellor?.id)
  const cross = foreign
    ? await req('GET', `/students/${foreign.id}`, cToken)
    : { status: 'n/a' }
  out.counsellorScope = {
    login: counsellorLogin.status,
    listCount: Array.isArray(cList.data) ? cList.data.length : null,
    allOwn:
      Array.isArray(cList.data) &&
      cList.data.every((s) => s.counsellorId === counsellor?.id),
    crossGet: cross.status,
  }

  const prisma = new PrismaClient()
  out.db = {
    students: await prisma.student.count({ where: { deletedAt: null } }),
    history: await prisma.studentStatusHistory.count(),
  }
  await prisma.$disconnect()

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
