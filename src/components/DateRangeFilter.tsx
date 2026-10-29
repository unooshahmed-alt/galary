import { useI18n } from '@/lib/i18n';
import { rangeFor, type RangePreset } from '@/lib/format';
import { Input, cx } from './ui';

export interface DateRange { preset: RangePreset; from: string; to: string }

export const defaultRange = (preset: RangePreset = 'month'): DateRange => ({ preset, ...rangeFor(preset) });

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const { t } = useI18n();
  const presets: { id: RangePreset; label: string }[] = [
    { id: 'today', label: t('common.today') }, { id: 'week', label: t('common.thisWeek') },
    { id: 'month', label: t('common.thisMonth') }, { id: 'year', label: t('common.thisYear') },
    { id: 'custom', label: t('common.custom') },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-lg border border-slate-300 bg-white p-0.5">
        {presets.map((p) => (
          <button key={p.id} onClick={() => onChange(p.id === 'custom' ? { ...value, preset: 'custom' } : { preset: p.id, ...rangeFor(p.id) })}
            className={cx('rounded-md px-2.5 py-1 text-xs font-medium', value.preset === p.id ? 'bg-ocean-700 text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="!w-auto !py-1.5 text-xs" aria-label={t('common.from')} />
          <span className="text-slate-400">–</span>
          <Input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className="!w-auto !py-1.5 text-xs" aria-label={t('common.to')} />
        </div>
      )}
    </div>
  );
}
