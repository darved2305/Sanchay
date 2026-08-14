import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Check, ChevronDown, ChevronUp, Loader2, Plus, Send, UserPlus } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Field, Notice, PageHeader } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

const STAGE_LABELS = {
  discovered: 'Discovered', interested: 'Interested', eligibility_check: 'Eligibility Check',
  team_formation: 'Team Formation', preparing: 'Preparing', internal_review: 'Internal Review',
  ready_to_submit: 'Ready to Submit', submitted: 'Submitted', awarded: 'Awarded', rejected: 'Rejected',
  active: 'Active', completed: 'Completed', archived: 'Archived',
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);
const ELIGIBILITY_LABEL = { eligible: 'ELIGIBLE', possibly_eligible: 'POSSIBLY ELIGIBLE', not_currently_eligible: 'NOT CURRENTLY ELIGIBLE' };

function OpportunityCard({ opportunity, onStarted }) {
  const [eligibility, setEligibility] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const checkEligibility = async () => {
    setBusy(true); setError('');
    try { setEligibility(payloadData(await api.grantops.eligibility(opportunity.id))); }
    catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };
  const start = async () => {
    setBusy(true); setError('');
    try { await api.grantops.startWorkspace(opportunity.id); invalidateQueries(['grantops']); onStarted?.(); }
    catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  return (
    <motion.div {...cardEnter} className="app-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold text-[var(--brand-ink)]">{opportunity.title}</h3>
          <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">
            {opportunity.agency}{opportunity.deadline ? ` · Deadline ${opportunity.deadline}` : ''}{opportunity.amount ? ` · ${opportunity.amount}` : ''}
          </p>
          {opportunity.disciplines?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {opportunity.disciplines.map((d) => <span key={d} className="chip chip-lavender !border-0 !text-[10px]">{d}</span>)}
            </div>
          )}
        </div>
      </div>
      {error && <Notice tone="error" className="mt-2">{error}</Notice>}
      {eligibility && (
        <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--brand-surface-muted)] p-3">
          <p className={`text-xs font-extrabold uppercase tracking-wide ${eligibility.status === 'eligible' ? 'text-[var(--brand-success)]' : eligibility.status === 'possibly_eligible' ? 'text-[var(--brand-sky-ink)]' : 'text-[var(--brand-rose-ink)]'}`}>
            {ELIGIBILITY_LABEL[eligibility.status]}
          </p>
          <ul className="mt-1 space-y-0.5">
            {eligibility.reasons.map((reason) => <li key={reason} className="text-xs font-medium text-[var(--brand-muted)]">{reason}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={checkEligibility} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Check eligibility</Button>
        <Button variant="primary" size="sm" onClick={start} disabled={busy}>Start workspace</Button>
      </div>
    </motion.div>
  );
}

function AddOpportunityForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', agency: '', deadline: '', amount: '', disciplines: '', required_documents: '', min_designation: '', requires_phd: false, min_publications: '', min_grants: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target?.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.grantops.createOpportunity({
        title: form.title,
        agency: form.agency || null,
        deadline: form.deadline || null,
        amount: form.amount || null,
        disciplines: form.disciplines ? form.disciplines.split(',').map((s) => s.trim()).filter(Boolean) : [],
        required_documents: form.required_documents ? form.required_documents.split(',').map((s) => s.trim()).filter(Boolean) : [],
        eligibility_rules: {
          min_designation: form.min_designation || null,
          requires_phd: form.requires_phd,
          min_publications: form.min_publications ? Number(form.min_publications) : null,
          min_grants: form.min_grants ? Number(form.min_grants) : null,
        },
      });
      invalidateQueries(['grantops']);
      setForm({ title: '', agency: '', deadline: '', amount: '', disciplines: '', required_documents: '', min_designation: '', requires_phd: false, min_publications: '', min_grants: '' });
      setOpen(false);
      onCreated?.();
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  if (!open) return <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add a grant</Button>;
  return (
    <form onSubmit={submit} className="app-surface space-y-3 p-5">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><input required value={form.title} onChange={set('title')} className="input" /></Field>
        <Field label="Agency" optional><input value={form.agency} onChange={set('agency')} className="input" /></Field>
        <Field label="Deadline" optional><input type="date" value={form.deadline} onChange={set('deadline')} className="input" /></Field>
        <Field label="Amount" optional><input value={form.amount} onChange={set('amount')} className="input" /></Field>
        <Field label="Disciplines" hint="comma-separated" optional><input value={form.disciplines} onChange={set('disciplines')} className="input" /></Field>
        <Field label="Required documents" hint="comma-separated, e.g. CV, Research Proposal" optional><input value={form.required_documents} onChange={set('required_documents')} className="input" /></Field>
        <Field label="Minimum designation" optional>
          <select value={form.min_designation} onChange={set('min_designation')} className="input">
            <option value="">Any</option>
            <option>Assistant Professor</option><option>Associate Professor</option><option>Professor</option>
          </select>
        </Field>
        <Field label="Minimum publications" optional><input type="number" min="0" value={form.min_publications} onChange={set('min_publications')} className="input" /></Field>
        <Field label="Minimum prior grants" optional><input type="number" min="0" value={form.min_grants} onChange={set('min_grants')} className="input" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-ink)]">
        <input type="checkbox" checked={form.requires_phd} onChange={set('requires_phd')} /> Requires a completed PhD
      </label>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add grant</Button>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function WorkspaceDetail({ id }) {
  const detail = useApiQuery(['grantops', 'workspace', id], () => api.grantops.workspace(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const suggestions = useApiQuery(['grantops', 'team', id], () => api.grantops.teamSuggestions(id), { enabled: detail.data?.stage === 'team_formation' });

  const w = detail.data;
  if (detail.loading || !w) return <p className="p-4 text-sm text-[var(--brand-muted)]">Loading…</p>;

  const setStage = async (stage) => {
    setBusy(true); setError('');
    try { await api.grantops.updateStage(id, { stage }); invalidateQueries(['grantops']); }
    catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };
  const addTask = async (e) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    try { await api.grantops.addTask(id, { title: taskTitle }); setTaskTitle(''); invalidateQueries(['grantops']); }
    catch (err) { setError(runtimeConfigMessage(err)); }
  };
  const toggleTask = async (taskId) => { try { await api.grantops.toggleTask(taskId); invalidateQueries(['grantops']); } catch (err) { setError(runtimeConfigMessage(err)); } };
  const invite = async (profileId) => { try { await api.grantops.inviteMember(id, { profile_id: profileId }); invalidateQueries(['grantops']); } catch (err) { setError(runtimeConfigMessage(err)); } };
  const markAwarded = async () => {
    setBusy(true); setError('');
    try {
      const res = payloadData(await api.grantops.award(id, {}));
      await api.activities.confirm(res.activity_id, {});
      invalidateQueries(['grantops']); invalidateQueries(['activities']); invalidateQueries(['dashboard', 'faculty']);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 border-t border-[var(--brand-border-soft)] p-5">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--brand-muted)]">Stage</span>
        <select value={w.stage} onChange={(e) => setStage(e.target.value)} disabled={busy} className="input !w-auto !py-1.5">
          {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        {w.stage !== 'awarded' && w.stage !== 'rejected' && (
          <Button variant="success" size="sm" onClick={markAwarded} disabled={busy}><Award className="h-3.5 w-3.5" /> Record award</Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-control)] bg-[var(--brand-surface-muted)] p-3">
          <p className={`text-xs font-extrabold uppercase tracking-wide ${w.eligibility.status === 'eligible' ? 'text-[var(--brand-success)]' : w.eligibility.status === 'possibly_eligible' ? 'text-[var(--brand-sky-ink)]' : 'text-[var(--brand-rose-ink)]'}`}>
            {ELIGIBILITY_LABEL[w.eligibility.status]}
          </p>
          <ul className="mt-1 space-y-0.5">{w.eligibility.reasons.map((r) => <li key={r} className="text-xs font-medium text-[var(--brand-muted)]">{r}</li>)}</ul>
        </div>
        <div className="rounded-[var(--radius-control)] bg-[var(--brand-surface-muted)] p-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand-ink)]">Document readiness — {w.readiness.ready_count} / {w.readiness.total}</p>
          {w.readiness.ready.map((d) => <p key={d} className="mt-1 text-xs font-semibold text-[var(--brand-success)]">✓ {d}</p>)}
          {w.readiness.missing.map((d) => <p key={d} className="mt-1 text-xs font-semibold text-[var(--brand-rose-ink)]">! {d}</p>)}
        </div>
      </div>

      <div>
        <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand-muted)]">Tasks</p>
        <div className="mt-1.5 space-y-1.5">
          {(w.tasks || []).map((t) => (
            <button key={t.id} type="button" onClick={() => toggleTask(t.id)} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] p-2 text-left text-sm">
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${t.done ? 'border-[var(--brand-success)] bg-[var(--brand-success)]' : 'border-[var(--brand-border)]'}`}>{t.done && <Check className="h-3 w-3 text-white" />}</span>
              <span className={t.done ? 'text-[var(--brand-muted)] line-through' : 'text-[var(--brand-ink)]'}>{t.title}</span>
              {t.due_date && <span className="ml-auto text-xs text-[var(--brand-subtle)]">{t.due_date}</span>}
            </button>
          ))}
        </div>
        <form onSubmit={addTask} className="mt-2 flex gap-2">
          <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Add a task…" className="input !py-1.5 flex-1" />
          <Button variant="secondary" size="sm" type="submit">Add</Button>
        </form>
      </div>

      {w.related_emails?.length > 0 && (
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand-muted)]">Related emails</p>
          {w.related_emails.map((mail) => <p key={mail.id} className="mt-1 text-xs font-medium text-[var(--brand-ink)]">{mail.subject} — {mail.sender}</p>)}
        </div>
      )}

      {w.stage === 'team_formation' && (
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand-muted)]">Suggested collaborators</p>
          <div className="mt-1.5 space-y-2">
            {listItems(suggestions.data).map((person) => (
              <div key={person.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] p-2">
                <div>
                  <p className="text-sm font-bold text-[var(--brand-ink)]">{person.full_name}</p>
                  <p className="text-xs font-medium text-[var(--brand-muted)]">{person.reasons.join(' · ')}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => invite(person.id)}><UserPlus className="h-3.5 w-3.5" /> Invite</Button>
              </div>
            ))}
            {listItems(suggestions.data).length === 0 && !suggestions.loading && <p className="text-xs text-[var(--brand-muted)]">No open-to-collaboration matches found yet.</p>}
          </div>
        </div>
      )}

      {w.members?.length > 0 && (
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand-muted)]">Team</p>
          {w.members.map((m) => <p key={m.id} className="mt-1 text-xs font-medium text-[var(--brand-ink)]">{m.full_name} — {m.status}{m.role ? ` (${m.role})` : ''}</p>)}
        </div>
      )}
    </div>
  );
}

function WorkspaceCard({ workspace }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div {...cardEnter} className="app-surface overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 p-5 text-left">
        <div>
          <h3 className="text-base font-extrabold text-[var(--brand-ink)]">{workspace.title}</h3>
          <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">{workspace.agency}{workspace.deadline ? ` · Deadline ${workspace.deadline}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip chip-sky !border-0">{STAGE_LABELS[workspace.stage]}</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>
      {open && <WorkspaceDetail id={workspace.id} />}
    </motion.div>
  );
}

export default function GrantOpsPage() {
  const [tab, setTab] = useState('workspaces');
  const opportunities = useApiQuery(['grantops', 'opportunities'], () => api.grantops.opportunities());
  const workspaces = useApiQuery(['grantops', 'workspaces'], () => api.grantops.workspaces());

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="GrantOps"
        subtitle="From opportunity discovery to eligibility, team formation, submission, and award — one workspace per grant."
        actions={
          <div className="flex gap-1 rounded-[var(--radius-control)] bg-[var(--brand-surface-muted)] p-1">
            {['workspaces', 'opportunities'].map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-bold ${tab === t ? 'bg-[var(--brand-surface)] text-[var(--brand-primary-hover)] shadow-sm' : 'text-[var(--brand-muted)]'}`}>
                {t === 'workspaces' ? 'My Workspaces' : 'Opportunities'}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'opportunities' && (
        <div className="space-y-4">
          <AddOpportunityForm onCreated={() => invalidateQueries(['grantops'])} />
          {!opportunities.loading && listItems(opportunities.data).length === 0 && (
            <EmptyState icon={Send} title="No grant opportunities yet" detail="Add one manually, or send a funding email here from your Action Inbox." />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {listItems(opportunities.data).map((o) => <OpportunityCard key={o.id} opportunity={o} onStarted={() => setTab('workspaces')} />)}
          </div>
        </div>
      )}

      {tab === 'workspaces' && (
        <div className="space-y-3">
          {!workspaces.loading && listItems(workspaces.data).length === 0 && (
            <EmptyState icon={Send} title="No active grant workspaces" detail="Start one from the Opportunities tab, or send a funding email here from your Action Inbox." />
          )}
          {listItems(workspaces.data).map((w) => <WorkspaceCard key={w.id} workspace={w} />)}
        </div>
      )}
    </motion.div>
  );
}
