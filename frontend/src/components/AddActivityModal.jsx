import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { api, payloadData, uploadEvidenceFile } from '../lib/api';
import { ACTIVITY_CATEGORIES, EVIDENCE_ACCEPT, EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../lib/constants';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Field, Notice } from './ui';
import { modalEnter } from '../lib/motion';

const emptyForm = {
  title: '',
  category: 'teaching',
  start_date: '',
  end_date: '',
  academic_year: '',
  description: '',
  role: '',
  organization: '',
  location: '',
  duration_hours: '',
  doi: '',
  url: '',
};

function toForm(activity) {
  if (!activity) return emptyForm;
  return {
    ...emptyForm,
    title: activity.title || activity.activity || '',
    category: activity.category || 'other',
    start_date: activity.start_date || activity.date || '',
    end_date: activity.end_date || '',
    academic_year: activity.academic_year || '',
    description: activity.description || '',
    role: activity.role || '',
    organization: activity.organization || '',
    location: activity.location || '',
    duration_hours: activity.duration_hours ?? '',
    doi: activity.doi || '',
    url: activity.url || '',
  };
}

function validateFile(file) {
  if (!file) return '';
  if (!EVIDENCE_MIME_TYPES.includes(file.type)) return 'Use a PDF, PNG, JPG, JPEG, DOCX or XLSX file.';
  if (file.size > MAX_EVIDENCE_BYTES) return 'Evidence files must be 25 MB or smaller.';
  return '';
}

function academicYearForDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const start = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export default function AddActivityModal({ isOpen, onClose, onAddSuccess, activity = null }) {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm(toForm(activity));
      setFile(null);
      setError('');
    }
  }, [activity, isOpen]);

  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    const fileError = validateFile(nextFile);
    setError(fileError);
    setFile(fileError ? null : nextFile);
    if (fileError) event.target.value = '';
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.title.trim() || !form.start_date || !form.category) {
      setError('Title, category and start date are required.');
      return;
    }
    setBusy(true);
    const payload = {
      title: form.title.trim(),
      category: form.category,
      start_date: form.start_date,
      end_date: form.end_date || null,
      academic_year: form.academic_year.trim() || academicYearForDate(form.start_date),
      description: form.description.trim() || null,
      role: form.role.trim() || null,
      organization: form.organization.trim() || null,
      location: form.location.trim() || null,
      duration_hours: form.duration_hours === '' ? null : Number(form.duration_hours),
      doi: form.doi.trim() || null,
      url: form.url.trim() || null,
      visibility: 'private',
    };

    try {
      const saved = payloadData(activity ? await api.activities.update(activity.id, payload) : await api.activities.create(payload));
      if (file) await uploadEvidenceFile(file, saved?.id ? [saved.id] : []);
      onAddSuccess?.(saved);
      onClose();
    } catch (submitError) {
      setError(runtimeConfigMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'input';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_27_32_/_45%)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={activity ? 'Edit activity' : 'Log new activity'}>
          <motion.div {...modalEnter} className="app-surface relative max-h-[92vh] w-full max-w-2xl space-y-5 overflow-y-auto !rounded-[var(--radius-panel)] p-6">
            <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-2 text-[var(--brand-subtle)] transition hover:bg-[var(--brand-surface-muted)] hover:text-[var(--brand-ink)]" aria-label="Close activity form">
              <X className="h-5 w-5" />
            </button>
            <div className="pr-8">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">{activity ? 'Edit Activity' : 'Log New Activity'}</h2>
                <span className="chip chip-primary !text-[11px]">Real record</span>
              </div>
              <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Save the contribution to your academic record. You can attach proof now or later.</p>
            </div>

            {error && <Notice tone="error">{error}</Notice>}

            <form onSubmit={submit} className="space-y-4">
              <Field label="Activity Title *" htmlFor="activity-title">
                <input id="activity-title" value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="e.g. Data Structures Lab curriculum redesign" className={inputClass} required />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Category *" htmlFor="activity-category">
                  <select id="activity-category" value={form.category} onChange={(event) => update('category', event.target.value)} className={inputClass} required>
                    {ACTIVITY_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </Field>
                <Field label="Start Date *" htmlFor="activity-start">
                  <input id="activity-start" type="date" value={form.start_date} onChange={(event) => update('start_date', event.target.value)} className={inputClass} required />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="End Date" htmlFor="activity-end" optional>
                  <input id="activity-end" type="date" min={form.start_date || undefined} value={form.end_date} onChange={(event) => update('end_date', event.target.value)} className={inputClass} />
                </Field>
                <Field label="Academic Year" htmlFor="activity-year" optional>
                  <input id="activity-year" value={form.academic_year} onChange={(event) => update('academic_year', event.target.value)} placeholder="2025-26" className={inputClass} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Organization" htmlFor="activity-org">
                  <input id="activity-org" value={form.organization} onChange={(event) => update('organization', event.target.value)} placeholder="Institution or publisher" className={inputClass} />
                </Field>
                <Field label="Role" htmlFor="activity-role">
                  <input id="activity-role" value={form.role} onChange={(event) => update('role', event.target.value)} placeholder="PI, mentor, participant…" className={inputClass} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Location" htmlFor="activity-location">
                  <input id="activity-location" value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="City or online" className={inputClass} />
                </Field>
                <Field label="Duration (hours)" htmlFor="activity-hours">
                  <input id="activity-hours" type="number" min="0" step="0.5" value={form.duration_hours} onChange={(event) => update('duration_hours', event.target.value)} placeholder="e.g. 12" className={inputClass} />
                </Field>
              </div>

              <Field label="Description / Impact Notes" htmlFor="activity-description">
                <textarea id="activity-description" rows={3} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Context, outcome, citation or notes" className={inputClass} />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="DOI" htmlFor="activity-doi">
                  <input id="activity-doi" value={form.doi} onChange={(event) => update('doi', event.target.value)} placeholder="10.xxxx/xxxxx" className={inputClass} />
                </Field>
                <Field label="Source URL" htmlFor="activity-url">
                  <input id="activity-url" type="url" value={form.url} onChange={(event) => update('url', event.target.value)} placeholder="https://…" className={inputClass} />
                </Field>
              </div>

              <Field label="Attach Evidence" htmlFor="activity-evidence" optional>
                <label htmlFor="activity-evidence" className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--brand-border)] bg-[var(--brand-canvas-soft)] p-4 text-center transition hover:border-[var(--brand-lavender-strong)] hover:bg-[var(--brand-primary-softer)]">
                  <Upload className="h-5 w-5 text-[var(--brand-primary)]" />
                  <span className="text-sm text-[var(--brand-muted)]">
                    {file
                      ? <span className="flex items-center gap-1 font-bold text-[var(--brand-mint-ink)]"><CheckCircle2 className="h-4 w-4" />{file.name}</span>
                      : <><span className="font-bold text-[var(--brand-primary-hover)]">Choose a file</span> (PDF, PNG, JPG, JPEG, DOCX or XLSX, max 25 MB)</>}
                  </span>
                  <input id="activity-evidence" type="file" accept={EVIDENCE_ACCEPT} onChange={handleFileChange} className="sr-only" />
                </label>
              </Field>

              <div className="flex items-center justify-end gap-2 border-t border-[var(--brand-border-soft)] pt-4">
                <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {activity ? 'Save Changes' : 'Save Activity'}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
