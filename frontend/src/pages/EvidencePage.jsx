import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, ChevronDown, Download, FileCheck2, Loader2, Paperclip, Sparkles, Upload, X } from 'lucide-react';
import { api, listItems, payloadData, uploadEvidenceFile } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { EVIDENCE_ACCEPT, EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../lib/constants';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader } from '../components/ui';
import { pageEnter } from '../lib/motion';
import { useClickOutside } from '../lib/useClickOutside';

const CATEGORY_LABELS = {
  research: 'Research',
  teaching: 'Teaching',
  professional_development: 'Professional Development',
  academic_service: 'Academic Service',
  student_mentorship: 'Student / Mentorship',
  administration: 'Administration',
  other: 'Other',
};

export default function EvidencePage() {
  const evidence = useApiQuery(['evidence'], () => api.evidence.list({ limit: 100 }));
  const activities = useApiQuery(['activities', { forEvidence: true }], () => api.activities.list({ limit: 100 }));
  const [files, setFiles] = useState([]);
  const [activityId, setActivityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const items = listItems(evidence.data);
  const activityItems = listItems(activities.data).filter((item) => item.status !== 'archived');
  const selectedActivity = useMemo(() => activityItems.find((item) => item.id === activityId), [activityId, activityItems]);
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const item of items) {
      if (!item.document_category) continue;
      counts[item.document_category] = (counts[item.document_category] || 0) + 1;
    }
    return counts;
  }, [items]);
  const closeDownloadMenu = useCallback(() => setShowDownloadMenu(false), []);
  const downloadMenuRef = useClickOutside(showDownloadMenu, closeDownloadMenu);

  const selectFile = (event) => {
    const picked = Array.from(event.target.files || []);
    setError('');
    if (picked.length === 0) return setFiles([]);
    const rejected = [];
    const accepted = [];
    for (const candidate of picked) {
      if (!EVIDENCE_MIME_TYPES.includes(candidate.type)) rejected.push(`${candidate.name} (unsupported type)`);
      else if (candidate.size > MAX_EVIDENCE_BYTES) rejected.push(`${candidate.name} (over 25 MB)`);
      else accepted.push(candidate);
    }
    if (rejected.length > 0) setError(`Skipped: ${rejected.join(', ')}. Use PDF, PNG, JPG, JPEG, DOCX or XLSX, max 25 MB each.`);
    return setFiles(accepted);
  };
  const removeSelectedFile = (index) => setFiles((previous) => previous.filter((_, i) => i !== index));
  const upload = async (event) => {
    event.preventDefault();
    if (files.length === 0) return setError('Choose at least one file before uploading.');
    setBusy(true); setError(''); setNotice(''); setSuggestion(null);
    const failures = [];
    let lastUploaded = null;
    for (let index = 0; index < files.length; index += 1) {
      setUploadProgress({ index: index + 1, total: files.length, name: files[index].name });
      try {
        // eslint-disable-next-line no-await-in-loop
        lastUploaded = await uploadEvidenceFile(files[index], activityId ? [activityId] : []);
      } catch (uploadError) {
        failures.push(`${files[index].name}: ${runtimeConfigMessage(uploadError)}`);
      }
    }
    setUploadProgress(null);
    const succeeded = files.length - failures.length;
    if (failures.length === 0) {
      setNotice(
        files.length === 1
          ? (selectedActivity ? 'Evidence uploaded and attached.' : 'Evidence uploaded. Attach it to an activity when ready.')
          : `${succeeded} file(s) uploaded${selectedActivity ? ' and attached' : ''}.`,
      );
    } else if (succeeded > 0) {
      setNotice(`${succeeded} of ${files.length} file(s) uploaded.`);
      setError(failures.join(' · '));
    } else {
      setError(failures.join(' · '));
    }
    setFiles([]); event.target.reset();
    invalidateQueries(['evidence']); invalidateQueries(['activities']); invalidateQueries(['dashboard', 'faculty']);
    if (!activityId && files.length === 1 && failures.length === 0 && lastUploaded?.id) {
      const matches = listItems(payloadData(await api.evidence.matches(lastUploaded.id)));
      if (matches.length > 0) setSuggestion({ evidenceId: lastUploaded.id, match: matches[0] });
    }
    setBusy(false);
    return undefined;
  };
  const acceptSuggestion = async () => {
    if (!suggestion) return;
    setBusy(true);
    try {
      await api.evidence.attach(suggestion.evidenceId, suggestion.match.activity.id);
      invalidateQueries(['evidence']); invalidateQueries(['activities']);
      setNotice('Evidence attached to the matching activity.');
      setSuggestion(null);
    } catch (attachError) { setError(runtimeConfigMessage(attachError)); } finally { setBusy(false); }
  };
  const download = async (item) => {
    try {
      const result = payloadData(await api.evidence.download(item.id));
      const url = result.url || result.download_url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else setError('The storage service did not return a download URL.');
    } catch (downloadError) { setError(runtimeConfigMessage(downloadError)); }
  };
  const attach = async (item) => {
    if (!activityId) return setError('Choose an activity before attaching evidence.');
    setBusy(true); setError('');
    try {
      await api.evidence.attach(item.id, activityId);
      invalidateQueries(['evidence']); invalidateQueries(['activities']);
      setNotice('Evidence attached.');
    } catch (attachError) { setError(runtimeConfigMessage(attachError)); } finally { setBusy(false); }
    return undefined;
  };
  const confirmClassification = async (item, category, type) => {
    setBusy(true); setError('');
    try {
      await api.evidence.confirmClassification(item.id, { document_category: category, document_type: type });
      invalidateQueries(['evidence']);
      setNotice('Classification confirmed.');
    } catch (confirmError) { setError(runtimeConfigMessage(confirmError)); } finally { setBusy(false); }
  };
  const bulkDownload = async (filter = {}) => {
    setShowDownloadMenu(false);
    setBulkBusy(true); setError('');
    try {
      const started = payloadData(await api.evidence.bulkDownload(filter));
      const jobId = started.job_id;
      let job = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        job = payloadData(await api.evidence.classificationJob(jobId));
        if (job?.status === 'completed' || job?.status === 'failed') break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 1200); });
      }
      if (job?.status === 'completed' && job.result?.download_url) {
        window.open(job.result.download_url, '_blank', 'noopener,noreferrer');
        setNotice(`Archive ready: ${job.result.file_count} file(s).`);
      } else {
        setError(job?.error || 'The export did not complete in time. Try again.');
      }
    } catch (bulkError) { setError(runtimeConfigMessage(bulkError)); } finally { setBulkBusy(false); }
  };

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Evidence &amp; Proof Library"
        subtitle="Files are stored in a private Supabase Storage bucket and linked to your activities."
      />

      <section className="rounded-[var(--radius-card)] border border-[var(--brand-lavender-strong)] bg-[var(--brand-primary-softer)] p-6">
        <form onSubmit={upload} className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px_auto] lg:items-end">
          <div>
            <label htmlFor="evidence-file" className="input-label">Choose evidence</label>
            <input id="evidence-file" type="file" accept={EVIDENCE_ACCEPT} multiple onChange={selectFile} className="input !bg-[var(--brand-surface)]" />
            <p className="mt-1.5 text-xs font-medium text-[var(--brand-muted)]">PDF, PNG, JPG, DOCX or XLSX · max 25 MB each · select multiple to upload together</p>
          </div>
          <div>
            <label htmlFor="evidence-activity" className="input-label">Attach to activity</label>
            <select id="evidence-activity" value={activityId} onChange={(event) => setActivityId(event.target.value)} className="input !bg-[var(--brand-surface)]">
              <option value="">No activity yet</option>
              {activityItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <Button variant="primary" type="submit" disabled={busy || files.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy && uploadProgress ? `Uploading ${uploadProgress.index}/${uploadProgress.total}…` : files.length > 1 ? `Upload ${files.length} files` : 'Upload file'}
          </Button>
        </form>
        {files.length > 0 && !busy && (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((selected, index) => (
              <span key={`${selected.name}-${index}`} className="chip chip-surface flex items-center gap-1.5 !text-xs">
                {selected.name}
                <button type="button" onClick={() => removeSelectedFile(index)} aria-label={`Remove ${selected.name}`} className="text-[var(--brand-subtle)] hover:text-[var(--brand-rose-ink)]">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <Notice tone="error" className="mt-4">{error}</Notice>}
        {notice && <Notice tone="success" className="mt-4">{notice}</Notice>}
        {suggestion && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--brand-mint-strong)] bg-[var(--brand-mint)] p-3.5">
            <p className="text-sm font-bold text-[var(--brand-ink)]">
              This looks like evidence for "{suggestion.match.activity.title}". Attach?
            </p>
            <div className="flex gap-2">
              <Button variant="success" size="sm" onClick={acceptSuggestion} disabled={busy}>Attach</Button>
              <Button variant="ghost" size="sm" onClick={() => setSuggestion(null)}>Dismiss</Button>
            </div>
          </div>
        )}
      </section>

      <section className="app-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--brand-border-soft)] p-6">
          <div>
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Your stored evidence</h2>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">
              {evidence.loading ? 'Loading…' : `${items.length} file${items.length === 1 ? '' : 's'} returned by the API`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative" ref={downloadMenuRef}>
              <Button
                variant="secondary" size="sm"
                onClick={() => setShowDownloadMenu((value) => !value)}
                disabled={bulkBusy || items.length === 0}
              >
                {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                Download <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {showDownloadMenu && (
                <div className="app-surface absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] p-2">
                  <button
                    type="button"
                    onClick={() => bulkDownload({})}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--brand-ink)] transition hover:bg-[var(--brand-primary-softer)]"
                  >
                    All files <span className="text-xs font-medium text-[var(--brand-muted)]">{items.length}</span>
                  </button>
                  {Object.keys(categoryCounts).length > 0 && (
                    <div className="my-1.5 border-t border-[var(--brand-border-soft)]" />
                  )}
                  {Object.entries(categoryCounts).map(([category, count]) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => bulkDownload({ document_category: category })}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--brand-ink)] transition hover:bg-[var(--brand-primary-softer)]"
                    >
                      {CATEGORY_LABELS[category] || category} <span className="text-xs font-medium text-[var(--brand-muted)]">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="icon-chip bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)]"><FileCheck2 className="h-5 w-5" /></span>
          </div>
        </div>
        {evidence.error && (
          <p className="p-6 text-sm font-semibold text-[var(--brand-rose-ink)]">
            {runtimeConfigMessage(evidence.error)} <button type="button" onClick={() => evidence.refetch()} className="ml-2 underline">Retry</button>
          </p>
        )}
        {!evidence.loading && !evidence.error && items.length === 0 && (
          <EmptyState
            icon={Paperclip}
            title="No evidence stored yet"
            detail="Upload a certificate, paper or supporting document above."
          />
        )}
        {items.length > 0 && (
          <div className="divide-y divide-[var(--brand-border-soft)]">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col justify-between gap-3 p-5 transition hover:bg-[var(--brand-primary-softer)] sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="icon-chip chip-sky !h-9 !w-9"><Paperclip className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[var(--brand-ink)]">{item.file_name}</p>
                    <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">
                      {item.mime_type} · {Math.ceil(Number(item.size_bytes || 0) / 1024)} KB · {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'date unavailable'}
                    </p>
                    {item.document_type && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="chip chip-lavender !border-0 !text-[11px]">
                          {CATEGORY_LABELS[item.document_category] || item.document_category} · {item.document_type}
                        </span>
                        {item.needs_confirmation && (
                          <button
                            type="button"
                            onClick={() => confirmClassification(item, item.document_category, item.document_type)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-primary-hover)] underline decoration-dotted"
                          >
                            <Sparkles className="h-3 w-3" /> Looks right, confirm
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="soft" size="sm" onClick={() => attach(item)} disabled={busy || !activityId}>
                    <Paperclip className="h-3.5 w-3.5" /> Attach
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => download(item)}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}
