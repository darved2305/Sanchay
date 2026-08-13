import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, XCircle, Zap } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Notice, PageHeader, ProgressBar } from '../components/ui';
import { pageEnter, cardEnter } from '../lib/motion';

const STEP_LABELS = {
  publications_synced: 'Publications synced',
  activities_recovered: 'Forgotten activities recovered',
  evidence_checked: 'Evidence checked',
  appraisal_generated: 'Appraisal prepared',
};

async function pollRescue(jobId, onUpdate, { intervalMs = 1200, maxAttempts = 90 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = payloadData(await api.appraisals.rescueStatus(jobId));
    onUpdate(job);
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Deadline Rescue is taking longer than expected. Check back shortly.');
}

export default function DeadlineRescuePage({ setCurrentView }) {
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setRunning(true); setError(''); setJob(null);
    try {
      const started = payloadData(await api.appraisals.rescue());
      const finished = await pollRescue(started.job_id, setJob);
      setJob(finished);
      if (finished.status === 'failed') setError(finished.error || 'Deadline Rescue could not complete.');
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const steps = job?.result?.steps || {};
  const thingsNeedingYou = job?.result?.things_needing_you;

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Deadline Rescue"
        subtitle="My appraisal is due tomorrow. One run syncs publications, recovers forgotten work, checks evidence, and prepares your appraisal."
        breadcrumb={
          <button type="button" onClick={() => setCurrentView('dashboard')} className="btn btn-ghost btn-sm mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      {!job && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-4 !rounded-[var(--radius-panel)] border-2 border-[var(--brand-peach-strong)] bg-[var(--brand-peach)] p-12 text-center">
          <span className="icon-chip !h-14 !w-14" style={{ background: 'var(--brand-surface)' }}><AlertTriangle className="h-7 w-7 text-[var(--brand-peach-ink)]" /></span>
          <div>
            <h3 className="text-lg font-extrabold text-[var(--brand-ink)]">My appraisal is due tomorrow</h3>
            <p className="mt-1 max-w-md text-sm font-medium text-[var(--brand-muted)]">
              One click runs every relevant automation in sequence, then shows you exactly what still needs your attention.
            </p>
          </div>
          <Button variant="primary" onClick={handleStart} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Start Deadline Rescue
          </Button>
        </motion.div>
      )}

      {job && (
        <motion.div {...cardEnter} className="app-surface space-y-5 p-6">
          {job.status !== 'completed' && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-[var(--brand-ink)]">{job.progress_label || 'Working…'}</p>
              <ProgressBar value={job.progress || 10} />
            </div>
          )}

          <div className="space-y-2.5">
            {Object.entries(STEP_LABELS).map(([key, label]) => {
              const step = steps[key];
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] p-3">
                  <div className="flex items-center gap-2.5">
                    {!step ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-subtle)]" />
                    ) : step.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--brand-success)]" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[var(--brand-rose-ink)]" />
                    )}
                    <span className="font-bold text-[var(--brand-ink)]">{label}</span>
                  </div>
                  {step && <span className="text-xs font-medium text-[var(--brand-muted)]">{step.detail}</span>}
                </div>
              );
            })}
          </div>

          {job.status === 'completed' && (
            <div className="flex flex-col items-center gap-3 border-t border-[var(--brand-border-soft)] pt-5 text-center">
              <h3 className="text-lg font-extrabold text-[var(--brand-ink)]">
                {thingsNeedingYou > 0 ? `Only ${thingsNeedingYou} things still need you` : 'Everything is ready to review'}
              </h3>
              <div className="flex gap-2">
                {steps.activities_recovered?.ok && (
                  <Button variant="secondary" onClick={() => setCurrentView('reconstruct')}>Review recovered activities</Button>
                )}
                <Button variant="primary" onClick={() => setCurrentView('appraisal')}>Go to Appraisal</Button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
