/** Tenant-controlled invoice letterhead + email templates + bank block. */

export type InvoiceBranding = {
  logoPath: string | null;
  hasLogo: boolean;
  address: string;
  phone: string;
  email: string;
  website: string;
  footer: string;
  documentTitle: string;
  accentColor: string;
  emailSubject: string;
  emailBody: string;
  /** Legal / account title shown on PDF bank block */
  companyLegalName: string;
  bankName: string;
  bankBranch: string;
  bankCity: string;
  accountTitle: string;
  accountNo: string;
  swiftCode: string;
  iban: string;
};

export const INVOICE_BRANDING_KEYS = {
  logoPath: 'invoice_logo_path',
  address: 'invoice_address',
  phone: 'invoice_phone',
  email: 'invoice_email',
  website: 'invoice_website',
  footer: 'invoice_footer',
  documentTitle: 'invoice_document_title',
  accentColor: 'invoice_accent_color',
  emailSubject: 'invoice_email_subject',
  emailBody: 'invoice_email_body',
  companyLegalName: 'invoice_company_legal_name',
  bankName: 'invoice_bank_name',
  bankBranch: 'invoice_bank_branch',
  bankCity: 'invoice_bank_city',
  accountTitle: 'invoice_account_title',
  accountNo: 'invoice_account_no',
  swiftCode: 'invoice_swift_code',
  iban: 'invoice_iban',
} as const;

export const DEFAULT_INVOICE_BRANDING: Omit<
  InvoiceBranding,
  'logoPath' | 'hasLogo'
> = {
  address: '',
  phone: '',
  email: '',
  website: '',
  footer: 'Thank you for your business.',
  documentTitle: 'INVOICE',
  accentColor: '#0f766e',
  emailSubject: 'Commission Invoice {{invoiceNo}}',
  emailBody:
    'Dear Sir/Madam,\n\n' +
    'Please find commission invoice {{invoiceNo}} dated {{invoiceDate}}' +
    ' for {{students}}{{universities}}.\n\n' +
    'Total amount: {{amount}}.\n\n' +
    'Kind regards,\n{{orgName}}',
  companyLegalName: '',
  bankName: '',
  bankBranch: '',
  bankCity: '',
  accountTitle: '',
  accountNo: '',
  swiftCode: '',
  iban: '',
};

export type InvoiceTemplateVars = {
  invoiceNo: string;
  invoiceDate: string;
  amount: string;
  orgName: string;
  students: string;
  universities: string;
  documentTitle: string;
};

export function applyInvoiceTemplate(
  template: string,
  vars: InvoiceTemplateVars,
): string {
  return template
    .replaceAll('{{invoiceNo}}', vars.invoiceNo)
    .replaceAll('{{invoiceDate}}', vars.invoiceDate)
    .replaceAll('{{amount}}', vars.amount)
    .replaceAll('{{orgName}}', vars.orgName)
    .replaceAll('{{students}}', vars.students)
    .replaceAll(
      '{{universities}}',
      vars.universities && vars.universities !== '—'
        ? ` (${vars.universities})`
        : '',
    )
    .replaceAll('{{documentTitle}}', vars.documentTitle);
}

export type InvoiceHtmlLine = {
  studentName: string;
  studentCode?: string | null;
  course?: string | null;
  tuitionFee?: number;
  detail?: string | null;
  amount: number;
};

export type InvoiceBillTo = {
  name: string;
  lines: string[];
};

export function buildInvoiceHtml(input: {
  branding: InvoiceBranding;
  orgName: string;
  invoiceNo: string;
  invoiceDate: string;
  currency: string;
  status: string;
  lines: InvoiceHtmlLine[];
  total: number;
  paid?: number;
  logoDataUrl?: string | null;
  billTo?: InvoiceBillTo | null;
}): string {
  const accent = input.branding.accentColor || '#0f766e';
  const fmt = (n: number) =>
    `${input.currency} ${n.toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const paid = input.paid ?? 0;
  const outstanding = Math.max(0, input.total - paid);
  const companyLabel =
    input.branding.companyLegalName || input.orgName || "D' Educationist";
  const footerChips = [
    { label: 'Address', value: input.branding.address },
    { label: 'Phone', value: input.branding.phone },
    {
      label: 'Contact',
      value: [input.branding.email, input.branding.website]
        .filter(Boolean)
        .join(' · '),
    },
  ].filter((c) => Boolean(c.value && String(c.value).trim()));

  const lineRows = input.lines
    .map(
      (l, i) => `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;">${i + 1}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(l.studentName)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(l.course || '—')}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(fmt(l.tuitionFee ?? 0))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(fmt(l.amount))}</td>
      </tr>`,
    )
    .join('');

  const bankRows = [
    ['Name of Bank', input.branding.bankName],
    ['Branch', input.branding.bankBranch],
    ['City', input.branding.bankCity],
    [
      'Account Title',
      input.branding.accountTitle ||
        input.branding.companyLegalName ||
        input.orgName,
    ],
    ['Account No', input.branding.accountNo],
    ['Swift Code', input.branding.swiftCode],
    ['IBAN Code', input.branding.iban],
  ]
    .filter(([, v]) => Boolean(v))
    .map(
      ([k, v]) =>
        `<div style="margin-bottom:4px;"><span style="color:#6b7280;">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}</div>`,
    )
    .join('');

  const billToHtml = input.billTo
    ? `<div style="font-weight:700;margin-bottom:6px;">Bill To:</div>
       <div style="font-weight:600;">${escapeHtml(input.billTo.name)}</div>
       ${input.billTo.lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${escapeHtml(input.invoiceNo)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:3px solid ${escapeHtml(accent)};">
      <table width="100%"><tr>
        <td>
          ${
            input.logoDataUrl
              ? `<img src="${input.logoDataUrl}" alt="Logo" style="max-height:64px;max-width:180px;" />`
              : `<div style="font-size:22px;font-weight:700;color:${escapeHtml(accent)};">${escapeHtml((input.branding.documentTitle || 'INVOICE').toUpperCase())}</div>`
          }
          ${
            input.logoDataUrl
              ? `<div style="margin-top:8px;font-size:14px;font-weight:700;color:${escapeHtml(accent)};">${escapeHtml((input.branding.documentTitle || 'INVOICE').toUpperCase())}</div>`
              : ''
          }
        </td>
        <td style="text-align:right;font-size:13px;">
          <div><span style="color:#6b7280;">Invoice Number:</span> <strong>${escapeHtml(input.invoiceNo)}</strong></div>
          <div style="margin-top:4px;"><span style="color:#6b7280;">Invoice Date:</span> <strong>${escapeHtml(input.invoiceDate)}</strong></div>
          <div style="margin-top:4px;font-size:12px;color:#6b7280;">Status: ${escapeHtml(input.status)}</div>
        </td>
      </tr></table>
    </div>
    <div style="padding:20px 24px;">
      <table width="100%" style="font-size:13px;margin-bottom:18px;"><tr>
        <td style="width:50%;vertical-align:top;padding-right:12px;">${billToHtml}</td>
        <td style="width:50%;vertical-align:top;">
          <div style="font-weight:700;margin-bottom:6px;">Bank Details</div>
          ${bankRows || '<div style="color:#9ca3af;">Not configured in Settings → Invoice branding</div>'}
        </td>
      </tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:collapse;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:8px 6px;">S.No</th>
            <th style="text-align:left;padding:8px 6px;">Student Name</th>
            <th style="text-align:left;padding:8px 6px;">Course</th>
            <th style="text-align:right;padding:8px 6px;">Tuition Fee</th>
            <th style="text-align:right;padding:8px 6px;">Due Commission</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>
      <div style="margin-top:16px;text-align:right;font-size:14px;">
        <div>Total (${escapeHtml(input.currency)}): <strong>${escapeHtml(fmt(input.total))}</strong></div>
        <div style="color:#059669;margin-top:4px;">Paid: ${escapeHtml(fmt(paid))}</div>
        <div style="font-weight:700;margin-top:4px;">Outstanding: ${escapeHtml(fmt(outstanding))}</div>
      </div>
    </div>
    <div style="background:#f8fafc;border-top:2px solid ${escapeHtml(accent)};padding:14px 24px 16px;">
      <div style="font-size:12px;font-weight:700;color:${escapeHtml(accent)};margin-bottom:10px;">${escapeHtml(companyLabel)}</div>
      ${
        footerChips.length
          ? `<table width="100%" style="font-size:11px;"><tr>${footerChips
              .map(
                (c) => `<td style="width:33%;vertical-align:top;padding-right:10px;">
              <div style="font-size:9px;font-weight:700;letter-spacing:0.06em;color:#9ca3af;text-transform:uppercase;margin-bottom:3px;">${escapeHtml(c.label)}</div>
              <div style="color:#374151;line-height:1.35;">${escapeHtml(String(c.value))}</div>
            </td>`,
              )
              .join('')}</tr></table>`
          : ''
      }
      ${
        input.branding.footer
          ? `<p style="margin:12px 0 0;font-size:11px;color:#6b7280;font-style:italic;text-align:center;">${escapeHtml(input.branding.footer)}</p>`
          : ''
      }
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cover-letter HTML for email body (plain text with newlines → paragraphs). */
export function buildInvoiceEmailHtml(coverText: string): string {
  const paragraphs = coverText
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;line-height:1.5;color:#111827;font-size:14px;">${escapeHtml(
          p,
        ).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
    ${paragraphs || '<p style="margin:0;">Please see the attached invoice.</p>'}
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">Invoice PDF is attached to this email.</p>
  </div>
</body>
</html>`;
}
