require('dotenv').config()
const fs = require('fs')
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

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  out.login = {
    status: login.status,
    role: login.data?.user?.roleCode,
    hasAccess: Boolean(login.data?.accessToken),
    hasRefresh: Boolean(login.data?.refreshToken),
  }
  const token = login.data?.accessToken
  const refresh = login.data?.refreshToken

  const me = await req('GET', '/auth/me', token)
  out.me = {
    status: me.status,
    permCount: me.data?.permissions?.length,
    role: me.data?.user?.roleCode,
  }

  const refreshed = await req('POST', '/auth/refresh', null, {
    refreshToken: refresh,
  })
  out.refresh = {
    status: refreshed.status,
    hasAccess: Boolean(refreshed.data?.accessToken),
  }
  const token2 = refreshed.data?.accessToken || token
  const refresh2 = refreshed.data?.refreshToken || refresh

  const branches = await req('GET', '/branches', token2)
  const users = await req('GET', '/users', token2)
  const settings = await req('GET', '/settings', token2)
  const matrix = await req('GET', '/permissions/matrix', token2)
  out.lists = {
    branches: { status: branches.status, count: branches.data?.length },
    users: { status: users.status, count: users.data?.length },
    settings: {
      status: settings.status,
      wht: settings.data?.whtRatePercent,
      org: settings.data?.orgName,
    },
    matrix: { status: matrix.status, modules: matrix.data?.matrix?.length },
  }

  const bad = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'wrong',
  })
  out.badLogin = { status: bad.status }

  const bm = await req('POST', '/auth/login', null, {
    email: 'ahmed@saa.com',
    password: 'ChangeMe123!',
  })
  const bmUsers = await req('GET', '/users', bm.data?.accessToken)
  const foreign = (users.data || []).find((u) => u.branch?.code !== 'KHI')
  const cross = foreign
    ? await req('GET', `/users/${foreign.id}`, bm.data?.accessToken)
    : { status: 'n/a', data: null }
  out.branchScope = {
    bmLogin: bm.status,
    bmUserCount: bmUsers.data?.length,
    bmBranchCodes: [
      ...new Set((bmUsers.data || []).map((u) => u.branch?.code)),
    ],
    crossStatus: cross.status,
  }

  const counsellor = await req('POST', '/auth/login', null, {
    email: 'fatima@saa.com',
    password: 'ChangeMe123!',
  })
  const counsellorSettings = await req(
    'GET',
    '/settings',
    counsellor.data?.accessToken,
  )
  out.permissionGate = {
    counsellorLogin: counsellor.status,
    settingsStatus: counsellorSettings.status,
  }

  const logout = await req('POST', '/auth/logout', token2, {
    refreshToken: refresh2,
  })
  out.logout = { status: logout.status, success: logout.data?.success }

  const prisma = new PrismaClient()
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@saa.com' },
  })
  const roles = await prisma.role.count()
  const modules = await prisma.appModule.count()
  const perms = await prisma.roleModulePermission.count()
  const audits = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { action: true, module: true },
  })
  out.db = {
    hashPrefix: admin?.passwordHash?.slice(0, 4),
    roles,
    modules,
    perms,
    recentAudit: audits.map((a) => `${a.action}:${a.module}`),
  }
  await prisma.$disconnect()

  // Code presence checks
  out.code = {
    resolveBranchScopeUsedElsewhere: false, // filled below via grep awareness
    frontendApiClient: fs.existsSync('../src/lib/api-client.ts'),
    frontendEnv: fs.existsSync('../.env'),
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
