import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

function formatNext(latest: string | null | undefined, prefix: string, pad = 3): string {
  let next = 1
  if (latest) {
    const n = parseInt(latest.slice(prefix.length), 10)
    if (!Number.isNaN(n)) next = n + 1
  }
  return `${prefix}${String(next).padStart(pad, '0')}`
}

/** Master codes: VEN-001, UNI-001, EMP-001, SA-001 */
export async function nextMasterNo(
  db: Db,
  opts: {
    model: 'vendor' | 'university' | 'employee' | 'subAgent'
    field: 'vendorNo' | 'universityNo' | 'employeeNo' | 'subAgentNo'
    prefix: string
    pad?: number
  },
): Promise<string> {
  const pad = opts.pad ?? 3
  if (opts.model === 'vendor') {
    const row = await db.vendor.findFirst({
      where: { vendorNo: { startsWith: opts.prefix } },
      orderBy: { vendorNo: 'desc' },
      select: { vendorNo: true },
    })
    return formatNext(row?.vendorNo, opts.prefix, pad)
  }
  if (opts.model === 'university') {
    const row = await db.university.findFirst({
      where: { universityNo: { startsWith: opts.prefix } },
      orderBy: { universityNo: 'desc' },
      select: { universityNo: true },
    })
    return formatNext(row?.universityNo, opts.prefix, pad)
  }
  if (opts.model === 'employee') {
    const row = await db.employee.findFirst({
      where: { employeeNo: { startsWith: opts.prefix } },
      orderBy: { employeeNo: 'desc' },
      select: { employeeNo: true },
    })
    return formatNext(row?.employeeNo, opts.prefix, pad)
  }
  const row = await db.subAgent.findFirst({
    where: { subAgentNo: { startsWith: opts.prefix } },
    orderBy: { subAgentNo: 'desc' },
    select: { subAgentNo: true },
  })
  return formatNext(row?.subAgentNo, opts.prefix, pad)
}

/** Branch+year docs: COM-KHI-2026-001, PC-KHI-2026-001, PR-KHI-2026-001 */
export async function nextBranchYearNo(
  db: Db,
  branchId: string,
  opts: {
    model: 'subAgentCommission' | 'pettyCashEntry' | 'payrollRun' | 'expense'
    field: 'commissionNo' | 'pettyCashNo' | 'runNo' | 'expenseNo'
    docPrefix: string
    pad?: number
  },
): Promise<string> {
  const branch = await db.branch.findUniqueOrThrow({ where: { id: branchId } })
  const year = new Date().getFullYear()
  const prefix = `${opts.docPrefix}-${branch.code}-${year}-`
  const pad = opts.pad ?? 3

  if (opts.model === 'subAgentCommission') {
    const row = await db.subAgentCommission.findFirst({
      where: { commissionNo: { startsWith: prefix } },
      orderBy: { commissionNo: 'desc' },
      select: { commissionNo: true },
    })
    return formatNext(row?.commissionNo, prefix, pad)
  }
  if (opts.model === 'pettyCashEntry') {
    const row = await db.pettyCashEntry.findFirst({
      where: { pettyCashNo: { startsWith: prefix } },
      orderBy: { pettyCashNo: 'desc' },
      select: { pettyCashNo: true },
    })
    return formatNext(row?.pettyCashNo, prefix, pad)
  }
  if (opts.model === 'payrollRun') {
    const row = await db.payrollRun.findFirst({
      where: { runNo: { startsWith: prefix } },
      orderBy: { runNo: 'desc' },
      select: { runNo: true },
    })
    return formatNext(row?.runNo, prefix, pad)
  }
  const row = await db.expense.findFirst({
    where: { expenseNo: { startsWith: prefix } },
    orderBy: { expenseNo: 'desc' },
    select: { expenseNo: true },
  })
  return formatNext(row?.expenseNo, prefix, pad)
}

/** Tenant+year docs: PV-2026-001, REIM-2026-001, CE-2026-001, APR-2026-001 */
export async function nextYearNo(
  db: Db,
  opts: {
    model: 'subAgentPayment' | 'reimbursement' | 'contraEntry' | 'approval'
    field: 'paymentNo' | 'reimbursementNo' | 'contraNo' | 'approvalNo'
    docPrefix: string
    pad?: number
  },
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `${opts.docPrefix}-${year}-`
  const pad = opts.pad ?? 3

  if (opts.model === 'subAgentPayment') {
    const row = await db.subAgentPayment.findFirst({
      where: { paymentNo: { startsWith: prefix } },
      orderBy: { paymentNo: 'desc' },
      select: { paymentNo: true },
    })
    return formatNext(row?.paymentNo, prefix, pad)
  }
  if (opts.model === 'reimbursement') {
    const row = await db.reimbursement.findFirst({
      where: { reimbursementNo: { startsWith: prefix } },
      orderBy: { reimbursementNo: 'desc' },
      select: { reimbursementNo: true },
    })
    return formatNext(row?.reimbursementNo, prefix, pad)
  }
  if (opts.model === 'contraEntry') {
    const row = await db.contraEntry.findFirst({
      where: { contraNo: { startsWith: prefix } },
      orderBy: { contraNo: 'desc' },
      select: { contraNo: true },
    })
    return formatNext(row?.contraNo, prefix, pad)
  }
  const row = await db.approval.findFirst({
    where: { approvalNo: { startsWith: prefix } },
    orderBy: { approvalNo: 'desc' },
    select: { approvalNo: true },
  })
  return formatNext(row?.approvalNo, prefix, pad)
}
