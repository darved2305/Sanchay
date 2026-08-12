import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clock3, Edit3, FileCheck2, FlaskConical, Loader2, Plus, RefreshCw, Search, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { ACTIVITY_CATEGORIES, categoryLabel } from '../lib/constants';
import { invalidateQueries, useApiQuery } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'teaching', label: 'Teaching' },
  { id: 'research', label: 'Research' },
  { id: 'publication', label: 'Publication' },
  { id: 'mentorship', label: 'Mentorship' },
  { id: 'workshop_fdp', label: 'Workshop / FDP' },
  { id: 'committee', label: 'Committee' },
];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function flattenCandidates(payload) {
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload?.buckets && typeof payload.buckets === 'object') return Object.values(payload.buckets).flatMap((items) => Array.isArray(items) ? items : []);
  return listItems(payload);
}

function statusClass(status) {
  if (status === 'confirmed' || status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'archived' || status === 'rejected') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

export default function ActivitiesSubmissions({ onOpenAddModal, setCurrentView, initialQuery = '' }) {
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [evidenceStatus, setEvidenceStatus] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const queryKey = useMemo(() => ['activities', { category, q: query, academic_year: academicYear, evidence_status: evidenceStatus }], [academicYear, category, evidenceStatus, query]);
  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  const activities = useApiQuery(queryKey, () => api.activities.list({ category, q: query, academic_year: academicYear, evidence_status: evidenceStatus, limit: 50 }));
  const candidates = useApiQuery(['publications', 'candidates'], () => api.publications.candidates('pending'));
  const items = listItems(activities.data);
  const candidateItems = flattenCandidates(candidates.data);
  const categoryCounts = useMemo(() => items.reduce((counts, item) => ({ ...counts, [item.category]: (counts[item.category] || 0) + 1 }), {}), [items]);
  const hasAnyData = items.length > 0 || candidateItems.length > 0;

  const mutate = async (key, action) => {
    setActionBusy(key);
    setActionError('');
    try {
      await action();
      invalidateQueries(['activities']);
      invalidateQueries(['dashboard', 'faculty']);
      invalidateQueries(['publications', 'candidates']);
    } catch (error) {
      setActionError(runtimeConfigMessage(error));
    } finally {
      setActionBusy('');
    }
  };

  const archive = (item) => mutate(`archive-${item.id}`, () => api.activities.archive(item.id));
  const confirmCandidate = (candidate) => mutate(`confirm-${candidate.id}`, () => api.publications.confirm(candidate.id));
  const rejectCandidate = (candidate) => mutate(`reject-${candidate.id}`, () => api.publications.reject(candidate.id));
  const syncPublications = () => mutate('sync-publications', async () => {
    const result = payloadData(await api.publications.sync());
    if (result?.job_id) setActionError('Publication sync started. Candidates will appear here when the source sync completes.');
  });

  const openAdd = (activity = null) => {
    onOpenAddModal?.(activity);
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-400"><button onClick={() => setCurrentView('dashboard')} className="hover:text-slate-600">Dashboard</button><span>/</span><span className="font-semibold text-[#FD6F3B]">Activities &amp; Record</span></div><h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Activities &amp; Submissions</h1><p className="mt-2 text-base text-slate-500">Browse, add and manage your academic record from the live faculty API.</p></div><button onClick={() => openAdd()} className="flex items-center justify-center gap-2 rounded-2xl bg-[#FD6F3B] px-5 py-3 text-base font-bold text-white shadow-md shadow-orange-500/25 transition-all hover:bg-[#E05320]"><Plus className="h-4 w-4" />Add Activity</button></div>

      {actionError && <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><span className="flex items-center gap-2"><XCircle className="h-4 w-4" />{actionError}</span><button onClick={() => setActionError('')} aria-label="Dismiss error"><XCircle className="h-4 w-4" /></button></div>}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, organization or notes" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div><input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="Academic year" className="w-36 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /><select value={evidenceStatus} onChange={(event) => setEvidenceStatus(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20"><option value="">All evidence</option><option value="attached">Evidence attached</option><option value="pending">Evidence pending</option><option value="none_needed">No evidence needed</option></select><button onClick={() => activities.refetch()} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Refresh activities"><RefreshCw className={`h-4 w-4 ${activities.loading ? 'animate-spin' : ''}`} /></button></div>

      <div className="flex gap-2 overflow-x-auto pb-1">{FILTERS.map((filter) => <button key={filter.id || 'all'} onClick={() => setCategory(filter.id)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-bold transition-all ${category === filter.id ? 'bg-[#FD6F3B] text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>{filter.label}</button>)}</div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{ACTIVITY_CATEGORIES.slice(0, 7).map((item) => <div key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs"><p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">{item.label}</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{categoryCounts[item.id] ?? 0}</p><p className="text-xs font-medium text-slate-500">loaded records</p></div>)}</div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xs"><div className="flex flex-col justify-between gap-2 border-b border-slate-100 p-6 sm:flex-row sm:items-center"><div><h2 className="text-xl font-bold text-slate-800">Your academic record</h2><p className="mt-1 text-sm text-slate-500">Only records returned by the backend appear here.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{items.length} loaded</span></div>{activities.loading && <div className="space-y-3 p-6">{[1, 2, 3].map((row) => <div key={row} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>}{activities.error && <div className="p-6 text-sm font-semibold text-red-700">{runtimeConfigMessage(activities.error)} <button onClick={() => activities.refetch()} className="ml-2 underline">Retry</button></div>}{!activities.loading && !activities.error && items.length === 0 && <div className="p-10 text-center"><FileCheck2 className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-3 text-lg font-bold text-slate-800">No activities match these filters</h3><p className="mt-1 text-sm text-slate-500">Add your first activity or adjust the search filters.</p><button onClick={() => openAdd()} className="mt-4 rounded-xl bg-[#FD6F3B] px-4 py-2 text-sm font-bold text-white hover:bg-[#E05320]">Add Activity</button></div>}{items.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-400"><th className="px-6 py-3">Activity</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Evidence</th><th className="px-6 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id} className="hover:bg-slate-50/70"><td className="px-6 py-4"><p className="font-bold text-slate-900">{item.title || item.activity || 'Untitled activity'}</p><p className="mt-0.5 max-w-[320px] truncate text-xs text-slate-500">{item.organization || item.description || 'No additional details'}</p><span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusClass(item.status)}`}>{item.status || 'pending'}</span></td><td className="px-3 py-4"><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-[#E05320]">{categoryLabel(item.category)}</span></td><td className="whitespace-nowrap px-3 py-4 font-medium text-slate-500">{formatDate(item.start_date || item.date)}</td><td className="px-3 py-4">{item.evidence_status === 'attached' || item.evidence?.length > 0 ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Attached</span> : item.evidence_status === 'none_needed' ? <span className="text-xs font-semibold text-slate-400">Not needed</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700"><Clock3 className="h-4 w-4" />Pending</span>}</td><td className="px-6 py-4 text-right"><div className="flex justify-end gap-1"><button onClick={() => openAdd(item)} className="rounded-lg p-2 text-slate-400 hover:bg-orange-50 hover:text-[#FD6F3B]" aria-label={`Edit ${item.title || 'activity'}`}><Edit3 className="h-4 w-4" /></button><button onClick={() => archive(item)} disabled={item.status === 'archived' || actionBusy === `archive-${item.id}`} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" aria-label={`Archive ${item.title || 'activity'}`}>{actionBusy === `archive-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}</button></div></td></tr>)}</tbody></table></div>}</section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-blue-200/80 bg-blue-50/60 p-6 shadow-xs"><div className="flex items-start justify-between gap-3"><div><span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-blue-700"><FlaskConical className="h-3.5 w-3.5" />Real publication sync</span><h2 className="mt-3 text-xl font-extrabold text-slate-900">ORCID, OpenAlex &amp; Crossref</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Sync candidates from the configured publication sources. Nothing is added until you confirm it.</p></div></div><button onClick={syncPublications} disabled={actionBusy === 'sync-publications'} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{actionBusy === 'sync-publications' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Sync publication sources</button>{candidates.error && <p className="mt-3 text-xs font-semibold text-red-700">{runtimeConfigMessage(candidates.error)}</p>}{candidateItems.length > 0 && <div className="mt-4 space-y-3">{candidateItems.map((candidate) => { const publication = candidate.publication || candidate; return <div key={candidate.id} className="rounded-2xl border border-blue-100 bg-white p-3"><p className="font-bold text-slate-900">{publication.title || publication.work_title || 'Untitled candidate'}</p><p className="mt-1 text-xs text-slate-500">{candidate.source || candidate.provider || 'Publication source'}{publication.doi ? ` · DOI ${publication.doi}` : ''}{publication.year ? ` · ${publication.year}` : ''}</p><div className="mt-3 flex gap-2"><button onClick={() => confirmCandidate(candidate)} disabled={actionBusy === `confirm-${candidate.id}`} className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{actionBusy === `confirm-${candidate.id}` ? 'Saving…' : 'Confirm'}</button><button onClick={() => rejectCandidate(candidate)} disabled={actionBusy === `reject-${candidate.id}`} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{actionBusy === `reject-${candidate.id}` ? '…' : 'Reject'}</button></div></div>; })}</div>}{!candidates.loading && candidateItems.length === 0 && <p className="mt-4 text-xs font-semibold text-blue-800">No publication candidates are waiting for review.</p>}</section>
          <section className="rounded-3xl border border-orange-200/80 bg-[#FFF4F0] p-6 shadow-xs"><div className="flex items-center gap-2 text-[#FD6F3B]"><Upload className="h-5 w-5" /><h3 className="text-xs font-bold uppercase tracking-wider text-orange-950">Evidence management</h3></div><p className="mt-2 text-sm leading-relaxed text-orange-900">Attach proof to one or more activities from the Evidence Library.</p><button onClick={() => setCurrentView('evidence')} className="mt-4 flex items-center gap-2 text-sm font-bold text-[#E05320] hover:underline">Open Evidence Library <ShieldCheck className="h-4 w-4" /></button></section>
          {!hasAnyData && !activities.loading && <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xs"><p className="text-sm font-semibold text-slate-500">Your record is ready for its first real activity.</p></section>}
        </aside>
      </div>
    </div>
  );
}
