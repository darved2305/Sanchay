import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, FileCheck2, Loader2, Paperclip, Upload } from 'lucide-react';
import { api, listItems, payloadData, uploadEvidenceFile } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { EVIDENCE_ACCEPT, EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../lib/constants';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader } from '../components/ui';
import { pageEnter } from '../lib/motion';

export default function EvidencePage() {
  const evidence = useApiQuery(['evidence'], () => api.evidence.list({ limit: 100 }));
  const activities = useApiQuery(['activities', { forEvidence: true }], () => api.activities.list({ limit: 100 }));
  const [file, setFile] = useState(null);
  const [activityId, setActivityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const items = listItems(evidence.data);
  const activityItems = listItems(activities.data).filter((item) => item.status !== 'archived');
  const selectedActivity = useMemo(() => activityItems.find((item) => item.id === activityId), [activityId, activityItems]);

  const selectFile = (event) => {
    const next = event.target.files?.[0] || null;
    setError('');
    if (!next) return setFile(null);
    if (!EVIDENCE_MIME_TYPES.includes(next.type)) return setError('Use PDF, PNG, JPG, JPEG, DOCX or XLSX evidence files.');
    if (next.size > MAX_EVIDENCE_BYTES) return setError('Evidence files must be 25 MB or smaller.');
    return setFile(next);
  };
  const upload = async (event) => {
    event.preventDefault();
    if (!file) return setError('Choose a file before uploading.');
    setBusy(true); setError(''); setNotice(''); setSuggestion(null);
    try {
      const uploaded = await uploadEvidenceFile(file, activityId ? [activityId] : []);
      setFile(null); event.target.reset(); setNotice(selectedActivity ? 'Evidence uploaded and attached.' : 'Evidence uploaded. Attach it to an activity when ready.');
      invalidateQueries(['evidence']); invalidateQueries(['activities']); invalidateQueries(['dashboard', 'faculty']);
      if (!activityId && uploaded?.id) {
        const matches = listItems(payloadData(await api.evidence.matches(uploaded.id)));
        if (matches.length > 0) setSuggestion({ evidenceId: uploaded.id, match: matches[0] });
      }
    } catch (uploadError) { setError(runtimeConfigMessage(uploadError)); } finally { setBusy(false); }
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
            <input id="evidence-file" type="file" accept={EVIDENCE_ACCEPT} onChange={selectFile} className="input !bg-[var(--brand-surface)]" />
            <p className="mt-1.5 text-xs font-medium text-[var(--brand-muted)]">PDF, PNG, JPG, DOCX or XLSX · max 25 MB</p>
          </div>
          <div>
            <label htmlFor="evidence-activity" className="input-label">Attach to activity</label>
            <select id="evidence-activity" value={activityId} onChange={(event) => setActivityId(event.target.value)} className="input !bg-[var(--brand-surface)]">
              <option value="">No activity yet</option>
              {activityItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <Button variant="primary" type="submit" disabled={busy || !file}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload file
          </Button>
        </form>
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
          <span className="icon-chip bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)]"><FileCheck2 className="h-5 w-5" /></span>
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
