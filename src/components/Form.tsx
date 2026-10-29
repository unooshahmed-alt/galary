import type { ReactNode } from 'react';
import { Field, Input, Select, Textarea, Checkbox, cx } from './ui';
import { RefSelect, type OptionKind } from './RefSelect';
import { useI18n, type TFn } from '@/lib/i18n';
import type { Row } from '@/lib/db';

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'ref' | 'checkbox' | 'email' | 'tel' | 'percent';

export interface FieldDef {
  name: string;
  label: string;              // i18n key
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[]; // label = i18n key
  ref?: OptionKind;
  refParams?: (values: Row) => Record<string, unknown>;
  default?: unknown | (() => unknown);
  hint?: string;
  wide?: boolean;
  showIf?: (values: Row, isEdit?: boolean) => boolean;
  readOnlyOnEdit?: boolean;
  readOnly?: (values: Row, isEdit: boolean) => boolean;
  rtl?: boolean;
  min?: number;
  max?: number;
  /** derive other values when this changes (e.g. trip → boat) */
  onSet?: (value: unknown, values: Row, refRow?: Row) => Row;
  render?: (values: Row, set: (patch: Row) => void) => ReactNode;
}

export function initialValues(fields: FieldDef[], row?: Row | null): Row {
  const v: Row = {};
  for (const f of fields) {
    if (row && row[f.name] !== undefined) v[f.name] = row[f.name];
    else v[f.name] = typeof f.default === 'function' ? (f.default as () => unknown)() : f.default ?? (f.type === 'checkbox' ? false : '');
  }
  return v;
}

export function validate(fields: FieldDef[], values: Row, t: TFn): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    if (f.showIf && !f.showIf(values)) continue;
    const v = values[f.name];
    const empty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    if (f.required && empty && f.type !== 'checkbox') errs[f.name] = t('errors.required');
    if (!empty && (f.type === 'number' || f.type === 'money' || f.type === 'percent')) {
      const n = Number(v);
      if (!Number.isFinite(n)) errs[f.name] = t('common.invalid');
      else if (f.min !== undefined && n < f.min) errs[f.name] = `≥ ${f.min}`;
      else if (f.max !== undefined && n > f.max) errs[f.name] = `≤ ${f.max}`;
    }
    if (!empty && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) errs[f.name] = t('common.invalid');
  }
  return errs;
}

/** Convert form strings to typed values for the database. */
export function coerce(fields: FieldDef[], values: Row): Row {
  const out: Row = {};
  for (const f of fields) {
    if (f.type === 'checkbox') { out[f.name] = !!values[f.name]; continue; }
    if (f.showIf && !f.showIf(values)) { out[f.name] = null; continue; }
    const v = values[f.name];
    if (v === '' || v === undefined) { out[f.name] = null; continue; }
    if (f.type === 'number' || f.type === 'money' || f.type === 'percent') out[f.name] = Number(v);
    else out[f.name] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

export function FormFields({ fields, values, onChange, errors = {}, isEdit = false }: {
  fields: FieldDef[]; values: Row; onChange: (v: Row) => void; errors?: Record<string, string>; isEdit?: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Row) => onChange({ ...values, ...patch });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        if (f.showIf && !f.showIf(values, isEdit)) return null;
        const ro = (f.readOnlyOnEdit && isEdit) || f.readOnly?.(values, isEdit);
        const v = values[f.name];
        const setVal = (val: unknown, refRow?: Row) => {
          const patch: Row = { [f.name]: val };
          const derived = f.onSet?.(val, { ...values, ...patch }, refRow) ?? {};
          set({ ...patch, ...derived });
        };
        if (f.render) return <div key={f.name} className={cx(f.wide && 'sm:col-span-2')}>{f.render(values, set)}</div>;
        if (f.type === 'checkbox') {
          return (
            <div key={f.name} className={cx('flex items-end', f.wide && 'sm:col-span-2')}>
              <Checkbox label={t(f.label)} checked={!!v} onChange={(c) => setVal(c)} disabled={ro} hint={f.hint ? t(f.hint) : undefined} />
            </div>
          );
        }
        let control: ReactNode;
        switch (f.type) {
          case 'textarea':
            control = <Textarea value={v ?? ''} onChange={(e) => setVal(e.target.value)} disabled={ro} dir={f.rtl ? 'rtl' : undefined} className={f.rtl ? 'font-thaana' : ''} />;
            break;
          case 'select':
            control = (
              <Select value={v ?? ''} onChange={(e) => setVal(e.target.value)} disabled={ro}>
                {!f.required && <option value="">{t('common.select')}</option>}
                {f.required && !v && <option value="">{t('common.select')}</option>}
                {f.options?.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </Select>
            );
            break;
          case 'ref':
            control = <RefSelect kind={f.ref!} value={v} onChange={(val, row) => setVal(val, row)} disabled={ro}
              params={f.refParams?.(values) as Record<string, string>} />;
            break;
          case 'number': case 'money': case 'percent':
            control = <Input type="number" inputMode="decimal" step={f.type === 'number' ? 'any' : '0.01'} min={f.min} max={f.max}
              value={v ?? ''} onChange={(e) => setVal(e.target.value)} disabled={ro} />;
            break;
          case 'date':
            control = <Input type="date" value={v ? String(v).slice(0, 10) : ''} onChange={(e) => setVal(e.target.value)} disabled={ro} />;
            break;
          default:
            control = <Input type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} value={v ?? ''}
              onChange={(e) => setVal(e.target.value)} disabled={ro} dir={f.rtl ? 'rtl' : f.type === 'email' || f.type === 'tel' ? 'ltr' : undefined}
              lang={f.rtl ? 'dv' : undefined} className={f.rtl ? 'font-thaana' : ''} />;
        }
        return (
          <Field key={f.name} label={t(f.label)} required={f.required} error={errors[f.name]} hint={f.hint ? t(f.hint) : undefined}
            className={cx(f.wide && 'sm:col-span-2')}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

export const enumOptions = (prefix: string, values: string[]) => values.map((v) => ({ value: v, label: `${prefix}.${v}` }));
export const PAY_METHODS = enumOptions('payMethods', ['cash', 'bank_transfer', 'cheque', 'card', 'mobile', 'other']);
export const UNITS = enumOptions('units', ['kg', 'pcs', 'ton', 'lb']);
export const JOB_ROLES = enumOptions('jobRoles', ['captain', 'engineer', 'fisherman', 'cook', 'deckhand', 'other']);
export const RECORD_STATUS = enumOptions('status', ['active', 'inactive']);
