import React, { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, CheckCircle2, FileUp, Loader2, UploadCloud } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, CategoryChip, Notice, PageHeader, ProgressBar } from '../components/ui';
import { categoryLabel } from '../lib/constants';
import { pageEnter, cardEnter } from '../lib/motion';
import { invalidateQueries } from '../lib/queryCache';

const ACCEPT = '.pdf,.docx';
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

async function pollJob(jobId, onUpdate, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = payloadData(await api.cvImport.get(jobId));
    onUpdate(job);
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('CV import is taking longer than expected. Check back shortly.');
}

export default function CvImportPage({ setCurrentView }) {
  const inputRef = useRef(null);
  const [stage, setStage] = useState('upload'); // upload | processing | review | done
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const runImport = useCallback(async (file) => {
    setError('');
    if (!ALLOWED_MIME.has(file.type)) {
      setError('Upload a PDF or DOCX CV.');
      return;
    }
    setStage('processing');
    try {
      const created = payloadData(await api.cvImport.uploadUrl(file));
      const uploadHeaders = new Headers();
      uploadHeaders.set('Content-Type', file.type);
      if (created.token) uploadHeaders.set('Authorization', `Bearer ${created.token}`);
      const uploadResponse = await fetch(created.upload_url, { method: 'PUT', headers: uploadHeaders, body: file });
      if (!uploadResponse.ok) throw new Error('The CV file could not be uploaded. Please try again.');

      await api.cvImport.process(created.job_id);
      const finished = await pollJob(created.job_id, setJob);
      setJob(finished);
      if (finished.status === 'failed') {
        setError(finished.error || 'CV import could not complete.');
        setStage('upload');
        return;
      }
      setSelectedIds(new Set((finished.activities || []).map((item) => item.id)));
      setStage('review');
    } catch (err) {
      setError(runtimeConfigMessage(err));
      setStage('upload');
    }
  }, []);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) void runImport(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void runImport(file);
  };

  const toggle = (id) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBusy(true); setError('');
    try {
      await api.activitiesBulkConfirm(Array.from(selectedIds));
      invalidateQueries(['activities']);
      invalidateQueries(['dashboard', 'faculty']);
      setStage('done');
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const activities = job?.activities || [];
  const grouped = activities.reduce((acc, item) => {
    acc[item.category] = acc[item.category] || [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Import Old Records"
        subtitle="Upload your CV. We extract draft activities from it and you confirm what's yours -- your record becomes useful in minutes."
        breadcrumb={
          <button type="button" onClick={() => setCurrentView('dashboard')} className="btn btn-ghost btn-sm mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      {stage === 'upload' && (
        <motion.div
          {...cardEnter}
          className="app-surface flex flex-col items-center gap-4 !rounded-[var(--radius-panel)] border-2 border-dashed border-[var(--brand-lavender-strong)] p-12 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <span className="icon-chip chip-lavender !h-14 !w-14"><UploadCloud className="h-7 w-7" /></span>
          <div>
            <h3 className="text-lg font-extrabold text-[var(--brand-ink)]">Drop your CV here, or browse</h3>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">PDF or DOCX, up to 15 MB.</p>
          </div>
          <Button variant="primary" onClick={() => inputRef.current?.click()}>
            <FileUp className="h-4 w-4" /> Choose file
          </Button>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={handleFileChange} />
        </motion.div>
      )}

      {stage === 'processing' && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-4 !rounded-[var(--radius-panel)] p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-primary)]" />
          <div className="w-full max-w-sm space-y-2">
            <p className="text-sm font-bold text-[var(--brand-ink)]">{job?.progress_label || 'Reading your CV…'}</p>
            <ProgressBar value={job?.progress || 15} />
          </div>
        </motion.div>
      )}

      {stage === 'review' && (
        <motion.div {...cardEnter} className="app-surface space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--brand-border-soft)] pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">We found {activities.length} activities</h2>
              <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Uncheck anything that isn't yours, then confirm to add the rest to your record.</p>
            </div>
            <Button variant="primary" onClick={handleConfirm} disabled={busy || selectedIds.size === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm {selectedIds.size} activities
            </Button>
          </div>
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <div className="flex items-center gap-2">
                  <CategoryChip category={category} label={categoryLabel(category)} />
                  <span className="text-xs font-bold text-[var(--brand-subtle)]">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3">
                      <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} className="mt-0.5 h-4 w-4 rounded border-[var(--brand-border)] text-[var(--brand-primary)]" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[var(--brand-ink)]">{item.title}</p>
                        <p className="text-xs font-medium text-[var(--brand-muted)]">{item.organization || item.academic_year}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {activities.length === 0 && (
              <p className="py-6 text-center text-sm font-medium text-[var(--brand-muted)]">No activities could be extracted from this file.</p>
            )}
          </div>
        </motion.div>
      )}

      {stage === 'done' && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-3 !rounded-[var(--radius-panel)] p-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-[var(--brand-success)]" />
          <h3 className="text-lg font-extrabold text-[var(--brand-ink)]">{selectedIds.size} activities added to your record</h3>
          <Button variant="primary" onClick={() => setCurrentView('activities')}>View My Academic Record</Button>
        </motion.div>
      )}
    </motion.div>
  );
}
