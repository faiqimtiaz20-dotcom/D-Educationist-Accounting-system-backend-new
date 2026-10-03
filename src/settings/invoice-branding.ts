/** Tenant-controlled invoice letterhead + email templates. */

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
  documentTitle: 'Commission Invoice',
  accentColor: '#0f766e',
  emailSubject: 'Commission Invoice {{invoiceNo}}',
  emailBody:
    'Dear Sir/Madam,\n\n' +
    'Please find commission invoice {{invoiceNo}} dated {{invoiceDate}}' +
    ' for {{students}}{{universities}}.\n\n' +
    'Total amount: {{amount}}.\n\n' +
    'Kind regards,\n{{orgName}}',
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
  detail?: string | null;
  amount: number;
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
  /** data:image/...;base64,... or empty */
  logoDataUrl?: string | null;
}): string {
  const accent = input.branding.accentColor || '#0f766e';
  const fmt = (n: number) =>
    `${input.currency} ${n.toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const paid = input.paid ?? 0;
  const outstanding = Math.max(0, input.total - paid);
  const contactBits = [
    input.branding.address,
    input.branding.phone,
    input.branding.email,
    input.branding.website,
  ].filter(Boolean);

  const lineRows = input.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">
          <div style="font-weight:600;">${escapeHtml(l.studentName)}</div>
          ${
            l.detail
              ? `<div style="color:#6b7280;font-size:12px;">${escapeHtml(l.detail)}</div>`
              : ''
          }
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;">
          ${escapeHtml(fmt(l.amount))}
        </td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${escapeHtml(input.invoiceNo)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:3px solid ${escapeHtml(accent)};">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;">
          ${
            input.logoDataUrl
              ? `<img src="${input.logoDataUrl}" alt="Logo" style="max-height:64px;max-width:180px;object-fit:contain;" />`
              : ''
          }
        </td>
        <td style="text-align:right;vertical-align:middle;">
          <div style="font-size:18px;font-weight:700;">${escapeHtml(input.orgName)}</div>
          <div style="color:${escapeHtml(accent)};font-weight:600;margin-top:4px;">${escapeHtml(input.branding.documentTitle)}</div>
        </td>
      </tr></table>
      ${
        contactBits.length
          ? `<div style="margin-top:12px;font-size:12px;color:#6b7280;line-height:1.5;">${contactBits
              .map(escapeHtml)
              .join(' · ')}</div>`
          : ''
      }
    </div>
    <div style="padding:20px 24px;">
      <table width="100%" style="font-size:13px;margin-bottom:16px;">
        <tr>
          <td><span style="color:#6b7280;">Invoice No.</span><br/><strong>${escapeHtml(input.invoiceNo)}</strong></td>
          <td><span style="color:#6b7280;">Date</span><br/><strong>${escapeHtml(input.invoiceDate)}</strong></td>
          <td><span style="color:#6b7280;">Status</span><br/><strong>${escapeHtml(input.status)}</strong></td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:8px 10px;">Student / Description</th>
            <th style="text-align:right;padding:8px 10px;">Amount</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:13px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span>Total</span><strong>${escapeHtml(fmt(input.total))}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#059669;">
          <span>Paid</span><span>${escapeHtml(fmt(paid))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;">
          <span>Outstanding</span><span>${escapeHtml(fmt(outstanding))}</span>
        </div>
      </div>
      ${
        input.branding.footer
          ? `<p style="margin-top:20px;font-size:12px;color:#6b7280;">${escapeHtml(input.branding.footer)}</p>`
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
