/**
 * Pakistan salary tax — parity with frontend `src/lib/payroll.ts` + `salaryTax()`.
 *
 * Formula (documented for M10):
 * 1. gross = basic + allowances
 * 2. taxable monthly = gross × (1 − 10% exempt)
 * 3. annual taxable = taxable monthly × 12
 * 4. annual tax from simple progressive-ish flat brackets (frontend helper):
 *      ≤ 600,000     → 2.5%
 *      ≤ 1,200,000    → 7.5%
 *      else           → 12.5%
 * 5. monthly tax = round(annual tax / 12)
 * 6. net = round(gross − monthly tax)
 *
 * These brackets are also seeded into `salary_tax_slabs` for reference.
 * They intentionally match the existing FE helper (not full FBR graduated slabs).
 */
export const TAX_EXEMPT_RATE = 0.1;

export function annualSalaryTax(annualTaxable: number): number {
  if (annualTaxable <= 600_000) return annualTaxable * 0.025;
  if (annualTaxable <= 1_200_000) return annualTaxable * 0.075;
  return annualTaxable * 0.125;
}

export function computeSalary(basicSalary: number, allowances: number) {
  const gross = Math.round((basicSalary + allowances) * 100) / 100;
  const taxableMonthly = gross * (1 - TAX_EXEMPT_RATE);
  const annualTax = annualSalaryTax(taxableMonthly * 12);
  const monthlyTax = Math.round(annualTax / 12);
  const netSalary = Math.round(gross - monthlyTax);
  return { gross, salaryTax: monthlyTax, netSalary };
}
