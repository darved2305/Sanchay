import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, FileCheck, Loader2, RefreshCw, Send } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';

function statusClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'returned' || status === 'rejected') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export default function AppraisalPage() {
  const cycles = useApiQuery(['appraisal', 'cycles'], api.appraisals.cycles);
  const cycleItems = listItems(cycles.data);
  const openCycle = cycleItems.find((cycle) => cycle.status === 'open') || cycleItems[0];
  const readiness = useApiQuery(['appraisal', 'readiness', openCycle?.id], () => api.appraisals.readiness(openCycle.id), { enabled: Boolean(openCycle?.id) });
  const readinessData = payloadData(readiness.data) || {};
  const submissionId = openCycle?.submission_id;
  const submissionQuery = useApiQuery(
    ['appraisal', 'submission', submissionId],
    () => api.appraisals.submission(submissionId),
    { enabled: Boolean(submissionId) },
  );
  const [submission, setSubmission] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (submissionQuery.data) setSubmission(payloadData(submissionQuery.data));
    if (submissionQuery.error) setError(runtimeConfigMessage(submissionQuery.error));
    if (readiness.error) setError(runtimeConfigMessage(readiness.error));
  }, [readiness.error, submissionQuery.data, submissionQuery.error]);

  const action = async (name, callback, message) => {
    setBusy(name); setError(''); setNotice('');
    try { const result = payloadData(await callback()); if (result?.id || result?.submission_id || result?.sections) setSubmission(result); setNotice(message); invalidateQueries(['appraisal']); invalidateQueries(['dashboard', 'faculty']); return result; } catch (actionError) { setError(runtimeConfigMessage(actionError)); return null; } finally { setBusy(''); }
  };
  const generate = () => action('draft', () => api.appraisals.draft(openCycle.id), 'Draft generated from your confirmed activities.');
  const submit = () => submission?.id && action('submit', () => api.appraisals.submit(submission.id), 'Appraisal submitted to the institution review queue.');
  const pdf = async () => { const result = await action('pdf', () => api.appraisals.pdf(submission.id), 'PDF generated from the stored submission.'); const url = result?.download_url || result?.url; if (url) window.open(url, '_blank', 'noopener,noreferrer'); };
  const sections = submission?.sections || readinessData.sections || [];
  const currentStatus = submission?.status || openCycle?.submission_status || 'not_started';
  const canEdit = currentStatus === 'draft' || currentStatus === 'returned';
  const canSubmit = submission && (currentStatus === 'draft' || currentStatus === 'returned');
  const readinessPercent = Number(submission?.readiness ?? readinessData.readiness ?? 0);
  const readinessLoaded = Boolean(submission || readiness.data) && !readiness.loading;
  const reviewComments = useMemo(() => (submission?.reviews || []).filter((review) => review.comment), [submission]);

  if (cycles.loading && cycleItems.length === 0) return <div className="h-80 animate-pulse rounded-3xl bg-white" />;
  if (cycles.error) return <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-800">{runtimeConfigMessage(cycles.error)} <button onClick={() => cycles.refetch()} className="ml-2 underline">Retry</button></div>;
  if (!openCycle) return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center"><FileCheck className="mx-auto h-10 w-10 text-slate-300" /><h2 className="mt-3 text-xl font-bold text-slate-800">No appraisal cycle is open</h2><p className="mt-1 text-sm text-slate-500">Your institution has not published an appraisal cycle yet.</p></div>;

  return <div className="space-y-6 pb-12"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Self-Appraisal</h1><p className="mt-2 text-base text-slate-500">{openCycle.name} · {openCycle.academic_year}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClass(currentStatus)}`}>{currentStatus.replace('_', ' ')}</span></div>
    {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}{notice && <div role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{notice}</div>}
    <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Readiness from confirmed activities</p><p className="mt-1 text-5xl font-extrabold text-slate-900">{readinessLoaded ? `${Math.round(readinessPercent)}%` : '—'}</p></div><div className="flex gap-2">{!submission && <button onClick={generate} disabled={busy === 'draft' || !readinessLoaded} className="flex items-center gap-2 rounded-xl bg-[#FD6F3B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#E05320] disabled:opacity-50">{busy === 'draft' || !readinessLoaded ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Generate Draft</button>}{canSubmit && <button onClick={submit} disabled={busy === 'submit'} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit appraisal</button>}{submission && <button onClick={pdf} disabled={busy === 'pdf'} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download PDF</button>}</div></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#FD6F3B]" style={{ width: `${readinessLoaded ? Math.max(0, Math.min(100, readinessPercent)) : 0}%` }} /></div><p className="mt-2 text-xs font-medium text-slate-500">{!readinessLoaded ? 'Loading confirmed activities…' : submission ? `${submission.activity_count || 0} confirmed activities in this draft.` : `${readinessData.activity_count || 0} confirmed activities are available for generation.`}</p></section>
    {reviewComments.length > 0 && <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6"><h2 className="text-sm font-bold uppercase tracking-wider text-rose-900">Review feedback</h2><div className="mt-3 space-y-2">{reviewComments.map((review) => <div key={review.id} className="rounded-2xl border border-rose-100 bg-white p-3 text-sm"><p className="font-bold text-slate-800">{review.action}</p><p className="mt-1 text-slate-600">{review.comment}</p></div>)}</div></section>}
    <div className="space-y-4">{sections.map((section) => <section key={section.id} className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">{section.title}</h2><p className="mt-1 text-sm text-slate-500">{section.description || 'Confirmed activities mapped from your academic record.'}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{(section.items || []).length} items</span></div>{(section.items || []).length === 0 ? <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500">No confirmed activities in this section.</p> : <div className="mt-5 space-y-2">{section.items.map((item) => { const activity = item.activity || item; return <div key={item.id || item.activity_id || activity.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3"><p className="font-bold text-slate-900">{activity.title || item.free_text || 'Contribution'}</p><p className="mt-1 text-xs font-medium text-slate-500">{activity.category || ''}{activity.start_date ? ` · ${activity.start_date}` : ''}{activity.evidence_status ? ` · evidence ${activity.evidence_status}` : ''}</p></div>; })}</div>}</section>)}</div>
    {!canEdit && submission && <p className="text-center text-sm font-semibold text-slate-500">This submission is {currentStatus.replace('_', ' ')}. Editing is disabled until the institution returns it for changes.</p>}
  </div>;
}
