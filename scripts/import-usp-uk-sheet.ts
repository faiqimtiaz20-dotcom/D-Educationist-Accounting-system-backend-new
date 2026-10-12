/**
 * Import UK USP commission sheet → courses + universities + course rates.
 *
 * Usage:
 *   npx tsx scripts/import-usp-uk-sheet.ts [--tenant=CODE|UUID] [path-to.xlsx]
 *
 * Default tenant: DED (D' Educationist)
 * Default file: ../docs/imports/usp-commission-sheet-uk.xlsx
 *
 * Sheets: "UK", "UK Groups"
 * Rates in the sheet are often fractions (0.20 = 20%). Text cells are parsed
 * for the first percentage / number.
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'

const FALLBACK_TENANT_ID = 'a0000000-0000-4000-8000-000000000001'
const SHEETS = ['UK', 'UK Groups'] as const

const prisma = new PrismaClient()
let tenantId = FALLBACK_TENANT_ID

type CourseRateRow = {
  courseName: string
  uspPercent: number
  agentPercent: number
}

type UniDraft = {
  name: string
  countryName: string
  address: string | null
  pathway: string | null
  rates: CourseRateRow[]
}

function defaultXlsxPath() {
  return path.resolve(process.cwd(), '../docs/imports/usp-commission-sheet-uk.xlsx')
}

/** Convert sheet rate cell → percent 0–100. */
export function parseRatePercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return Math.round(value * 10000) / 100
    if (value > 1 && value <= 100) return Math.round(value * 100) / 100
    return null
  }
  const s = String(value).trim()
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pct) return Math.round(Number(pct[1]) * 100) / 100
  const num = s.match(/(\d+(?:\.\d+)?)/)
  if (!num) return null
  const n = Number(num[1])
  if (!Number.isFinite(n)) return null
  if (n >= 0 && n <= 1) return Math.round(n * 10000) / 100
  if (n > 1 && n <= 100) return Math.round(n * 100) / 100
  return null
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).replace(/\s+/g, ' ').trim()
  return s || null
}

function parseSheet(rows: unknown[][]): UniDraft[] {
  const byName = new Map<string, UniDraft>()
  let current: UniDraft | null = null

  // Skip title/header rows until we see S.No header
  let start = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const c0 = cleanText(rows[i]?.[0])?.toLowerCase()
    if (c0 === 's.no' || c0 === 'sno' || c0 === 's no') {
      start = i + 1
      break
    }
  }

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? []
    const institution = cleanText(row[1])
    const country = cleanText(row[2])
    const pathway = cleanText(row[3])
    const courseLevel = cleanText(row[4])
    const usp = parseRatePercent(row[5])
    const agent = parseRatePercent(row[6])
    const address = cleanText(row[8])

    if (institution) {
      const key = institution.toLowerCase()
      let draft = byName.get(key)
      if (!draft) {
        draft = {
          name: institution,
          countryName: country || 'UK',
          address,
          pathway,
          rates: [],
        }
        byName.set(key, draft)
      } else {
        if (address) draft.address = address
        if (country) draft.countryName = country
        if (pathway) draft.pathway = pathway
      }
      current = draft
    }

    if (!current || !courseLevel) continue
    if (usp === null && agent === null) continue

    const existing = current.rates.find(
      (r) => r.courseName.toLowerCase() === courseLevel.toLowerCase(),
    )
    const uspPercent = usp ?? existing?.uspPercent ?? 0
    const agentPercent = agent ?? existing?.agentPercent ?? 0
    if (existing) {
      existing.uspPercent = uspPercent
      existing.agentPercent = agentPercent
    } else {
      current.rates.push({ courseName: courseLevel, uspPercent, agentPercent })
    }
  }

  return [...byName.values()].filter((u) => u.rates.length > 0)
}

async function nextUniversityNo(): Promise<string> {
  const row = await prisma.university.findFirst({
    where: { tenantId, universityNo: { startsWith: 'UNI-' } },
    orderBy: { universityNo: 'desc' },
    select: { universityNo: true },
  })
  let next = 1
  if (row?.universityNo) {
    const n = parseInt(row.universityNo.slice(4), 10)
    if (!Number.isNaN(n)) next = n + 1
  }
  return `UNI-${String(next).padStart(3, '0')}`
}

async function ensureCountry(name: string, code: string) {
  const byCode = await prisma.country.findUnique({ where: { code } })
  if (byCode) return
  const byName = await prisma.country.findUnique({ where: { name } })
  if (byName) return
  await prisma.country.create({ data: { code, name } })
}

async function ensureTenantCountry(name: string, isoCode: string) {
  const existing = await prisma.tenantCountry.findFirst({
    where: {
      tenantId,
      name: { equals: name, mode: 'insensitive' },
      deletedAt: null,
    },
  })
  if (existing) {
    if (!existing.isActive || existing.isoCode !== isoCode) {
      await prisma.tenantCountry.update({
        where: { id: existing.id },
        data: { isActive: true, isoCode },
      })
    }
    return
  }
  await prisma.tenantCountry.create({
    data: {
      tenantId,
      name,
      isoCode,
      isActive: true,
    },
  })
}

async function ensureCurrencyGbp() {
  await prisma.currency.upsert({
    where: { code: 'GBP' },
    create: { code: 'GBP', name: 'British Pound', symbol: '£', isEnabled: true },
    update: { isEnabled: true },
  })
}

async function ensureCourse(name: string): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.course.findFirst({
    where: {
      tenantId,
      name: { equals: name, mode: 'insensitive' },
      deletedAt: null,
    },
  })
  if (existing) {
    if (!existing.isActive) {
      await prisma.course.update({
        where: { id: existing.id },
        data: { isActive: true },
      })
    }
    return { id: existing.id, created: false }
  }
  const created = await prisma.course.create({
    data: {
      tenantId,
      name,
      isActive: true,
    },
  })
  return { id: created.id, created: true }
}

async function upsertUniversity(draft: UniDraft, courseIds: Map<string, string>) {
  const existing = await prisma.university.findFirst({
    where: {
      tenantId,
      name: { equals: draft.name, mode: 'insensitive' },
      deletedAt: null,
    },
    include: { courseRates: true },
  })

  const defaultUsp =
    draft.rates.find((r) => /bachelor/i.test(r.courseName))?.uspPercent ??
    draft.rates[0]?.uspPercent ??
    0
  const defaultAgent =
    draft.rates.find((r) => /bachelor/i.test(r.courseName))?.agentPercent ??
    draft.rates[0]?.agentPercent ??
    0

  const countryCode = draft.countryName.toUpperCase() === 'UK' ? 'GB' : undefined

  const ratePayload = draft.rates
    .map((r) => {
      const courseId = courseIds.get(r.courseName.toLowerCase())
      if (!courseId) return null
      return {
        courseId,
        commissionRate: r.uspPercent,
        agentCommissionRate: r.agentPercent,
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.university.update({
        where: { id: existing.id },
        data: {
          name: draft.name,
          countryName: draft.countryName === 'UK' ? 'UK' : draft.countryName,
          countryCode: countryCode ?? existing.countryCode,
          address: draft.address ?? existing.address,
          defaultCommissionRate: defaultUsp,
          defaultAgentCommissionRate: defaultAgent,
          currencyCode: 'GBP',
          isActive: true,
        },
      })
      // Replace course rates with sheet rates (sheet is source of truth for these unis)
      await tx.universityCourseRate.deleteMany({
        where: { universityId: existing.id, tenantId },
      })
      if (ratePayload.length) {
        await tx.universityCourseRate.createMany({
          data: ratePayload.map((r) => ({
            tenantId,
            universityId: existing.id,
            courseId: r.courseId,
            commissionRate: r.commissionRate,
            agentCommissionRate: r.agentCommissionRate,
          })),
        })
      }
    })
    return { id: existing.id, created: false }
  }

  const universityNo = await nextUniversityNo()
  const created = await prisma.university.create({
    data: {
      tenantId,
      universityNo,
      name: draft.name,
      countryName: draft.countryName === 'UK' ? 'UK' : draft.countryName,
      countryCode: countryCode ?? null,
      address: draft.address,
      defaultCommissionRate: defaultUsp,
      defaultAgentCommissionRate: defaultAgent,
      currencyCode: 'GBP',
      isActive: true,
      courseRates: {
        create: ratePayload.map((r) => ({
          tenantId,
          courseId: r.courseId,
          commissionRate: r.commissionRate,
          agentCommissionRate: r.agentCommissionRate,
        })),
      },
    },
  })
  return { id: created.id, created: true }
}

function parseArgs(argv: string[]) {
  let tenantRef: string | undefined
  let filePath: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--tenant=')) {
      tenantRef = a.slice('--tenant='.length)
      continue
    }
    if (a === '--tenant' && argv[i + 1]) {
      tenantRef = argv[++i]
      continue
    }
    if (!a.startsWith('-')) {
      filePath = a
    }
  }
  return { tenantRef, filePath }
}

async function resolveTenantId(ref?: string): Promise<{ id: string; code: string; name: string }> {
  if (!ref) {
    const t = await prisma.tenant.findUniqueOrThrow({
      where: { id: FALLBACK_TENANT_ID },
      select: { id: true, code: true, name: true },
    })
    return t
  }
  const byCode = await prisma.tenant.findFirst({
    where: { code: { equals: ref, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, code: true, name: true },
  })
  if (byCode) return byCode
  const byId = await prisma.tenant.findFirst({
    where: { id: ref, deletedAt: null },
    select: { id: true, code: true, name: true },
  })
  if (byId) return byId
  throw new Error(`Tenant not found: ${ref}`)
}

async function main() {
  const { tenantRef, filePath } = parseArgs(process.argv.slice(2))
  const tenant = await resolveTenantId(tenantRef)
  tenantId = tenant.id
  console.log(`Tenant: ${tenant.name} (${tenant.code}) ${tenant.id}`)

  const xlsxPath = filePath ? path.resolve(filePath) : defaultXlsxPath()

  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel not found: ${xlsxPath}`)
  }

  const wb = XLSX.readFile(xlsxPath)
  const drafts: UniDraft[] = []
  for (const sheetName of SHEETS) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) {
      console.warn(`Sheet missing, skip: ${sheetName}`)
      continue
    }
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][]
    const parsed = parseSheet(rows)
    console.log(`Parsed ${sheetName}: ${parsed.length} institutions`)
    drafts.push(...parsed)
  }

  // Deduplicate same uni across sheets (prefer first = UK sheet)
  const unique = new Map<string, UniDraft>()
  for (const d of drafts) {
    const key = d.name.toLowerCase()
    if (!unique.has(key)) unique.set(key, d)
  }
  const unis = [...unique.values()]

  const courseNames = [
    ...new Set(unis.flatMap((u) => u.rates.map((r) => r.courseName))),
  ].sort((a, b) => a.localeCompare(b))

  await ensureCurrencyGbp()
  await ensureCountry('UK', 'GB')
  await ensureTenantCountry('UK', 'GB')

  console.log(`Courses to ensure: ${courseNames.length}`)
  const courseIds = new Map<string, string>()
  let coursesCreated = 0
  for (const name of courseNames) {
    const { id, created } = await ensureCourse(name)
    courseIds.set(name.toLowerCase(), id)
    if (created) {
      coursesCreated += 1
      console.log(`  + course: ${name}`)
    }
  }

  let unisCreated = 0
  let unisUpdated = 0
  for (const draft of unis) {
    const { created } = await upsertUniversity(draft, courseIds)
    if (created) {
      unisCreated += 1
      console.log(`  + university: ${draft.name} (${draft.rates.length} rates)`)
    } else {
      unisUpdated += 1
      console.log(`  ~ university: ${draft.name} (${draft.rates.length} rates)`)
    }
  }

  console.log('\nDone')
  console.log(
    JSON.stringify(
      {
        tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
        file: xlsxPath,
        institutions: unis.length,
        coursesCreated,
        coursesEnsured: courseNames.length,
        universitiesCreated: unisCreated,
        universitiesUpdated: unisUpdated,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
