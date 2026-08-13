import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Award, Download, FilePlus2, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Field, Notice, PageHeader } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

const PURPOSES = [
  { id: 'ms', label: "Master's Program" },
  { id: 'job', label: 'Job Application' },
  { id: 'scholarship', label: 'Scholarship' },
  { id: 'phd', label: 'PhD Program' },
];

function AddStudentForm({ onCreated }) {
  const [form, setForm] = useState({ full_name: '', roll_number: '', program: '', relationship: 'project guide', course_or_project: '', start_date: '', end_date: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim() || !form.relationship.trim()) { setError('Student name and your relationship to them are required.'); return; }
    setBusy(true); setError('');
    try {
      await api.students.create({
        full_name: form.full_name.trim(),
        roll_number: form.roll_number.trim() || null,
        program: form.program.trim() || null,
        relationship: form.relationship.trim(),
        course_or_project: form.course_or_project.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes.trim() || null,
      });
      setForm({ full_name: '', roll_number: '', program: '', relationship: 'project guide', course_or_project: '', start_date: '', end_date: '', notes: '' });
      onCreated();
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form {...cardEnter} onSubmit={handleSubmit} className="app-surface space-y-4 p-6">
      <div className="flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-[var(--brand-primary)]" />
        <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Link a student</h2>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Student name"><input type="text" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} className="input" /></Field>
        <Field label="Roll number" optional><input type="text" value={form.roll_number} onChange={(e) => update('roll_number', e.target.value)} className="input" /></Field>
        <Field label="Program" optional><input type="text" value={form.program} onChange={(e) => update('program', e.target.value)} className="input" placeholder="e.g. B.Tech CSE" /></Field>
        <Field label="Your relationship"><input type="text" value={form.relationship} onChange={(e) => update('relationship', e.target.value)} className="input" placeholder="e.g. project guide, mentor" /></Field>
        <Field label="Course / project" optional><input type="text" value={form.course_or_project} onChange={(e) => update('course_or_project', e.target.value)} className="input" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From" optional><input type="date" value={form.start_date} onChange={(e) => update('start_date', e.target.value)} className="input" /></Field>
          <Field label="To" optional><input type="date" min={form.start_date || undefined} value={form.end_date} onChange={(e) => update('end_date', e.target.value)} className="input" /></Field>
        </div>
      </div>
      <Field label="Notes" optional><textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={2} className="input resize-none" placeholder="Anything worth remembering for a future letter" /></Field>
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Link student
      </Button>
    </motion.form>
  );
}

function AchievementForm({ studentId, onAdded }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [achievedOn, setAchievedOn] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.students.addAchievement(studentId, { title: title.trim(), description: description.trim() || null, achieved_on: achievedOn || null });
      setTitle(''); setDescription(''); setAchievedOn('');
      onAdded();
    } catch { /* surfaced via list refresh */ } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] p-2.5">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Achievement title" className="input !py-1.5 flex-1 min-w-[140px]" />
      <input type="date" value={achievedOn} onChange={(e) => setAchievedOn(e.target.value)} className="input !py-1.5 !w-36" />
      <Button variant="soft" size="sm" onClick={submit} disabled={busy || !title.trim()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />} Add
      </Button>
    </div>
  );
}

function DraftLetterPanel({ students }) {
  const [studentId, setStudentId] = useState('');
  const [purpose, setPurpose] = useState('ms');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [letter, setLetter] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState('');

  const handleDraft = async () => {
    if (!studentId) { setError('Choose a student first.'); return; }
    setBusy(true); setError(''); setDownloadUrl('');
    try {
      const created = payloadData(await api.lor.draft(studentId, purpose));
      setLetter(created);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true); setError('');
    try {
      const updated = payloadData(await api.lor.update(letter.id, letter.draft_text));
      setLetter(updated);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true); setError('');
    try {
      await handleSave();
      const result = payloadData(await api.lor.export(letter.id));
      setDownloadUrl(result.download_url);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section {...cardEnter} className="app-surface space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-[var(--brand-primary)]" />
        <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Draft a letter</h2>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Student">
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="input">
            <option value="">Choose a student…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </Field>
        <Field label="Purpose">
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="input">
            {PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      </div>
      <Button variant="primary" onClick={handleDraft} disabled={busy || !studentId}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Generate grounded draft
      </Button>

      {letter && (
        <div className="space-y-3 border-t border-[var(--brand-border-soft)] pt-4">
          <textarea
            value={letter.draft_text}
            onChange={(e) => setLetter((prev) => ({ ...prev, draft_text: e.target.value }))}
            rows={14}
            className="input w-full resize-y font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleSave} disabled={busy}>Save edits</Button>
            <Button variant="primary" size="sm" onClick={handleExport} disabled={busy}>
              <Download className="h-3.5 w-3.5" /> Export DOCX
            </Button>
            {downloadUrl && (
              <Button variant="success" size="sm" onClick={() => window.open(downloadUrl, '_blank', 'noopener')}>Download ready</Button>
            )}
          </div>
        </div>
      )}
    </motion.section>
  );
}

export default function LorStudioPage({ setCurrentView }) {
  const studentsQuery = useApiQuery(['lor', 'students'], () => api.students.list());
  const students = listItems(studentsQuery.data);

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="LOR Studio"
        subtitle="Draft recommendation letters grounded only in your real recorded history with each student -- never an invented achievement."
        breadcrumb={
          <button type="button" onClick={() => setCurrentView('dashboard')} className="btn btn-ghost btn-sm mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <AddStudentForm onCreated={() => invalidateQueries(['lor', 'students'])} />
          <div className="app-surface space-y-3 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">Your linked students</h3>
            {studentsQuery.loading && <p className="text-sm text-[var(--brand-muted)]">Loading…</p>}
            {!studentsQuery.loading && students.length === 0 && (
              <EmptyState icon={UserPlus} title="No students linked yet" detail="Link a student above to start building their record." />
            )}
            {students.map((student) => (
              <div key={student.id} className="space-y-2 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] p-3.5">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-[var(--brand-ink)]">{student.full_name}</p>
                  <span className="text-xs font-semibold text-[var(--brand-muted)]">{student.achievement_count} achievement(s)</span>
                </div>
                <p className="text-xs font-medium text-[var(--brand-muted)]">{student.relationship}{student.course_or_project ? ` · ${student.course_or_project}` : ''}</p>
                <AchievementForm studentId={student.id} onAdded={() => invalidateQueries(['lor', 'students'])} />
              </div>
            ))}
          </div>
        </div>

        <DraftLetterPanel students={students} />
      </div>
    </motion.div>
  );
}
