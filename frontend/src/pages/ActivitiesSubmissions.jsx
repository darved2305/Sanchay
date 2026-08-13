import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Archive, CalendarCheck, CheckCircle2, Clock3, Edit3, FileCheck2, FlaskConical,
  Loader2, Plus, RefreshCw, Search, ShieldCheck, Upload, XCircle,
} from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { ACTIVITY_CATEGORIES, categoryLabel } from '../lib/constants';
import { invalidateQueries, useApiQuery } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';
import {
  Button, CategoryChip, EmptyState, FilterChip, Notice, Skeleton, StatusBadge,
} from '../components/ui';
import { cardEnter, pageEnter } from '../lib/motion';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'teaching', label: 'Teaching' },
  { id: 'research', label: 'Research' },
  { id: 'publication', label: 'Publication' },
  { id: 'mentorship', label: 'Mentorship' },
  { id: 'workshop_fdp', label: 'Workshop / FDP' },
  { id: 'committee', label: 'Committee' },
];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function flattenCandidates(payload) {
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload?.buckets && typeof payload.buckets === 'object') return Object.values(payload.buckets).flatMap((items) => Array.isArray(items) ? items : []);
  return listItems(payload);
}

function EvidenceState({ item }) {
  if (item.evidence_status === 'attached' || item.evidence?.length > 0) {
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-mint-ink)]"><CheckCircle2 className="h-4 w-4" />Attached</span>;
  }
  if (item.evidence_status === 'none_needed') {
    return <span className="text-xs font-semibold text-[var(--brand-subtle)]">Not needed</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-butter-ink)]"><Clock3 className="h-4 w-4" />Pending</span>;
}

export default function ActivitiesSubmissions({ onOpenAddModal, setCurrentView, initialQuery = '' }) {
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [evidenceStatus, setEvidenceStatus] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const queryKey = useMemo(() => ['activities', { category, q: query, academic_year: academicYear, evidence_status: evidenceStatus }], [academicYear, category, evidenceStatus, query]);
  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  const activities = useApiQuery(queryKey, () => api.activities.list({ category, q: query, academic_year: academicYear, evidence_status: evidenceStatus, limit: 50 }));
  const candidates = useApiQuery(['publications', 'candidates'], () => api.publications.candidates('pending'));
  const eventProposals = useApiQuery(['activities', 'proposals', 'events'], () => api.eventProposals.list());
  const items = listItems(activities.data);
  const candidateItems = flattenCandidates(candidates.data);
  const eventProposalItems = listItems(eventProposals.data);
  const categoryCounts = useMemo(() => items.reduce((counts, item) => ({ ...counts, [item.category]: (counts[item.category] || 0) + 1 }), {}), [items]);
  const hasAnyData = items.length > 0 || candidateItems.length > 0;

  const mutate = async (key, action) => {
    setActionBusy(key);
    setActionError('');
    try {
      await action();
      invalidateQueries(['activities']);
      invalidateQueries(['dashboard', 'faculty']);
      invalidateQueries(['publications', 'candidates']);
    } catch (error) {
      setActionError(runtimeConfigMessage(error));
    } finally {
      setActionBusy('');
    }
  };

  const archive = (item) => mutate(`archive-${item.id}`, () => api.activities.archive(item.id));
  const confirmCandidate = (candidate) => mutate(`confirm-${candidate.id}`, () => api.publications.confirm(candidate.id));
  const rejectCandidate = (candidate) => mutate(`reject-${candidate.id}`, () => api.publications.reject(candidate.id));
  const confirmEventProposal = (proposal) => mutate(`event-confirm-${proposal.participant_id}`, async () => {
    await api.eventProposals.confirm(proposal.participant_id);
    invalidateQueries(['activities', 'proposals', 'events']);
  });
  const declineEventProposal = (proposal) => mutate(`event-decline-${proposal.participant_id}`, async () => {
    await api.eventProposals.decline(proposal.participant_id);
    invalidateQueries(['activities', 'proposals', 'events']);
  });
  const syncPublications = () => mutate('sync-publications', async () => {
    const result = payloadData(await api.publications.sync());
    if (result?.job_id) setActionError('Publication sync started. Candidates will appear here when the source sync completes.');
  });

  const openAdd = (activity = null) => {
    onOpenAddModal?.(activity);
  };

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--brand-subtle)]">
            <button type="button" onClick={() => setCurrentView('dashboard')} className="transition hover:text-[var(--brand-ink)]">Dashboard</button>
            <span>/</span>
            <span className="font-semibold text-[var(--brand-primary-hover)]">Activities &amp; Record</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">Activities &amp; Submissions</h1>
          <p className="mt-1.5 text-[15px] font-medium text-[var(--brand-muted)]">Browse, add and manage your academic record from the live faculty API.</p>
        </div>
        <Button variant="primary" size="lg" onClick={() => openAdd()} className="shrink-0">
          <Plus className="h-4 w-4" /> Add Activity
        </Button>
      </div>

      {actionError && (
        <Notice tone="error">
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss message" className="shrink-0"><XCircle className="h-4 w-4" /></button>
        </Notice>
      )}

      {/* Toolbar */}
      <div className="app-surface flex flex-wrap items-center gap-2 !rounded-[var(--radius-card)] p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, organization or notes" className="input !py-2 !pl-9" aria-label="Search activities" />
        </div>
        <input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="Academic year" className="input !w-36 !py-2" aria-label="Academic year filter" />
        <select value={evidenceStatus} onChange={(event) => setEvidenceStatus(event.target.value)} className="input !w-auto !py-2" aria-label="Evidence status filter">
          <option value="">All evidence</option>
          <option value="attached">Evidence attached</option>
          <option value="pending">Evidence pending</option>
          <option value="none_needed">No evidence needed</option>
        </select>
        <button type="button" onClick={() => activities.refetch()} className="btn btn-ghost btn-sm !p-2" aria-label="Refresh activities">
          <RefreshCw className={`h-4 w-4 ${activities.loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Category filter">
        {FILTERS.map((filter) => (
          <FilterChip key={filter.id || 'all'} active={category === filter.id} onClick={() => setCategory(filter.id)} className="shrink-0">
            {filter.label}
          </FilterChip>
        ))}
      </div>

      {/* Category counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {ACTIVITY_CATEGORIES.slice(0, 7).map((item) => (
          <div key={item.id} className="app-surface !rounded-[var(--radius-card)] p-3.5">
            <CategoryChip category={item.id} label={item.label} className="max-w-full truncate !border-0 !text-[11px]" />
            <p className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--brand-ink)]">{categoryCounts[item.id] ?? 0}</p>
            <p className="text-xs font-medium text-[var(--brand-subtle)]">loaded records</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-6">
          <section className="app-surface overflow-hidden">
            <div className="flex flex-col justify-between gap-2 border-b border-[var(--brand-border-soft)] p-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Your academic record</h2>
                <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Only records returned by the backend appear here.</p>
              </div>
              <span className="chip chip-surface">{items.length} loaded</span>
            </div>
            {activities.loading && (
              <div className="space-y-3 p-6">{[1, 2, 3].map((row) => <Skeleton key={row} className="h-16 !rounded-[var(--radius-card)]" />)}</div>
            )}
            {activities.error && (
              <p className="p-6 text-sm font-semibold text-[var(--brand-rose-ink)]">
                {runtimeConfigMessage(activities.error)} <button type="button" onClick={() => activities.refetch()} className="ml-2 underline">Retry</button>
              </p>
            )}
            {!activities.loading && !activities.error && items.length === 0 && (
              <EmptyState
                icon={FileCheck2}
                title="No activities match these filters"
                detail="Add your first activity or adjust the search filters."
                action={<Button variant="primary" size="sm" onClick={() => openAdd()}>Add Activity</Button>}
              />
            )}
            {items.length > 0 && (
              <div className="table-shell">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="!px-6">Activity</th>
                      <th>Category</th>
                      <th>Date</th>
                      <th>Evidence</th>
                      <th className="!px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="!px-6">
                          <p className="font-bold text-[var(--brand-ink)]">{item.title || item.activity || 'Untitled activity'}</p>
                          <p className="mt-0.5 max-w-[320px] truncate text-xs font-medium text-[var(--brand-muted)]">{item.organization || item.description || 'No additional details'}</p>
                          <StatusBadge status={item.status || 'pending'} className="mt-2 !text-[11px]" />
                        </td>
                        <td><CategoryChip category={item.category} label={categoryLabel(item.category)} /></td>
                        <td className="whitespace-nowrap font-medium text-[var(--brand-muted)]">{formatDate(item.start_date || item.date)}</td>
                        <td><EvidenceState item={item} /></td>
                        <td className="!px-6 text-right">
                          <div className="flex justify-end gap-1">
                            <button type="button" onClick={() => openAdd(item)} className="rounded-lg p-2 text-[var(--brand-subtle)] transition hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary)]" aria-label={`Edit ${item.title || 'activity'}`}>
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => archive(item)} disabled={item.status === 'archived' || actionBusy === `archive-${item.id}`} className="rounded-lg p-2 text-[var(--brand-subtle)] transition hover:bg-[var(--brand-danger-soft)] hover:text-[var(--brand-rose-ink)] disabled:opacity-40" aria-label={`Archive ${item.title || 'activity'}`}>
                              {actionBusy === `archive-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <motion.aside {...cardEnter} className="w-full space-y-6 xl:w-[320px] xl:shrink-0">
          {eventProposalItems.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-[var(--brand-mint-strong)] bg-[var(--brand-mint)] p-6">
              <span className="chip chip-mint !border-[var(--brand-surface)]"><CalendarCheck className="h-3.5 w-3.5" />Shared academic facts</span>
              <h2 className="mt-3 text-xl font-extrabold text-[var(--brand-ink)]">Your institution added you</h2>
              <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--brand-muted)]">
                Your admin recorded this event. Confirm your role to add it to your record, or decline if it isn't yours.
              </p>
              <div className="mt-4 space-y-3">
                {eventProposalItems.map((proposal) => (
                  <div key={proposal.participant_id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3.5">
                    <p className="font-bold text-[var(--brand-ink)]">{proposal.event_title}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--brand-muted)]">
                      {proposal.role}{proposal.organization ? ` · ${proposal.organization}` : ''}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="success" size="sm" className="flex-1" onClick={() => confirmEventProposal(proposal)} disabled={actionBusy === `event-confirm-${proposal.participant_id}`}>
                        {actionBusy === `event-confirm-${proposal.participant_id}` ? 'Saving…' : 'Confirm'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => declineEventProposal(proposal)} disabled={actionBusy === `event-decline-${proposal.participant_id}`}>
                        {actionBusy === `event-decline-${proposal.participant_id}` ? '…' : 'Decline'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-[var(--radius-card)] border border-[var(--brand-lavender-strong)] bg-[var(--brand-primary-softer)] p-6">
            <span className="chip chip-primary !border-[var(--brand-surface)]"><FlaskConical className="h-3.5 w-3.5" />Real publication sync</span>
            <h2 className="mt-3 text-xl font-extrabold text-[var(--brand-ink)]">ORCID, OpenAlex &amp; Crossref</h2>
            <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--brand-muted)]">
              Sync candidates from the configured publication sources. Nothing is added until you confirm it.
            </p>
            <Button variant="primary" className="mt-4 w-full" onClick={syncPublications} disabled={actionBusy === 'sync-publications'}>
              {actionBusy === 'sync-publications' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync publication sources
            </Button>
            {candidates.error && <p className="mt-3 text-xs font-semibold text-[var(--brand-rose-ink)]">{runtimeConfigMessage(candidates.error)}</p>}
            {candidateItems.length > 0 && (
              <div className="mt-4 space-y-3">
                {candidateItems.map((candidate) => {
                  const publication = candidate.publication || candidate;
                  return (
                    <div key={candidate.id} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3.5">
                      <p className="font-bold text-[var(--brand-ink)]">{publication.title || publication.work_title || 'Untitled candidate'}</p>
                      <p className="mt-1 text-xs font-medium text-[var(--brand-muted)]">
                        {candidate.source || candidate.provider || 'Publication source'}{publication.doi ? ` · DOI ${publication.doi}` : ''}{publication.year ? ` · ${publication.year}` : ''}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button variant="success" size="sm" className="flex-1" onClick={() => confirmCandidate(candidate)} disabled={actionBusy === `confirm-${candidate.id}`}>
                          {actionBusy === `confirm-${candidate.id}` ? 'Saving…' : 'Confirm'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => rejectCandidate(candidate)} disabled={actionBusy === `reject-${candidate.id}`}>
                          {actionBusy === `reject-${candidate.id}` ? '…' : 'Reject'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!candidates.loading && candidateItems.length === 0 && (
              <p className="mt-4 text-xs font-semibold text-[var(--brand-lavender-ink)]">No publication candidates are waiting for review.</p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-[var(--brand-butter-strong)] bg-[var(--brand-butter)] p-6">
            <div className="flex items-center gap-2 text-[var(--brand-butter-ink)]">
              <Upload className="h-5 w-5" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Evidence management</h3>
            </div>
            <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--brand-muted)]">Attach proof to one or more activities from the Evidence Library.</p>
            <button type="button" onClick={() => setCurrentView('evidence')} className="mt-4 flex items-center gap-2 text-sm font-bold text-[var(--brand-primary-hover)] hover:underline">
              Open Evidence Library <ShieldCheck className="h-4 w-4" />
            </button>
          </section>

          {!hasAnyData && !activities.loading && (
            <section className="app-surface p-6 text-center">
              <p className="text-sm font-semibold text-[var(--brand-muted)]">Your record is ready for its first real activity.</p>
            </section>
          )}
        </motion.aside>
      </div>
    </motion.div>
  );
}

