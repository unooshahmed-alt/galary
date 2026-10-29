import { useState } from 'react';
import { Button, Spinner, Field, Textarea, Badge, cx } from './ui';
import { Modal } from './Modal';
import { FilePicker } from './FileUpload';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useToast } from './Toast';
import { fetchAll, useAsync, errorText, type Row } from '@/lib/db';
import { signedUrl, uploadDocument, type DocKind, type EntityType } from '@/lib/storage';
import { bytes, dateTime } from '@/lib/format';

/** Lists, previews, downloads and versions the documents attached to one record. */
export function DocumentList({ entityType, entityId, boatId, docKind = 'supporting', canUpload = true, title, onChange }: {
  entityType: EntityType; entityId: string; boatId?: string | null; docKind?: DocKind; canUpload?: boolean; title?: string; onChange?: () => void;
}) {
  const { t, lang } = useI18n();
  const { company, can } = useAuth();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [replacing, setReplacing] = useState<Row | null>(null);
  const [reason, setReason] = useState('');

  const docs = useAsync(() => fetchAll('v_documents', {
    filters: [['entity_type', 'eq', entityType], ['entity_id', 'eq', entityId]],
    sort: { column: 'created_at', ascending: false },
  }), [entityType, entityId]);

  const list = (docs.data ?? []).filter((d) => showAll || d.is_current);
  // Upload rights are also enforced by the documents/storage policies in the database.
  const mayUpload = canUpload && can('documents.view');

  const open = async (d: Row, download = false) => {
    try {
      const url = await signedUrl(d.storage_path, { download: download ? d.file_name : undefined });
      if (download) window.open(url, '_blank', 'noopener');
      else setPreview({ url, mime: d.mime_type, name: d.file_name });
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const upload = async () => {
    if (!files.length || !company) return;
    setBusy(true);
    try {
      for (const f of files) {
        await uploadDocument({ file: f, companyId: company.id, entityType, entityId, boatId, docKind,
          maxMb: Number(company.settings?.max_upload_mb ?? 10) });
      }
      setFiles([]); setAdding(false);
      toast.success(t('common.success'));
      await docs.reload(); onChange?.();
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === 'invalidFile' || m === 'fileTooLarge' ? t(`errors.${m}`) : errorText(e, t));
    } finally { setBusy(false); }
  };

  const replace = async () => {
    if (!replacing || !files[0] || !company || !reason.trim()) return;
    setBusy(true);
    try {
      await uploadDocument({ file: files[0], companyId: company.id, entityType, entityId, boatId, docKind: replacing.doc_kind,
        replacesId: replacing.id, replacedReason: reason.trim(), maxMb: Number(company.settings?.max_upload_mb ?? 10) });
      setFiles([]); setReplacing(null); setReason('');
      toast.success(t('common.success'));
      await docs.reload(); onChange?.();
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{title ?? t('common.documents')}</div>
        <div className="flex gap-2">
          {(docs.data ?? []).some((d) => !d.is_current) && (
            <Button size="sm" variant="ghost" icon="history" onClick={() => setShowAll(!showAll)}>{t('common.history')}</Button>
          )}
          {mayUpload && <Button size="sm" icon="upload" onClick={() => { setFiles([]); setAdding(true); }}>{t('common.upload')}</Button>}
        </div>
      </div>
      {docs.loading ? <Spinner /> : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">{t('bills.missingDoc')}</div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.map((d) => (
            <li key={d.id} className={cx('flex flex-wrap items-center gap-3 px-3 py-2 text-sm', !d.is_current && 'bg-slate-50 text-slate-500')}>
              <Icon name={d.mime_type?.startsWith('image/') ? 'camera' : 'file'} className="text-ocean-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.file_name}</div>
                <div className="text-xs text-slate-500">
                  v{d.version} · {bytes(d.size_bytes)} · {dateTime(d.created_at, lang)} · {d.uploaded_by_name ?? ''}
                  {d.replaced_reason && <> · {d.replaced_reason}</>}
                </div>
              </div>
              {!d.is_current && <Badge>{t('status.superseded')}</Badge>}
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon="eye" onClick={() => open(d)}>{t('common.preview')}</Button>
                <Button size="sm" variant="ghost" icon="download" onClick={() => open(d, true)} aria-label={t('common.download')} />
                {d.is_current && mayUpload && (
                  <Button size="sm" variant="ghost" icon="refresh" onClick={() => { setFiles([]); setReason(''); setReplacing(d); }}>{t('common.replace')}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title={t('common.upload')}
        footer={<><Button onClick={() => setAdding(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!files.length} onClick={upload}>{t('common.upload')}</Button></>}>
        <FilePicker files={files} onChange={setFiles} />
      </Modal>

      <Modal open={!!replacing} onClose={() => setReplacing(null)} title={t('bills.replaceDocument')}
        footer={<><Button onClick={() => setReplacing(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!files.length || !reason.trim()} onClick={replace}>{t('common.replace')}</Button></>}>
        <div className="space-y-3">
          <div className="text-sm text-slate-600">{replacing?.file_name} (v{replacing?.version})</div>
          <FilePicker files={files} onChange={setFiles} multiple={false} />
          <Field label={t('bills.replaceReason')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? ''} size="xl"
        footer={<Button icon="printer" onClick={() => { const w = window.open(preview!.url, '_blank', 'noopener'); w?.focus(); }}>{t('common.print')}</Button>}>
        {preview && (preview.mime.startsWith('image/')
          ? <img src={preview.url} alt={preview.name} className="mx-auto max-h-[70vh] rounded" />
          : preview.mime === 'application/pdf'
            ? <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full rounded border" />
            : <div className="text-center"><Button icon="download" onClick={() => window.open(preview.url, '_blank', 'noopener')}>{t('common.download')}</Button></div>)}
      </Modal>
    </div>
  );
}
