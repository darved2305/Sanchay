import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, FileCheck, Loader2, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';
import { Button, CategoryChip, EmptyState, Notice, PageHeader, ProgressBar, Skeleton, StatusBadge } from '../components/ui';
import { pageEnter } from '../lib/motion';

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
    try {
      const result = payloadData(await callback());
      if (result?.id || result?.submission_id || result?.sections) setSubmission(result);
      setNotice(message);
      invalidateQueries(['appraisal']);
      invalidateQueries(['dashboard', 'faculty']);
      return result;
    } catch (actionError) { setError(runtimeConfigMessage(actionError)); return null; } finally { setBusy(''); }
  };
  const generate = () => action('draft', () => api.appraisals.draft(openCycle.id), 'Draft generated from your confirmed activities.');
  const submit = () => submission?.id && action('submit', () => api.appraisals.submit(submission.id), 'Appraisal submitted to the institution review queue.');
  const pdf = async () => {
    const result = await action('pdf', () => api.appraisals.pdf(submission.id), 'PDF generated from the stored submission.');
    const url = result?.download_url || result?.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };
  const sections = submission?.sections || readinessData.sections || [];
  const currentStatus = submission?.status || openCycle?.submission_status || 'not_started';
  const canEdit = currentStatus === 'draft' || currentStatus === 'returned';
  const canSubmit = submission && (currentStatus === 'draft' || currentStatus === 'returned');
  const readinessPercent = Number(submission?.readiness ?? readinessData.readiness ?? 0);
  const readinessLoaded = Boolean(submission || readiness.data) && !readiness.loading;
  const reviewComments = useMemo(() => (submission?.reviews || []).filter((review) => review.comment), [submission]);

  if (cycles.loading && cycleItems.length === 0) {
    return <Skeleton className="h-80 !rounded-[var(--radius-card)]" />;
  }
  if (cycles.error) {
    return (
      <Notice tone="error">
        {runtimeConfigMessage(cycles.error)} <button type="button" onClick={() => cycles.refetch()} className="ml-2 underline">Retry</button>
      </Notice>
    );
  }
  if (!openCycle) {
    return (
      <div className="app-surface">
        <EmptyState icon={FileCheck} title="No appraisal cycle is open" detail="Your institution has not published an appraisal cycle yet." />
      </div>
    );
  }

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Self-Appraisal"
        subtitle={`${openCycle.name} · ${openCycle.academic_year}`}
        actions={<StatusBadge status={currentStatus} />}
      />

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <section className="app-surface p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand-subtle)]">Readiness from confirmed activities</p>
            <p className="mt-1 text-5xl font-extrabold tracking-tight text-[var(--brand-ink)]">
              {readinessLoaded ? `${Math.round(readinessPercent)}%` : '—'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!submission && (
              <Button variant="primary" onClick={generate} disabled={busy === 'draft' || !readinessLoaded}>
                {busy === 'draft' || !readinessLoaded ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Generate Draft
              </Button>
            )}
            {canSubmit && (
              <Button variant="success-solid" onClick={submit} disabled={busy === 'submit'}>
                {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit appraisal
              </Button>
            )}
            {submission && (
              <Button variant="secondary" onClick={pdf} disabled={busy === 'pdf'}>
                {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download PDF
              </Button>
            )}
          </div>
        </div>
        <ProgressBar value={readinessLoaded ? readinessPercent : 0} className="mt-5" />
        <p className="mt-2 text-xs font-medium text-[var(--brand-muted)]">
          {!readinessLoaded
            ? 'Loading confirmed activities…'
            : submission
              ? `${submission.activity_count || 0} confirmed activities in this draft.`
              : `${readinessData.activity_count || 0} confirmed activities are available for generation.`}
        </p>
      </section>

      {reviewComments.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-[var(--brand-peach-strong)] bg-[var(--brand-peach)] p-6">
          <div className="flex items-center gap-2 text-[var(--brand-peach-ink)]">
            <MessageSquare className="h-4 w-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">Review feedback</h2>
          </div>
          <div className="mt-3 space-y-2">
            {reviewComments.map((review) => (
              <div key={review.id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3.5 text-sm">
                <p className="font-bold text-[var(--brand-ink)]">{review.action}</p>
                <p className="mt-1 font-medium text-[var(--brand-muted)]">{review.comment}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.id} className="app-surface p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">{section.title}</h2>
                <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{section.description || 'Confirmed activities mapped from your academic record.'}</p>
              </div>
              <span className="chip chip-surface">{(section.items || []).length} items</span>
            </div>
            {(section.items || []).length === 0 ? (
              <p className="mt-5 rounded-[var(--radius-control)] bg-[var(--brand-canvas-soft)] p-4 text-sm font-medium text-[var(--brand-muted)]">No confirmed activities in this section.</p>
            ) : (
              <div className="mt-5 space-y-2">
                {section.items.map((item) => {
                  const activity = item.activity || item;
                  return (
                    <div key={item.id || item.activity_id || activity.id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-[var(--brand-ink)]">{activity.title || item.free_text || 'Contribution'}</p>
                        {activity.category && <CategoryChip category={activity.category} />}
                      </div>
                      <p className="mt-1 text-xs font-medium text-[var(--brand-muted)]">
                        {activity.start_date ? `${activity.start_date}` : ''}{activity.evidence_status ? `${activity.start_date ? ' · ' : ''}evidence ${activity.evidence_status}` : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      {!canEdit && submission && (
        <p className="text-center text-sm font-semibold text-[var(--brand-muted)]">
          This submission is {currentStatus.replace('_', ' ')}. Editing is disabled until the institution returns it for changes.
        </p>
      )}
    </motion.div>
  );
}
