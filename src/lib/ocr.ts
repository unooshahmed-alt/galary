/**
 * Optional OCR assistance for bill photos (English-printed bills).
 * Results are suggestions only — the bill form requires a person to confirm
 * every value before the bill can be submitted (enforced in the database too).
 */
export interface OcrFields {
  supplier?: string;
  invoiceNo?: string;
  billDate?: string;
  dueDate?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
}

const AMOUNT = '([0-9]{1,3}(?:[,\\s][0-9]{3})*(?:\\.[0-9]{1,2})|[0-9]+(?:\\.[0-9]{1,2}))';

function amountAfter(raw: string, labels: string): number | undefined {
  const text = raw.replace(/\d{1,2}(?:\.\d+)?\s*%/g, ' ');   // ignore rates like "GST 8%"
  const re = new RegExp(`(?:${labels})[^0-9\\n]{0,24}${AMOUNT}`, 'gi');
  let last: number | undefined;
  for (const m of text.matchAll(re)) last = parseFloat(m[1].replace(/[,\s]/g, ''));
  return last;
}

function toIso(d: string, m: string, y: string): string | undefined {
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseBillText(text: string): OcrFields {
  const out: OcrFields = {};
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  out.supplier = lines.find((l) => /[A-Za-z]{3,}/.test(l) && !/invoice|bill|receipt|tax|date|tin|gst/i.test(l))?.slice(0, 80);
  const inv = text.match(/(?:invoice|inv|bill|receipt)\s*(?:no|number|#|num)?\.?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/]{2,24})/i);
  if (inv) out.invoiceNo = inv[1];
  const dates = [...text.matchAll(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/g)].map((m) => toIso(m[1], m[2], m[3])).filter(Boolean) as string[];
  const dueMatch = text.match(/due\s*(?:date)?[^0-9\n]{0,12}(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/i);
  if (dueMatch) out.dueDate = toIso(dueMatch[1], dueMatch[2], dueMatch[3]);
  out.billDate = dates.find((d) => d !== out.dueDate) ?? dates[0];
  out.subtotal = amountAfter(text, 'sub\\s*-?\\s*total|net\\s*amount|amount\\s*before\\s*tax');
  out.tax = amountAfter(text, 'gst|t-?gst|tax|vat');
  out.total = amountAfter(text, 'grand\\s*total|total\\s*amount|amount\\s*due|total\\s*payable|total');
  if (out.total && out.tax && !out.subtotal) out.subtotal = Math.round((out.total - out.tax) * 100) / 100;
  if (out.total && !out.tax && !out.subtotal) out.subtotal = out.total;
  return out;
}

export async function runOcr(file: File, onProgress?: (p: number) => void): Promise<{ text: string; fields: OcrFields }> {
  if (!file.type.startsWith('image/')) throw new Error('OCR works on photos and scanned images (JPG, PNG, WEBP).');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  try {
    const { data } = await worker.recognize(file);
    return { text: data.text, fields: parseBillText(data.text) };
  } finally {
    await worker.terminate();
  }
}
