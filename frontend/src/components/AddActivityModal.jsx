import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { api, payloadData, uploadEvidenceFile } from '../lib/api';
import { ACTIVITY_CATEGORIES, EVIDENCE_ACCEPT, EVIDENCE_MIME_TYPES, MAX_EVIDENCE_BYTES } from '../lib/constants';
import { runtimeConfigMessage } from '../lib/config';

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

  if (!isOpen) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Close activity form"><X className="h-5 w-5" /></button>
        <div className="pr-8"><div className="flex items-center gap-2"><h2 className="text-xl font-extrabold text-slate-900">{activity ? 'Edit Activity' : 'Log New Activity'}</h2><span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-950">Real record</span></div><p className="mt-0.5 text-base text-slate-500">Save the contribution to your academic record. You can attach proof now or later.</p></div>
        {error && <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        <form onSubmit={submit} className="space-y-4 text-base">
          <div><label htmlFor="activity-title" className="mb-1 block font-bold text-slate-700">Activity Title *</label><input id="activity-title" value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="e.g. Data Structures Lab curriculum redesign" className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label htmlFor="activity-category" className="mb-1 block font-bold text-slate-700">Category *</label><select id="activity-category" value={form.category} onChange={(event) => update('category', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required>{ACTIVITY_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div><div><label htmlFor="activity-start" className="mb-1 block font-bold text-slate-700">Start Date *</label><input id="activity-start" type="date" value={form.start_date} onChange={(event) => update('start_date', event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" required /></div></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label htmlFor="activity-end" className="mb-1 block font-bold text-slate-700">End Date <span className="font-medium text-slate-400">(optional)</span></label><input id="activity-end" type="date" min={form.start_date || undefined} value={form.end_date} onChange={(event) => update('end_date', event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div><div><label htmlFor="activity-year" className="mb-1 block font-bold text-slate-700">Academic Year <span className="font-medium text-slate-400">(optional)</span></label><input id="activity-year" value={form.academic_year} onChange={(event) => update('academic_year', event.target.value)} placeholder="2025-26" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label htmlFor="activity-org" className="mb-1 block font-bold text-slate-700">Organization</label><input id="activity-org" value={form.organization} onChange={(event) => update('organization', event.target.value)} placeholder="Institution or publisher" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div><div><label htmlFor="activity-role" className="mb-1 block font-bold text-slate-700">Role</label><input id="activity-role" value={form.role} onChange={(event) => update('role', event.target.value)} placeholder="PI, mentor, participant…" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label htmlFor="activity-location" className="mb-1 block font-bold text-slate-700">Location</label><input id="activity-location" value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="City or online" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div><div><label htmlFor="activity-hours" className="mb-1 block font-bold text-slate-700">Duration (hours)</label><input id="activity-hours" type="number" min="0" step="0.5" value={form.duration_hours} onChange={(event) => update('duration_hours', event.target.value)} placeholder="e.g. 12" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div></div>
          <div><label htmlFor="activity-description" className="mb-1 block font-bold text-slate-700">Description / Impact Notes</label><textarea id="activity-description" rows={3} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Context, outcome, citation or notes" className="w-full rounded-xl border border-slate-200 px-3.5 py-2 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><label htmlFor="activity-doi" className="mb-1 block font-bold text-slate-700">DOI</label><input id="activity-doi" value={form.doi} onChange={(event) => update('doi', event.target.value)} placeholder="10.xxxx/xxxxx" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div><div><label htmlFor="activity-url" className="mb-1 block font-bold text-slate-700">Source URL</label><input id="activity-url" type="url" value={form.url} onChange={(event) => update('url', event.target.value)} placeholder="https://…" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-medium text-slate-900 focus:border-[#FD6F3B] focus:outline-none focus:ring-2 focus:ring-[#FD6F3B]/20" /></div></div>
          <div><label htmlFor="activity-evidence" className="mb-1 block font-bold text-slate-700">Attach Evidence <span className="font-medium text-slate-400">(optional, max 25 MB)</span></label><label htmlFor="activity-evidence" className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center transition-colors hover:bg-orange-50/50"><Upload className="h-6 w-6 text-[#FD6F3B]" /><span className="text-sm text-slate-500">{file ? <span className="flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{file.name}</span> : <><span className="font-bold text-[#FD6F3B]">Choose a file</span> (PDF, PNG, JPG, JPEG, DOCX or XLSX)</>}</span><input id="activity-evidence" type="file" accept={EVIDENCE_ACCEPT} onChange={handleFileChange} className="sr-only" /></label></div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl bg-slate-100 px-4 py-2 text-base font-bold text-slate-700 transition-all hover:bg-slate-200 disabled:opacity-50">Cancel</button><button type="submit" disabled={busy} className="flex items-center gap-2 rounded-xl bg-[#FD6F3B] px-5 py-2 text-base font-bold text-white shadow-md shadow-orange-500/20 transition-all hover:bg-[#E05320] disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{activity ? 'Save Changes' : 'Save Activity'}</button></div>
        </form>
      </div>
    </div>
  );
}
