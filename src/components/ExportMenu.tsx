import { useState } from 'react';
import { Button, Select } from './ui';
import { useI18n, type ExportLang } from '@/lib/i18n';
import { useToast } from './Toast';
import { exportExcel, exportPdf, printHtml, buildTableHtml, type ExportSpec } from '@/lib/exporters';
import { errorText } from '@/lib/db';

/** Excel / PDF / Print buttons with an export-language choice (English, Dhivehi or bilingual). */
export function ExportMenu({ build, disabled }: { build: (lang: ExportLang) => Promise<ExportSpec> | ExportSpec; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [xlang, setXlang] = useState<ExportLang>(lang);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (kind: 'xlsx' | 'pdf' | 'print') => {
    setBusy(kind);
    try {
      const spec = await build(xlang);
      if (kind === 'xlsx') await exportExcel(spec);
      else if (kind === 'pdf') await exportPdf(spec);
      else printHtml(buildTableHtml(spec), spec.title);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={xlang} onChange={(e) => setXlang(e.target.value as ExportLang)} className="!w-auto !py-1.5 text-xs" aria-label={t('reports.exportLang')}>
        <option value="en">English</option>
        <option value="dv">ދިވެހި</option>
        <option value="bi">{t('common.bilingual')}</option>
      </Select>
      <Button size="sm" icon="download" disabled={disabled} loading={busy === 'xlsx'} onClick={() => run('xlsx')}>{t('common.exportExcel')}</Button>
      <Button size="sm" icon="file" disabled={disabled} loading={busy === 'pdf'} onClick={() => run('pdf')}>{t('common.exportPdf')}</Button>
      <Button size="sm" icon="printer" disabled={disabled} loading={busy === 'print'} onClick={() => run('print')} aria-label={t('common.print')} />
    </div>
  );
}
