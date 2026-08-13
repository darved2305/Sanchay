import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarPlus, CheckCircle2, Clock, Loader2, Users, XCircle } from 'lucide-react';
import { api, listItems } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { ACTIVITY_CATEGORIES } from '../lib/constants';
import { Button, EmptyState, Field, Notice, PageHeader, Skeleton } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

function ParticipantRow({ index, value, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value.profile_id}
        onChange={(event) => onChange(index, { ...value, profile_id: event.target.value })}
        placeholder="Faculty profile ID"
        className="input flex-1"
      />
      <input
        type="text"
        value={value.role}
        onChange={(event) => onChange(index, { ...value, role: event.target.value })}
        placeholder="Role (e.g. Participant)"
        className="input w-40"
      />
      <button type="button" onClick={() => onRemove(index)} aria-label="Remove participant" className="rounded-full p-2 text-[var(--brand-muted)] hover:bg-[var(--brand-danger-soft)] hover:text-[var(--brand-rose-ink)]">
        <XCircle className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AdminInstitutionEvents() {
  const events = useApiQuery(['admin', 'events'], () => api.institutionEvents.list());
  const [form, setForm] = useState({ category: 'workshop_fdp', title: '', organization: '', start_date: '', end_date: '' });
  const [participants, setParticipants] = useState([{ profile_id: '', role: 'Participant' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const eventItems = listItems(events.data);

  const updateParticipant = (index, value) => setParticipants((prev) => prev.map((p, i) => (i === index ? value : p)));
  const addParticipant = () => setParticipants((prev) => [...prev, { profile_id: '', role: 'Participant' }]);
  const removeParticipant = (index) => setParticipants((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(''); setNotice('');
    const validParticipants = participants.filter((p) => p.profile_id.trim());
    if (!form.title.trim() || validParticipants.length === 0) {
      setError('Provide a title and at least one participant profile ID.');
      return;
    }
    setBusy(true);
    try {
      await api.institutionEvents.create({
        category: form.category,
        title: form.title.trim(),
        organization: form.organization.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        participants: validParticipants.map((p) => ({ profile_id: p.profile_id.trim(), role: p.role.trim() || 'participant' })),
      });
      setNotice(`Event created. ${validParticipants.length} faculty received a proposal.`);
      setForm({ category: 'workshop_fdp', title: '', organization: '', start_date: '', end_date: '' });
      setParticipants([{ profile_id: '', role: 'Participant' }]);
      invalidateQueries(['admin', 'events']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader title="Institution Events" subtitle="Enter one institutional fact once -- every affected faculty member gets an individual proposal to confirm." />

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <motion.form {...cardEnter} onSubmit={handleSubmit} className="app-surface space-y-4 p-6">
        <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">New institutional event</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} className="input">
              {ACTIVITY_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>{category.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input type="text" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} className="input" placeholder="e.g. 5-Day Generative AI FDP" />
          </Field>
          <Field label="Organization" optional>
            <input type="text" value={form.organization} onChange={(event) => setForm((prev) => ({ ...prev, organization: event.target.value }))} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" optional>
              <input type="date" value={form.start_date} onChange={(event) => setForm((prev) => ({ ...prev, start_date: event.target.value }))} className="input" />
            </Field>
            <Field label="End date" optional>
              <input type="date" min={form.start_date || undefined} value={form.end_date} onChange={(event) => setForm((prev) => ({ ...prev, end_date: event.target.value }))} className="input" />
            </Field>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="input-label">Participants</span>
            <Button type="button" variant="secondary" size="sm" onClick={addParticipant}>Add participant</Button>
          </div>
          {participants.map((participant, index) => (
            <ParticipantRow key={index} index={index} value={participant} onChange={updateParticipant} onRemove={removeParticipant} />
          ))}
          <p className="text-xs font-medium text-[var(--brand-subtle)]">Paste faculty profile IDs from Admin → Faculty. CSV roster upload can be added once a real roster source is connected.</p>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Publish event
          </Button>
        </div>
      </motion.form>

      <section className="app-surface space-y-4 p-6">
        <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Recent events</h2>
        {events.loading && <Skeleton className="h-32" />}
        {!events.loading && eventItems.length === 0 && (
          <EmptyState icon={Users} title="No institutional events yet" detail="Create one above to fan out a proposal to your faculty." />
        )}
        <div className="space-y-2.5">
          {eventItems.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] p-4">
              <div>
                <h4 className="font-bold text-[var(--brand-ink)]">{item.title}</h4>
                <p className="text-xs font-medium text-[var(--brand-muted)]">{item.organization}</p>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold">
                <span className="chip chip-mint !border-0"><CheckCircle2 className="h-3 w-3" /> {item.confirmed_count} confirmed</span>
                <span className="chip chip-butter !border-0"><Clock className="h-3 w-3" /> {item.pending_count} pending</span>
                {item.declined_count > 0 && <span className="chip chip-rose !border-0"><XCircle className="h-3 w-3" /> {item.declined_count} declined</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
