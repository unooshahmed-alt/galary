import { useEffect, useMemo, useState } from 'react';
import { useI18n, exportT, type ExportLang } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fetchAll, useAsync, errorText, unwrap, type Row } from '@/lib/db';
import { dname, isoDate, date as fmtDate } from '@/lib/format';
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, Tabs, cx } from '@/components/ui';
import { RefSelect } from '@/components/RefSelect';
import { DateRangeFilter, defaultRange } from '@/components/DateRangeFilter';
import { ExportMenu } from '@/components/ExportMenu';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Modal';

const STATUSES = ['present', 'absent', 'sick_leave', 'approved_leave'] as const;
const CODE: Record<string, string> = { present: 'P', absent: 'A', sick_leave: 'S', approved_leave: 'L' };
const TONE: Record<string, string> = {
  present: 'bg-emerald-600 text-white border-emerald-600', absent: 'bg-coral-600 text-white border-coral-600',
  sick_leave: 'bg-amber-500 text-white border-amber-500', approved_leave: 'bg-violet-600 text-white border-violet-600',
};

export default function Attendance() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'record' | 'register'>('record');
  return (
    <div>
      <PageHeader title={t('attendance.title')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'record', label: t('attendance.record') }, { id: 'register', label: t('attendance.register') }]} />
      {tab === 'record' ? <RecordAttendance /> : <Register />}
    </div>
  );
}

function RecordAttendance() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [boat, setBoat] = useState<string | null>(null);
  const [day, setDay] = useState(isoDate());
  const [trip, setTrip] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: string; notes: string }>>({});
  const [saving, setSaving] = useState(false);

  const data = useAsync(async () => {
    if (!boat) return { crew: [] as Row[], existing: [] as Row[] };
    const [assign, existing] = await Promise.all([
      fetchAll('v_boat_assignments', { filters: [['boat_id', 'eq', boat], ['start_date', 'lte', day]], sort: { column: 'crew_code', ascending: true } }),
      fetchAll('v_attendance', { filters: [['boat_id', 'eq', boat], ['date', 'eq', day]] }),
    ]);
    const onDate = assign.filter((a) => !a.end_date || a.end_date >= day);
    // include anyone already recorded that day even if no longer assigned
    const ids = new Set(onDate.map((a) => a.crew_id));
    for (const e of existing) if (!ids.has(e.crew_id)) onDate.push({ crew_id: e.crew_id, crew_code: e.crew_code, crew_name_en: e.crew_name_en, crew_name_dv: e.crew_name_dv });
    return { crew: onDate, existing };
  }, [boat, day]);

  useEffect(() => {
    const d: Record<string, { status: string; notes: string }> = {};
    for (const e of data.data?.existing ?? []) d[e.crew_id] = { status: e.status, notes: e.notes ?? '' };
    setDraft(d);
    const first = data.data?.existing?.[0];
    if (first?.trip_id) setTrip(first.trip_id);
  }, [data.data]);

  const existingBy = useMemo(() => new Map((data.data?.existing ?? []).map((e) => [e.crew_id, e])), [data.data]);
  const changed = (data.data?.crew ?? []).filter((c) => {
    const d = draft[c.crew_id];
    const e = existingBy.get(c.crew_id);
    return d && (!e || e.status !== d.status || (e.notes ?? '') !== d.notes);
  });
  const corrections = changed.filter((c) => existingBy.has(c.crew_id));

  const save = async () => {
    if (corrections.length) {
      const ok = await confirm({ title: t('attendance.alreadyRecorded'), message: `${corrections.length} ×`, confirmLabel: t('common.saveChanges') });
      if (ok === null) return;
    }
    setSaving(true);
    try {
      const inserts = changed.filter((c) => !existingBy.has(c.crew_id)).map((c) => ({
        boat_id: boat, trip_id: trip, crew_id: c.crew_id, date: day, status: draft[c.crew_id].status, notes: draft[c.crew_id].notes || null,
      }));
      if (inserts.length) unwrap(await supabase.from('attendance').insert(inserts));
      for (const c of corrections) {
        const e = existingBy.get(c.crew_id)!;
        unwrap(await supabase.from('attendance').update({ status: draft[c.crew_id].status, notes: draft[c.crew_id].notes || null }).eq('id', e.id));
      }
      toast.success(t('attendance.saved'));
      await data.reload();
    } catch (err) { toast.error(errorText(err, t)); } finally { setSaving(false); }
  };

  const manage = can('attendance.manage');
  return (
    <Card>
      {dialog}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label={t('common.boat')} required><RefSelect kind="boats" value={boat} onChange={(v) => { setBoat(v); setTrip(null); }} /></Field>
        <Field label={t('common.date')} required><Input type="date" value={day} max={isoDate()} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label={`${t('common.trip')} (${t('common.optional')})`}><RefSelect kind="trips" value={trip} onChange={setTrip} params={{ boatId: boat }} disabled={!boat} /></Field>
      </div>
      {!boat ? <Alert tone="info">{t('attendance.selectBoat')}</Alert> : data.loading ? <Spinner /> : (
        <>
          {(data.data?.existing.length ?? 0) > 0 && <div className="mb-3"><Alert tone="info">{t('attendance.alreadyRecorded')}</Alert></div>}
          {manage && (
            <div className="mb-3 flex justify-end">
              <Button size="sm" icon="check" onClick={() => {
                const d = { ...draft };
                for (const c of data.data?.crew ?? []) if (!d[c.crew_id]) d[c.crew_id] = { status: 'present', notes: '' };
                setDraft(d);
              }}>{t('attendance.markAll')}</Button>
            </div>
          )}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {(data.data?.crew ?? []).map((c) => {
              const d = draft[c.crew_id];
              const e = existingBy.get(c.crew_id);
              return (
                <li key={c.crew_id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{dname(c.crew_name_en, c.crew_name_dv, lang)}</div>
                    <div className="text-xs text-slate-500">{c.crew_code}{e && <> · {t('attendance.enteredBy')}: {e.created_by_name}{e.updated_by_name && ` · ${t('attendance.changedBy')}: ${e.updated_by_name}`}</>}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {STATUSES.map((s) => (
                      <button key={s} disabled={!manage} onClick={() => setDraft({ ...draft, [c.crew_id]: { status: s, notes: d?.notes ?? '' } })}
                        className={cx('rounded-lg border px-2.5 py-1.5 text-xs font-medium transition', d?.status === s ? TONE[s] : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
                        {t(`attendanceStatus.${s}`)}
                      </button>
                    ))}
                  </div>
                  <Input placeholder={t('common.notes')} value={d?.notes ?? ''} disabled={!manage || !d} className="sm:w-48"
                    onChange={(ev) => setDraft({ ...draft, [c.crew_id]: { status: d!.status, notes: ev.target.value } })} />
                </li>
              );
            })}
            {(data.data?.crew ?? []).length === 0 && <li className="p-4 text-sm text-slate-500">{t('common.noRecords')}</li>}
          </ul>
          {manage && (
            <div className="mt-4 flex justify-end">
              <Button variant="primary" icon="check" loading={saving} disabled={!changed.length} onClick={save}>{t('common.save')} ({changed.length})</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Register() {
  const { t, lang } = useI18n();
  const [boat, setBoat] = useState<string | null>(null);
  const [range, setRange] = useState(defaultRange('month'));
  const rows = useAsync(() => (boat ? fetchAll('v_attendance', { filters: [['boat_id', 'eq', boat], ['date', 'gte', range.from], ['date', 'lte', range.to]], sort: { column: 'date', ascending: true } }) : Promise.resolve([])), [boat, range.from, range.to]);

  const { dates, crew, cells } = useMemo(() => {
    const ds = [...new Set((rows.data ?? []).map((r) => r.date))].sort();
    const cm = new Map<string, Row>();
    const cl = new Map<string, string>();
    for (const r of rows.data ?? []) {
      cm.set(r.crew_id, r);
      cl.set(`${r.crew_id}|${r.date}`, r.status);
    }
    return { dates: ds, crew: [...cm.values()].sort((a, b) => String(a.crew_code).localeCompare(String(b.crew_code))), cells: cl };
  }, [rows.data]);

  const count = (crewId: string, s: string) => dates.filter((d) => cells.get(`${crewId}|${d}`) === s).length;

  const build = (xl: ExportLang) => {
    const xt = exportT(xl);
    return {
      fileName: `attendance-${range.from}-${range.to}`, title: xt('attendance.register'), lang: xl, landscape: true,
      meta: [[xt('common.period'), `${fmtDate(range.from)} – ${fmtDate(range.to)}`], [xt('common.generatedOn'), new Date().toLocaleString('en-GB')],
        ['Key', 'P = present · A = absent · S = sick leave · L = approved leave']] as [string, string][],
      columns: [
        { header: xt('crew.code'), key: 'crew_code' },
        { header: xt('common.name'), key: 'name', value: (r: Row) => (xl === 'dv' ? r.crew_name_dv || r.crew_name_en : xl === 'bi' ? [r.crew_name_en, r.crew_name_dv].filter(Boolean).join(' / ') : r.crew_name_en || r.crew_name_dv) },
        ...dates.map((d) => ({ header: d.slice(8, 10), key: d, value: (r: Row) => CODE[cells.get(`${r.crew_id}|${d}`) ?? ''] ?? '' })),
        ...STATUSES.map((s) => ({ header: xt(`attendanceStatus.${s}`), key: `n_${s}`, type: 'number' as const, value: (r: Row) => count(r.crew_id, s) })),
      ],
      rows: crew,
    };
  };

  return (
    <Card title={t('attendance.register')} actions={<ExportMenu build={build} disabled={!crew.length} />}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56"><Field label={t('common.boat')}><RefSelect kind="boats" value={boat} onChange={setBoat} /></Field></div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      {!boat ? <Alert tone="info">{t('attendance.selectBoat')}</Alert> : rows.loading ? <Spinner /> : crew.length === 0 ? <div className="text-sm text-slate-500">{t('common.noRecords')}</div> : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky start-0 bg-slate-50 px-2 py-1.5 text-start">{t('common.name')}</th>
                {dates.map((d) => <th key={d} className="px-1 py-1.5 text-center font-medium text-slate-500">{d.slice(8, 10)}</th>)}
                {STATUSES.map((s) => <th key={s} className="px-2 py-1.5 text-center">{CODE[s]}</th>)}
              </tr>
            </thead>
            <tbody>
              {crew.map((c) => (
                <tr key={c.crew_id} className="border-t border-slate-100">
                  <td className="sticky start-0 whitespace-nowrap bg-white px-2 py-1">{dname(c.crew_name_en, c.crew_name_dv, lang)}</td>
                  {dates.map((d) => {
                    const s = cells.get(`${c.crew_id}|${d}`);
                    return <td key={d} className="px-1 py-1 text-center"><span className={cx('inline-block w-5 rounded', s && TONE[s])}>{s ? CODE[s] : '·'}</span></td>;
                  })}
                  {STATUSES.map((s) => <td key={s} className="px-2 py-1 text-center font-medium">{count(c.crew_id, s)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
