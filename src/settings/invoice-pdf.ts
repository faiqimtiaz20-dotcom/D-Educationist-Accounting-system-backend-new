import PDFDocument from 'pdfkit';
import type {
  InvoiceBillTo,
  InvoiceBranding,
  InvoiceHtmlLine,
} from './invoice-branding';

export type InvoicePdfInput = {
  branding: InvoiceBranding;
  orgName: string;
  invoiceNo: string;
  invoiceDate: string;
  currency: string;
  status: string;
  lines: InvoiceHtmlLine[];
  total: number;
  paid?: number;
  logoBuffer?: Buffer | null;
  billTo?: InvoiceBillTo | null;
};

function money(currency: string, n: number) {
  return `${currency} ${n.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Sample-style A4 commission invoice (Bill To + Bank Details + line table). */
export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const paid = input.paid ?? 0;
  const outstanding = Math.max(0, input.total - paid);
  const accent = input.branding.accentColor || '#0f766e';
  const title = (input.branding.documentTitle || 'INVOICE').toUpperCase();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    let y = doc.page.margins.top;

    // Header row: title/logo | invoice meta
    const headerTop = y;
    if (input.logoBuffer?.length) {
      try {
        doc.image(input.logoBuffer, left, y, { fit: [130, 50] });
      } catch {
        /* ignore */
      }
      doc
        .fillColor(accent)
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(title, left, y + 52, { width: width * 0.45 });
    } else {
      doc
        .fillColor(accent)
        .font('Helvetica-Bold')
        .fontSize(22)
        .text(title, left, y, { width: width * 0.45 });
    }

    doc
      .fillColor('#111827')
      .font('Helvetica')
      .fontSize(10)
      .text(`Invoice Number: ${input.invoiceNo}`, left + width * 0.5, headerTop, {
        width: width * 0.5,
        align: 'right',
      });
    doc.text(
      `Invoice Date: ${input.invoiceDate}`,
      left + width * 0.5,
      headerTop + 14,
      { width: width * 0.5, align: 'right' },
    );
    doc
      .fillColor('#6b7280')
      .fontSize(9)
      .text(`Status: ${input.status}`, left + width * 0.5, headerTop + 28, {
        width: width * 0.5,
        align: 'right',
      });

    y = Math.max(doc.y, headerTop + 70) + 8;

    const contact = [
      input.branding.companyLegalName || input.orgName,
      input.branding.address,
      input.branding.phone,
      input.branding.email,
      input.branding.website,
    ]
      .filter(Boolean)
      .join(' · ');
    if (contact) {
      doc
        .fillColor('#6b7280')
        .font('Helvetica')
        .fontSize(8)
        .text(contact, left, y, { width });
      y = doc.y + 10;
    }

    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .lineWidth(1.5)
      .strokeColor(accent)
      .stroke();
    y += 14;

    // Bill To | Bank Details
    const colW = width / 2 - 8;
    const blockTop = y;

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text('Bill To:', left, y);
    y = doc.y + 4;
    if (input.billTo) {
      doc.font('Helvetica-Bold').fontSize(10).text(input.billTo.name, left, y, {
        width: colW,
      });
      y = doc.y + 2;
      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      for (const line of input.billTo.lines) {
        doc.text(line, left, y, { width: colW });
        y = doc.y + 1;
      }
    } else {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#9ca3af')
        .text('—', left, y, { width: colW });
      y = doc.y;
    }
    const leftBottom = y;

    let by = blockTop;
    const bankX = left + width / 2 + 8;
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Bank Details', bankX, by, { width: colW });
    by = doc.y + 4;

    const accountTitle =
      input.branding.accountTitle ||
      input.branding.companyLegalName ||
      input.orgName;
    const bankRows: Array<[string, string]> = [
      ['Name of Bank', input.branding.bankName],
      ['Branch', input.branding.bankBranch],
      ['City', input.branding.bankCity],
      ['Account Title', accountTitle],
      ['Account No', input.branding.accountNo],
      ['Swift Code', input.branding.swiftCode],
      ['IBAN Code', input.branding.iban],
    ].filter(([, v]) => Boolean(v && String(v).trim())) as Array<[string, string]>;

    if (!bankRows.length) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#9ca3af')
        .text('Configure in Settings → Invoice branding', bankX, by, {
          width: colW,
        });
      by = doc.y;
    } else {
      for (const [label, value] of bankRows) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#6b7280')
          .text(`${label}: `, bankX, by, { continued: true, width: colW });
        doc.fillColor('#111827').text(value, { width: colW });
        by = doc.y + 2;
      }
    }

    y = Math.max(leftBottom, by) + 16;

    // Table
    const cols = [
      { key: 'no', label: 'S.No', w: 28, align: 'left' as const },
      { key: 'name', label: 'Student Name', w: width * 0.28, align: 'left' as const },
      { key: 'course', label: 'Course', w: width * 0.24, align: 'left' as const },
      { key: 'tuition', label: 'Tuition Fee', w: width * 0.2, align: 'right' as const },
      {
        key: 'comm',
        label: 'Due Commission',
        w: width * 0.2,
        align: 'right' as const,
      },
    ];
    // normalize widths to content width
    const sumW = cols.reduce((s, c) => s + c.w, 0);
    cols.forEach((c) => {
      c.w = (c.w / sumW) * width;
    });

    const drawHeader = () => {
      doc.rect(left, y, width, 20).fill('#f3f4f6');
      let x = left;
      doc.fillColor('#374151').font('Helvetica-Bold').fontSize(8);
      for (const c of cols) {
        doc.text(c.label, x + 3, y + 6, { width: c.w - 6, align: c.align });
        x += c.w;
      }
      y += 22;
    };

    drawHeader();
    doc.font('Helvetica').fontSize(8).fillColor('#111827');

    input.lines.forEach((line, idx) => {
      const cells = [
        String(idx + 1),
        line.studentName,
        line.course || '—',
        money(input.currency, line.tuitionFee ?? 0),
        money(input.currency, line.amount),
      ];
      const rowH = Math.max(
        18,
        ...cells.map((t, i) =>
          doc.heightOfString(t, { width: cols[i].w - 6 }),
        ),
      );
      if (y + rowH > doc.page.height - 100) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
        doc.font('Helvetica').fontSize(8).fillColor('#111827');
      }
      let x = left;
      cells.forEach((t, i) => {
        doc.text(t, x + 3, y, {
          width: cols[i].w - 6,
          align: cols[i].align,
        });
        x += cols[i].w;
      });
      y += rowH + 4;
      doc
        .moveTo(left, y - 2)
        .lineTo(right, y - 2)
        .lineWidth(0.4)
        .strokeColor('#e5e7eb')
        .stroke();
    });

    y += 10;
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .lineWidth(1)
      .strokeColor('#d1d5db')
      .stroke();
    y += 12;

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(`Total (${input.currency}): ${money(input.currency, input.total)}`, left, y, {
        width,
        align: 'right',
      });
    y = doc.y + 4;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#059669')
      .text(`Paid: ${money(input.currency, paid)}`, left, y, {
        width,
        align: 'right',
      });
    y = doc.y + 4;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(`Outstanding: ${money(input.currency, outstanding)}`, left, y, {
        width,
        align: 'right',
      });

    if (input.branding.footer) {
      y = doc.y + 18;
      doc
        .fillColor('#6b7280')
        .font('Helvetica')
        .fontSize(9)
        .text(input.branding.footer, left, y, { width });
    }

    doc.end();
  });
}
