import { supabase, DOCUMENTS_BUCKET } from './supabase';
import { unwrap, type Row } from './db';
import { uuid } from './format';

export const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.xlsx,.xls,.csv,application/pdf,image/*';
export const DEFAULT_MAX_MB = 10;

export type EntityType =
  | 'bill' | 'bill_payment' | 'transaction' | 'fish_sale' | 'customer_receipt' | 'trip' | 'boat' | 'crew'
  | 'cash_advance' | 'fish_taken' | 'adjustment' | 'crew_payment' | 'wage_slip' | 'other';
export type DocKind = 'bill' | 'invoice' | 'receipt' | 'payment_receipt' | 'photo' | 'id_document' | 'spreadsheet' | 'supporting' | 'other';

/** Resolve a trustworthy MIME type from the extension (browsers often report HEIC/CSV inconsistently). */
export function mimeFor(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const byExt = ALLOWED_TYPES[ext];
  if (!byExt) return null;
  // reject obvious mismatches (e.g. an .exe renamed to .pdf reports application/x-msdownload)
  if (file.type && !Object.values(ALLOWED_TYPES).includes(file.type) && !file.type.startsWith('image/') && file.type !== 'application/octet-stream') {
    return null;
  }
  return byExt;
}

export function validateFile(file: File, maxMb = DEFAULT_MAX_MB): 'invalidFile' | 'fileTooLarge' | null {
  if (!mimeFor(file)) return 'invalidFile';
  if (file.size <= 0 || file.size > maxMb * 1024 * 1024) return 'fileTooLarge';
  return null;
}

/** Check the first bytes of the file match its claimed type (PDF / JPEG / PNG / WEBP). */
export async function sniffMatches(file: File, mime: string): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const hex = Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (mime === 'application/pdf') return hex.startsWith('25504446');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/png') return hex.startsWith('89504e47');
  if (mime === 'image/webp') return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
  if (mime.includes('spreadsheetml')) return hex.startsWith('504b0304');
  return true; // heic / csv / xls: no reliable cheap signature
}

function safeName(name: string): string {
  const base = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return base.slice(-80) || 'file';
}

export interface UploadArgs {
  file: File;
  companyId: string;
  entityType: EntityType;
  entityId?: string | null;
  boatId?: string | null;
  docKind?: DocKind;
  description?: string;
  replacesId?: string;
  replacedReason?: string;
  maxMb?: number;
}

/** Uploads to the private bucket and registers the document row (with version history). */
export async function uploadDocument(a: UploadArgs): Promise<Row> {
  const problem = validateFile(a.file, a.maxMb);
  if (problem) throw new Error(problem);
  const mime = mimeFor(a.file)!;
  if (!(await sniffMatches(a.file, mime))) throw new Error('invalidFile');
  const path = `${a.companyId}/${a.entityType}/${uuid()}-${safeName(a.file.name)}`;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, a.file, { contentType: mime, upsert: false });
  if (error) throw error;
  const res = await supabase.from('documents').insert({
    entity_type: a.entityType,
    entity_id: a.entityId ?? null,
    boat_id: a.boatId ?? null,
    doc_kind: a.docKind ?? 'supporting',
    storage_path: path,
    file_name: a.file.name.slice(0, 200),
    mime_type: mime,
    size_bytes: a.file.size,
    description: a.description ?? null,
    replaces_id: a.replacesId ?? null,
    replaced_reason: a.replacedReason ?? null,
  }).select().single();
  return unwrap<Row>(res);
}

/** Link a document uploaded before its record existed (e.g. a new bill). */
export async function linkDocument(documentId: string, entityId: string, boatId?: string | null) {
  const res = await supabase.from('documents').update({ entity_id: entityId, boat_id: boatId ?? null }).eq('id', documentId).select().single();
  return unwrap<Row>(res);
}

/** Short-lived signed URL; access is checked by storage policies on every request. */
export async function signedUrl(path: string, opts: { seconds?: number; download?: string | boolean } = {}): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, opts.seconds ?? 300, { download: opts.download });
  if (error || !data) throw error ?? new Error('notFound');
  return data.signedUrl;
}
