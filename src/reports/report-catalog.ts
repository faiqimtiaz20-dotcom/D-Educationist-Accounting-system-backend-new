export type ReportCategory =
  | 'Branch'
  | 'Consolidated'
  | 'Operations'
  | 'Standard'
  | 'Tax'
  | 'Commission';

export type ReportDef = {
  slug: string
  title: string
  category: ReportCategory
  description: string
  /** Counsellor role may only open these. */
  counsellorAllowed?: boolean
};

export const REPORT_CATALOG: ReportDef[] = [
  {
    slug: 'branch-income',
    title: 'Branch Income',
    category: 'Branch',
    description: 'Income by branch for selected period',
  },
  {
    slug: 'branch-expenses',
    title: 'Branch Expenses',
    category: 'Branch',
    description: 'Expenses by branch',
  },
  {
    slug: 'branch-profit',
    title: 'Branch Profit',
    category: 'Branch',
    description: 'Profit analysis by branch',
  },
  {
    slug: 'branch-cash',
    title: 'Branch Cash Position',
    category: 'Branch',
    description: 'Cash and bank balances by branch',
  },
  {
    slug: 'university-wise-pl',
    title: 'University-wise P&L',
    category: 'Consolidated',
    description: 'Profit and loss by university — income minus sub-agent cost',
  },
  {
    slug: 'consolidated-pl',
    title: 'Consolidated P&L',
    category: 'Consolidated',
    description: 'All-branch profit and loss',
  },
  {
    slug: 'consolidated-bs',
    title: 'Consolidated Balance Sheet',
    category: 'Consolidated',
    description: 'Overall balance sheet',
  },
  {
    slug: 'consolidated-cf',
    title: 'Consolidated Cash Flow',
    category: 'Consolidated',
    description: 'Cash flow statement',
  },
  {
    slug: 'trial-balance',
    title: 'Trial Balance',
    category: 'Standard',
    description: 'Trial balance report',
  },
  {
    slug: 'cash-book',
    title: 'Cash Book',
    category: 'Standard',
    description: 'Cash transactions register',
  },
  {
    slug: 'bank-book',
    title: 'Bank Book',
    category: 'Standard',
    description: 'Bank transactions register',
  },
  {
    slug: 'journal-register',
    title: 'Journal Register',
    category: 'Standard',
    description: 'All journal entries',
  },
  {
    slug: 'expense-report',
    title: 'Expense Report',
    category: 'Standard',
    description: 'Detailed expense listing',
  },
  {
    slug: 'income-report',
    title: 'Income Report',
    category: 'Standard',
    description: 'Income breakdown',
  },
  {
    slug: 'receivable-ageing',
    title: 'Receivable Ageing',
    category: 'Standard',
    description: 'Outstanding receivables by age',
  },
  {
    slug: 'payable-ageing',
    title: 'Payable Ageing',
    category: 'Standard',
    description: 'Outstanding payables by age',
  },
  {
    slug: 'petty-cash',
    title: 'Petty Cash Report',
    category: 'Standard',
    description: 'Petty cash transactions',
  },
  {
    slug: 'wht-summary',
    title: 'WHT Summary',
    category: 'Tax',
    description: 'Withholding tax deducted/withheld',
  },
  {
    slug: 'gst-summary',
    title: 'GST/SRB Summary',
    category: 'Tax',
    description: 'Input-output tax summary',
  },
  {
    slug: 'salary-tax',
    title: 'Salary Tax Summary',
    category: 'Tax',
    description: 'Salary tax deduction summary',
  },
  {
    slug: 'commission-tracking',
    title: 'Commission Earned vs Received',
    category: 'Commission',
    description: 'Commission tracking by university',
  },
  {
    slug: 'subagent-payout',
    title: 'Sub-Agent Payout Summary',
    category: 'Commission',
    description: 'Sub-agent payment analysis',
  },
  {
    slug: 'net-margin',
    title: 'Net Margin per Student',
    category: 'Commission',
    description: 'Commission minus sub-agent share',
  },
  {
    slug: 'counsellor',
    title: 'Counsellor Report Profit and Loss',
    category: 'Operations',
    description: 'Profit and loss by counsellor',
    counsellorAllowed: true,
  },
  {
    slug: 'country-wise',
    title: 'Country-wise Report',
    category: 'Operations',
    description: 'Student pipeline by destination country',
    counsellorAllowed: true,
  },
  {
    slug: 'university-wise',
    title: 'University-wise Report',
    category: 'Operations',
    description: 'Student pipeline by university',
    counsellorAllowed: true,
  },
];

export function findReportDef(slug: string): ReportDef | undefined {
  return REPORT_CATALOG.find((r) => r.slug === slug);
}
