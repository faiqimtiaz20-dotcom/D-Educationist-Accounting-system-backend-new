require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const base = 'http://127.0.0.1:3001/api/v1'
const prisma = new PrismaClient()

async function req(method, pathName, token, body, isForm) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  let payload = body
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${base}${pathName}`, {
    method,
    headers,
    body: payload,
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
  const token = login.data?.accessToken
  out.login = { status: login.status }

  const approvals = await req('GET', '/approvals?status=Pending', token)
  out.approvals = {
    status: approvals.status,
    pending: Array.isArray(approvals.data) ? approvals.data.length : 0,
  }

  const pendingExpense = (approvals.data || []).find(
    (a) => a.approvalType === 'Expense' || a.type === 'Expense',
  )

  if (pendingExpense?.id) {
    const beforeJe = await prisma.journalEntry.count({
      where: {
        sourceType: 'Expense',
        sourceId: pendingExpense.sourceId,
      },
    })
    const approved = await req(
      'POST',
      `/approvals/${pendingExpense.id}/approve`,
      token,
      {},
    )
    out.approveExpense = {
      status: approved.status,
      approvalStatus: approved.data?.status,
      err: approved.status >= 400 ? approved.data : undefined,
    }
    const afterJe = await prisma.journalEntry.count({
      where: {
        sourceType: 'Expense',
        sourceId: pendingExpense.sourceId,
      },
    })
    out.glPosted = {
      before: beforeJe,
      after: afterJe,
      ok: afterJe > beforeJe,
    }
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'Approval',
        entityId: pendingExpense.id,
        action: 'APPROVE',
      },
      orderBy: { createdAt: 'desc' },
    })
    out.auditApprove = { found: Boolean(audit) }
  } else {
    out.approveExpense = { skipped: true }
    out.glPosted = { ok: false }
    out.auditApprove = { found: false }
  }

  // SoD: requester cannot approve own
  const ahmedLogin = await req('POST', '/auth/login', null, {
    email: 'ahmed@saa.com',
    password: 'ChangeMe123!',
  })
  const ahmedToken = ahmedLogin.data?.accessToken
  const branches = await req('GET', '/branches', token)
  const khi = (branches.data || []).find((b) => b.code === 'KHI')
  const cats = await req('GET', '/expense-categories', ahmedToken)
  const cat = (cats.data || [])[0]
  const banks = await req('GET', '/bank-accounts', ahmedToken)
  const bank = (banks.data || []).find((b) => b.branchId === khi?.id) || (banks.data || [])[0]

  const createdEx = await req('POST', '/expenses', ahmedToken, {
    branchId: khi?.id,
    vendorName: 'SoD Test Vendor',
    categoryId: cat?.id,
    expenseDate: '2026-10-08',
    principal: 1000,
    paymentMode: 'Bank',
    bankAccountId: bank?.id,
  })
  out.createExpense = {
    status: createdEx.status,
    id: createdEx.data?.id,
    err: createdEx.status >= 400 ? createdEx.data : undefined,
  }

  const pendingList = await req('GET', '/approvals?status=Pending', token)
  const own = (pendingList.data || []).find(
    (a) => a.sourceId === createdEx.data?.id,
  )
  out.approvalCreated = { found: Boolean(own), id: own?.id }

  if (own?.id) {
    const sod = await req(
      'POST',
      `/approvals/${own.id}/approve`,
      ahmedToken,
      {},
    )
    out.sodBlocked = { status: sod.status, ok: sod.status === 403 }
    // cleanup via admin reject
    await req('POST', `/approvals/${own.id}/reject`, token, {})
  }

  // Documents upload
  const form = new FormData()
  const blob = new Blob(['M11 verify document content'], { type: 'text/plain' })
  form.append('file', blob, 'verify-m11.txt')
  form.append('docType', 'Bill')
  form.append('linkedType', 'Expense')
  form.append(
    'linkedId',
    createdEx.data?.id || '00000000-0000-4000-8000-000000000001',
  )
  form.append('name', 'verify-m11.txt')

  const up = await fetch(`${base}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const upData = await up.json().catch(() => null)
  out.upload = { status: up.status, id: upData?.id, err: up.status >= 400 ? upData : undefined }

  if (upData?.id) {
    const dl = await fetch(`${base}/documents/${upData.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    out.download = { status: dl.status, ok: dl.status === 200 }
    const del = await req('DELETE', `/documents/${upData.id}`, token)
    out.deleteDoc = { status: del.status }
  }

  const docs = await req('GET', '/documents', token)
  out.docsList = {
    status: docs.status,
    count: Array.isArray(docs.data) ? docs.data.length : 0,
  }

  const audits = await req('GET', '/audit-logs?take=20', token)
  const auditItems = Array.isArray(audits.data)
    ? audits.data
    : audits.data?.items
  out.audits = {
    status: audits.status,
    count: Array.isArray(auditItems) ? auditItems.length : 0,
  }

  console.log(JSON.stringify(out, null, 2))

  const ok =
    out.health?.milestone === 'M11' &&
    out.approvals?.status === 200 &&
    out.approveExpense?.approvalStatus === 'Approved' &&
    out.glPosted?.ok &&
    out.auditApprove?.found &&
    out.approvalCreated?.found &&
    out.sodBlocked?.ok &&
    out.upload?.status === 201 &&
    out.download?.ok &&
    out.docsList?.status === 200 &&
    out.audits?.status === 200 &&
    out.audits?.count > 0

  if (!ok) {
    console.error('VERIFY M11 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M11 OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
