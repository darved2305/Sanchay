import React, { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Notice, PageHeader, ProgressBar } from '../components/ui';
import { pageEnter, cardEnter } from '../lib/motion';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function pollForm(jobId, onUpdate, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const form = payloadData(await api.forms.get(jobId));
    onUpdate(form);
    if (form.job?.status === 'completed' || form.job?.status === 'failed') return form;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('This is taking longer than expected. Check back shortly.');
}

const STATUS_TONE = { auto_filled: 'chip-mint', needs_confirmation: 'chip-butter', needs_new_info: 'chip-peach' };
const STATUS_LABEL = { auto_filled: 'Auto-filled', needs_confirmation: 'Needs confirmation', needs_new_info: 'Needs new info' };

export default function AnyFormPage({ setCurrentView }) {
  const inputRef = useRef(null);
  const [stage, setStage] = useState('upload'); // upload | analyzing | review | generating | done
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const runUpload = useCallback(async (file) => {
    setError('');
    if (file.type !== XLSX_MIME) {
      setError('Upload an .xlsx university form.');
      return;
    }
    setStage('analyzing');
    try {
      const created = payloadData(await api.forms.uploadUrl(file));
      const uploadHeaders = new Headers();
      uploadHeaders.set('Content-Type', file.type);
      if (created.token) uploadHeaders.set('Authorization', `Bearer ${created.token}`);
      const uploadResponse = await fetch(created.upload_url, { method: 'PUT', headers: uploadHeaders, body: file });
      if (!uploadResponse.ok) throw new Error('The form could not be uploaded. Please try again.');

      await api.forms.analyze(created.job_id);
      const finished = await pollForm(created.job_id, setForm);
      setForm(finished);
      if (finished.job?.status === 'failed') {
        setError(finished.job.error || 'This form could not be analyzed.');
        setStage('upload');
        return;
      }
      setStage('review');
    } catch (err) {
      setError(runtimeConfigMessage(err));
      setStage('upload');
    }
  }, []);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) void runUpload(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void runUpload(file);
  };

  const updateFieldValue = async (fieldId, value) => {
    setBusy(true);
    try {
      const updated = payloadData(await api.forms.updateField(form.id, fieldId, value));
      setForm(updated);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    setStage('generating'); setError('');
    try {
      await api.forms.generate(form.id);
      let finished = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const latest = payloadData(await api.forms.get(form.id));
        if (latest.job?.status === 'completed' || latest.job?.status === 'failed') { finished = latest; break; }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (!finished || finished.job?.status === 'failed') {
        setError(finished?.job?.error || 'Could not generate the completed form.');
        setStage('review');
        return;
      }
      const download = payloadData(await api.forms.download(form.id));
      setDownloadUrl(download.url);
      setStage('done');
    } catch (err) {
      setError(runtimeConfigMessage(err));
      setStage('review');
    }
  };

  const fields = form?.fields || [];
  const needsAttention = fields.filter((f) => f.status !== 'auto_filled');

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Any Form Assistant"
        subtitle="Drop any university .xlsx form. We fill what we already know and ask only about what we don't."
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
          <span className="icon-chip chip-lavender !h-14 !w-14"><FileSpreadsheet className="h-7 w-7" /></span>
          <div>
            <h3 className="text-lg font-extrabold text-[var(--brand-ink)]">Drop your form here, or browse</h3>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">.xlsx, up to 10 MB. DOCX/PDF support follows the same pipeline.</p>
          </div>
          <Button variant="primary" onClick={() => inputRef.current?.click()}>
            <UploadCloud className="h-4 w-4" /> Choose file
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
        </motion.div>
      )}

      {(stage === 'analyzing' || stage === 'generating') && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-4 !rounded-[var(--radius-panel)] p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-primary)]" />
          <div className="w-full max-w-sm space-y-2">
            <p className="text-sm font-bold text-[var(--brand-ink)]">{form?.job?.progress_label || (stage === 'generating' ? 'Generating your completed form…' : 'Reading your form…')}</p>
            <ProgressBar value={form?.job?.progress || 15} />
          </div>
        </motion.div>
      )}

      {stage === 'review' && form && (
        <motion.div {...cardEnter} className="app-surface space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--brand-border-soft)] pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">
                {form.fields_detected} fields detected · {form.fields_auto_filled} automatically completed
              </h2>
              <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">
                {form.fields_needs_confirmation} need confirmation · {form.fields_needs_new_info} need new information
              </p>
            </div>
            <Button variant="primary" onClick={handleGenerate} disabled={busy}>
              <Sparkles className="h-4 w-4" /> Generate completed form
            </Button>
          </div>

          {needsAttention.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[var(--brand-ink)]">Needs your input</h3>
              {needsAttention.map((field) => (
                <div key={field.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] p-3">
                  <span className={`chip !border-0 ${STATUS_TONE[field.status]}`}>{STATUS_LABEL[field.status]}</span>
                  <span className="min-w-0 flex-1 text-sm font-bold text-[var(--brand-ink)]">{field.label}</span>
                  <input
                    type="text"
                    defaultValue={field.value || ''}
                    onBlur={(event) => { if (event.target.value !== (field.value || '')) updateFieldValue(field.id, event.target.value); }}
                    placeholder={field.question || 'Enter a value'}
                    className="input w-56"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-[var(--brand-ink)]">Auto-filled</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.filter((f) => f.status === 'auto_filled').map((field) => (
                <div key={field.id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] p-3">
                  <p className="text-xs font-bold text-[var(--brand-subtle)]">{field.label}</p>
                  <p className="text-sm font-bold text-[var(--brand-ink)]">{field.value}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {stage === 'done' && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-3 !rounded-[var(--radius-panel)] p-12 text-center">
          <span className="icon-chip chip-mint !h-14 !w-14"><Download className="h-7 w-7" /></span>
          <h3 className="text-lg font-extrabold text-[var(--brand-ink)]">Your form is ready</h3>
          <Button variant="primary" onClick={() => { window.open(downloadUrl, '_blank', 'noopener'); }}>
            <Download className="h-4 w-4" /> Download completed form
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
