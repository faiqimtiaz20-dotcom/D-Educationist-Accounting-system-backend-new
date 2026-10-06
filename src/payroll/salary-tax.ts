/**
 * Pakistan salary tax — parity with frontend `src/lib/calculations.ts` + `src/lib/payroll.ts`.
 *
 * FBR salaried individual slabs — Tax Year 2026-27 (Finance Act 2026):
 *   0 – 600,000              → Nil
 *   600,001 – 1,200,000      → 1% of amount exceeding 600,000
 *   1,200,001 – 2,200,000    → 6,000 + 11% of amount exceeding 1,200,000
 *   2,200,001 – 3,200,000    → 116,000 + 20% of amount exceeding 2,200,000
 *   3,200,001 – 4,100,000    → 316,000 + 25% of amount exceeding 3,200,000
 *   4,100,001 – 5,600,000    → 541,000 + 29% of amount exceeding 4,100,000
 *   5,600,001 – 7,000,000    → 976,000 + 32% of amount exceeding 5,600,000
 *   Above 7,000,000          → 1,424,000 + 35% of amount exceeding 7,000,000
 *
 * Monthly tax = round(annual tax / 12). Taxable base = full annual gross (basic + allowances) × 12.
 */
export function annualSalaryTax(annualTaxable: number): number {
  const income = Math.max(0, annualTaxable);
  if (income <= 600_000) return 0;
  if (income <= 1_200_000) return Math.round((income - 600_000) * 0.01);
  if (income <= 2_200_000) return Math.round(6_000 + (income - 1_200_000) * 0.11);
  if (income <= 3_200_000) return Math.round(116_000 + (income - 2_200_000) * 0.2);
  if (income <= 4_100_000) return Math.round(316_000 + (income - 3_200_000) * 0.25);
  if (income <= 5_600_000) return Math.round(541_000 + (income - 4_100_000) * 0.29);
  if (income <= 7_000_000) return Math.round(976_000 + (income - 5_600_000) * 0.32);
  return Math.round(1_424_000 + (income - 7_000_000) * 0.35);
}

export function computeSalary(basicSalary: number, allowances: number) {
  const gross = Math.round((basicSalary + allowances) * 100) / 100;
  const annualTax = annualSalaryTax(gross * 12);
  const monthlyTax = Math.round(annualTax / 12);
  const netSalary = Math.round(gross - monthlyTax);
  return { gross, salaryTax: monthlyTax, netSalary };
}
