import { useEffect, useRef, useState } from 'react';
import { Button, cx } from './ui';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { ACCEPT_ATTR, DEFAULT_MAX_MB, validateFile } from '@/lib/storage';
import { bytes } from '@/lib/format';

/**
 * File picker with a camera button for phones (capture="environment" opens the rear camera).
 * Validates type and size before anything is uploaded.
 */
export function FilePicker({ files, onChange, multiple = true, label, compact }: {
  files: File[]; onChange: (f: File[]) => void; multiple?: boolean; label?: string; compact?: boolean;
}) {
  const { t } = useI18n();
  const { company } = useAuth();
  const maxMb = Number(company?.settings?.max_upload_mb ?? DEFAULT_MAX_MB);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok: File[] = [];
    const errs: string[] = [];
    for (const f of Array.from(list)) {
      const problem = validateFile(f, maxMb);
      if (problem) errs.push(`${f.name}: ${t(`errors.${problem}`)}`);
      else ok.push(f);
    }
    setErrors(errs);
    onChange(multiple ? [...files, ...ok] : ok.slice(0, 1));
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={cx('rounded-xl border-2 border-dashed px-4 text-center transition', compact ? 'py-3' : 'py-6',
          drag ? 'border-ocean-500 bg-ocean-50' : 'border-slate-300 bg-slate-50')}>
        {!compact && <Icon name="upload" size={26} className="mx-auto mb-2 text-ocean-600" />}
        {label && !compact && <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>}
        <div className="flex flex-wrap justify-center gap-2">
          <Button icon="camera" size={compact ? 'sm' : 'md'} onClick={() => camRef.current?.click()} className="sm:hidden">{t('bills.takePhoto')}</Button>
          <Button icon="file" size={compact ? 'sm' : 'md'} onClick={() => fileRef.current?.click()}>{t('bills.chooseFile')}</Button>
        </div>
        <div className="mt-2 text-xs text-slate-500">{t('bills.fileTypes', { mb: maxMb })}</div>
        <input ref={fileRef} type="file" accept={ACCEPT_ATTR} multiple={multiple} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {errors.map((e) => <div key={e} className="mt-1 text-xs text-coral-600">{e}</div>)}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => <SelectedFile key={`${f.name}-${i}`} file={f} onRemove={() => onChange(files.filter((_, j) => j !== i))} />)}
        </ul>
      )}
    </div>
  );
}

function SelectedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 text-sm">
      {url ? <img src={url} alt="" className="h-10 w-10 rounded object-cover" /> : <Icon name="file" className="text-slate-500" />}
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="text-xs text-slate-500">{bytes(file.size)}</span>
      <button onClick={onRemove} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-coral-600" aria-label="Remove"><Icon name="x" size={16} /></button>
    </li>
  );
}
