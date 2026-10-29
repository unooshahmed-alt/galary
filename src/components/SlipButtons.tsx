import { useState } from 'react';
import { Button, Select } from './ui';
import { useToast } from './Toast';
import { useI18n, type ExportLang } from '@/lib/i18n';
import { fetchAll, errorText, type Row } from '@/lib/db';
import { downloadSlips, printSlips } from '@/print/wageSlip';

/** Download / print one or many wage slips as a single PDF, in English, Dhivehi or bilingual. */
export function SlipButtons({ slips, slipIds, fileName, label }: { slips?: Row[]; slipIds?: string[]; fileName: string; label?: string }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [mode, setMode] = useState<ExportLang>(lang);
  const [busy, setBusy] = useState(false);
  const resolve = async (): Promise<Row[]> => {
    if (slips) return slips;
    if (!slipIds?.length) return [];
    return fetchAll('v_wage_slips', { filters: [['id', 'in', slipIds]], sort: { column: 'crew_code', ascending: true } });
  };
  const go = async (kind: 'pdf' | 'print') => {
    setBusy(true);
    try {
      const list = await resolve();
      if (!list.length) return;
      if (kind === 'pdf') await downloadSlips(list, mode, fileName);
      else printSlips(list, mode);
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Select value={mode} onChange={(e) => setMode(e.target.value as ExportLang)} className="!w-auto !py-1 text-xs" aria-label={t('reports.exportLang')}>
        <option value="en">EN</option><option value="dv">ދިވެހި</option><option value="bi">EN + ދިވެހި</option>
      </Select>
      <Button size="sm" icon="download" loading={busy} onClick={() => go('pdf')}>{label ?? t('common.exportPdf')}</Button>
      <Button size="sm" icon="printer" onClick={() => go('print')} aria-label={t('common.print')} />
    </div>
  );
}
