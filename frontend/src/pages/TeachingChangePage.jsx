import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, FilePlus2, GitCompare, Loader2, Upload, X } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader, ProgressBar } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

async function pollRun(runId, onUpdate, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const run = payloadData(await api.teaching.getRun(runId));
    onUpdate(run);
    if (run.job?.status === 'completed' || run.job?.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('This is taking longer than expected. Check back shortly.');
}

function SnapshotUploader({ label, snapshot, onSnapshotCreated, onFileUploaded, existingSnapshots = [] }) {
  const titleRef = useRef(null);
  const yearRef = useRef(null);
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createSnapshot = async () => {
    const title = titleRef.current?.value.trim();
    const year = yearRef.current?.value.trim();
    if (!title || !year) { setError('Enter a course title and academic year.'); return; }
    setBusy(true); setError('');
    try {
      const created = payloadData(await api.teaching.createSnapshot(title, year));
      onSnapshotCreated(created);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !snapshot) return;
    setBusy(true); setError('');
    try {
      const created = payloadData(await api.teaching.fileUploadUrl(snapshot.id, file));
      const uploadHeaders = new Headers();
      uploadHeaders.set('Content-Type', file.type);
      if (created.token) uploadHeaders.set('Authorization', `Bearer ${created.token}`);
      const uploadResponse = await fetch(created.upload_url, { method: 'PUT', headers: uploadHeaders, body: file });
      if (!uploadResponse.ok) throw new Error('The file could not be uploaded.');
      await api.teaching.finalizeFile(snapshot.id, file.name, created.storage_path, created.mime_type);
      onFileUploaded();
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="app-surface space-y-3 p-5">
      <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">{label}</h3>
      {error && <Notice tone="error">{error}</Notice>}
      {!snapshot ? (
        <div className="space-y-3">
          {existingSnapshots.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {existingSnapshots.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSnapshotCreated(item)}
                  className="chip chip-surface hover:!bg-[var(--brand-primary-softer)] hover:!text-[var(--brand-primary-hover)]"
                >
                  {item.course_title} · {item.academic_year}
                </button>
              ))}
            </div>
          )}
          <input ref={titleRef} type="text" placeholder="Course title (e.g. Data Structures)" className="input" />
          <input ref={yearRef} type="text" placeholder="Academic year (e.g. 2024-25)" className="input" />
          <Button variant="primary" size="sm" onClick={createSnapshot} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Create new snapshot
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-bold text-[var(--brand-ink)]">{snapshot.course_title}</p>
          <p className="text-xs font-medium text-[var(--brand-muted)]">{snapshot.academic_year} · {snapshot.file_count ?? 0} file(s)</p>
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload material
          </Button>
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.pptx,.txt" className="hidden" onChange={uploadFile} />
        </div>
      )}
    </div>
  );
}

export default function TeachingChangePage({ setCurrentView }) {
  const snapshots = useApiQuery(['teaching', 'snapshots'], () => api.teaching.snapshots());
  const [snapshotA, setSnapshotA] = useState(null);
  const [snapshotB, setSnapshotB] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const handleCompare = async () => {
    if (!snapshotA || !snapshotB) return;
    setComparing(true); setError(''); setRun(null);
    try {
      const started = payloadData(await api.teaching.compare(snapshotA.id, snapshotB.id));
      const finished = await pollRun(started.run_id, setRun);
      setRun(finished);
      if (finished.job?.status === 'failed') setError(finished.job.error || 'Comparison could not complete.');
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setComparing(false);
    }
  };

  const respond = async (changeId, action) => {
    setBusyId(changeId);
    try {
      if (action === 'approve') await api.teaching.approveChange(changeId);
      else await api.teaching.dismissChange(changeId);
      setRun((prev) => prev ? { ...prev, changes: prev.changes.map((c) => (c.id === changeId ? { ...c, status: action === 'approve' ? 'approved' : 'dismissed' } : c)) } : prev);
      invalidateQueries(['activities']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const existingSnapshots = listItems(snapshots.data);

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Teaching Change Detector"
        subtitle="Compare two years of one course's material. We diff the files first, then interpret what actually changed -- no guessed improvements."
        breadcrumb={
          <button type="button" onClick={() => setCurrentView('dashboard')} className="btn btn-ghost btn-sm mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <SnapshotUploader label="Course Year A" snapshot={snapshotA} onSnapshotCreated={setSnapshotA} onFileUploaded={() => setSnapshotA((s) => ({ ...s, file_count: (s.file_count || 0) + 1 }))} existingSnapshots={existingSnapshots} />
        <SnapshotUploader label="Course Year B" snapshot={snapshotB} onSnapshotCreated={setSnapshotB} onFileUploaded={() => setSnapshotB((s) => ({ ...s, file_count: (s.file_count || 0) + 1 }))} existingSnapshots={existingSnapshots} />
      </div>

      <div className="flex justify-center">
        <Button variant="primary" onClick={handleCompare} disabled={!snapshotA || !snapshotB || comparing}>
          {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />} Compare years
        </Button>
      </div>

      {comparing && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-3 !rounded-[var(--radius-panel)] p-8 text-center">
          <p className="text-sm font-bold text-[var(--brand-ink)]">{run?.job?.progress_label || 'Comparing…'}</p>
          <ProgressBar value={run?.job?.progress || 15} className="w-full max-w-xs" />
        </motion.div>
      )}

      {!comparing && run && run.changes?.length === 0 && (
        <EmptyState icon={CheckCircle2} title="No meaningful changes detected" detail="The two snapshots' material didn't differ in a way we could interpret as a teaching change." />
      )}

      {!comparing && run && run.changes?.length > 0 && (
        <motion.section {...cardEnter} className="app-surface space-y-3 p-6">
          <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">{run.changes.length} changes detected</h2>
          {run.changes.map((change) => (
            <div key={change.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] p-4">
              <div className="min-w-0">
                <span className="chip chip-sky !border-0 !text-[11px]">{change.change_type.replace(/_/g, ' ')}</span>
                <p className="mt-1 text-sm font-bold text-[var(--brand-ink)]">{change.description}</p>
              </div>
              {change.status === 'proposed' ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="success" size="sm" onClick={() => respond(change.id, 'approve')} disabled={busyId === change.id}>Approve</Button>
                  <Button variant="ghost" size="sm" onClick={() => respond(change.id, 'dismiss')} disabled={busyId === change.id}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <span className={`chip !border-0 shrink-0 ${change.status === 'approved' ? 'chip-mint' : 'chip-surface'}`}>{change.status}</span>
              )}
            </div>
          ))}
        </motion.section>
      )}
    </motion.div>
  );
}
