import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clipboard, Inbox, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader } from '../components/ui';
import { pageEnter, cardEnter } from '../lib/motion';

const URGENCY_STYLE = {
  high: 'chip-rose',
  medium: 'chip-butter',
  low: 'chip-sky',
};

const CATEGORY_LABELS = {
  research_collaboration: 'Research Collaboration',
  grant_opportunity: 'Grant Opportunity',
  publication_journal: 'Publication / Journal',
  reviewer_invitation: 'Reviewer Invitation',
  conference: 'Conference',
  invited_talk: 'Invited Talk',
  seminar: 'Seminar',
  fdp_workshop: 'FDP / Workshop',
  student_mentorship: 'Student / Mentorship',
  committee_work: 'Committee Work',
  administrative_request: 'Administrative Request',
  deadline: 'Deadline',
  academic_opportunity: 'Academic Opportunity',
  other: 'Academic Mail',
};

async function pollSyncJob(jobId, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = payloadData(await api.actionInbox.syncJob(jobId));
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
  }
  throw new Error('Inbox sync is taking longer than expected. Check back shortly.');
}

function ReplyPanel({ item, onClose }) {
  const [replyType, setReplyType] = useState('accept');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const text = item.generated_replies?.[replyType] || '';

  const request = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = payloadData(await api.actionInbox.draft(item.id, { reply_type: replyType }));
      setResult(response);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setResult({ text, fallback_reason: 'Copied to clipboard.' }); } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-4">
      <div className="flex flex-wrap gap-2">
        {['accept', 'conditional', 'decline'].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => { setReplyType(type); setResult(null); }}
            className={`chip !cursor-pointer !border-0 ${replyType === type ? 'chip-lavender' : 'bg-[var(--brand-surface-muted)]'}`}
          >
            {type === 'accept' ? 'Accept / Positive' : type === 'conditional' ? 'Conditional / Modify' : 'Decline'}
          </button>
        ))}
      </div>
      <pre className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-[var(--brand-primary-softer)] p-3 text-sm font-medium text-[var(--brand-ink)]">{text}</pre>
      {error && <Notice tone="error" className="mt-2">{error}</Notice>}
      {result && <Notice tone="success" className="mt-2">{result.fallback_reason || (result.gmail_draft_id ? 'Gmail draft created.' : 'Ready.')}</Notice>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={request} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Create Gmail draft
        </Button>
        <Button variant="secondary" size="sm" onClick={copy}><Clipboard className="h-3.5 w-3.5" /> Copy to clipboard</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function InboxItemCard({ item, onAct, busy }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div {...cardEnter} className="app-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip chip-lavender !border-0 !text-[11px]">{CATEGORY_LABELS[item.category] || item.category}</span>
            <span className={`chip ${URGENCY_STYLE[item.urgency] || 'chip-sky'} !border-0 !text-[11px] uppercase`}>{item.urgency} priority</span>
          </div>
          <h3 className="mt-2 truncate text-lg font-extrabold text-[var(--brand-ink)]">{item.subject}</h3>
          <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">{item.sender}{item.deadline ? ` · Deadline ${item.deadline}` : ''}</p>
          <p className="mt-2 text-sm font-medium text-[var(--brand-ink)]">{item.summary}</p>
        </div>
      </div>

      <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--brand-mint)] p-3">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand-mint-ink)]">Why this matters</p>
        <ul className="mt-1 space-y-1">
          {(item.relevance_reasons || []).map((reason) => (
            <li key={reason} className="text-xs font-semibold text-[var(--brand-mint-ink)]">&#10003; {reason}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="success" size="sm" onClick={() => onAct(item.id, 'accept')} disabled={busy}><Check className="h-3.5 w-3.5" /> Accept</Button>
        <Button variant="secondary" size="sm" onClick={() => onAct(item.id, 'save')} disabled={busy}>Save for later</Button>
        {(item.category === 'grant_opportunity') && (
          <Button variant="soft" size="sm" onClick={() => onAct(item.id, 'sent_to_grantops')} disabled={busy}>Send to GrantOps</Button>
        )}
        {(item.category === 'research_collaboration') && (
          <Button variant="soft" size="sm" onClick={() => onAct(item.id, 'start_collaboration')} disabled={busy}>Start Collaboration</Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onAct(item.id, 'decline')} disabled={busy}>Decline</Button>
        <Button variant="ghost" size="sm" onClick={() => onAct(item.id, 'ignore')} disabled={busy}><X className="h-3.5 w-3.5" /> Ignore</Button>
        <Button variant="secondary" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide replies' : 'Draft a reply'}</Button>
      </div>

      {expanded && <ReplyPanel item={item} onClose={() => setExpanded(false)} />}
    </motion.div>
  );
}

export default function ActionInboxPage() {
  const inbox = useApiQuery(['action-inbox'], () => api.actionInbox.list({}));
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const items = listItems(inbox.data);

  const runSync = async () => {
    setSyncing(true); setError(''); setSyncNotice('');
    try {
      const started = payloadData(await api.actionInbox.sync());
      const job = await pollSyncJob(started.job_id);
      if (job.status === 'failed') {
        setError(job.error || 'Sync could not complete.');
      } else {
        setSyncNotice(`${job.result?.actionable ?? 0} actionable item(s) found (${job.result?.mode || 'sync'}).`);
        invalidateQueries(['action-inbox']);
      }
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setSyncing(false); }
  };

  const act = async (id, action) => {
    setBusyId(id); setError('');
    try {
      await api.actionInbox.act(id, action);
      invalidateQueries(['action-inbox']);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusyId(''); }
  };

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Faculty Action Inbox"
        subtitle="Actionable academic mail, extracted and prioritized — never opaque, always explainable."
        actions={
          <Button variant="primary" onClick={runSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync mailbox
          </Button>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {syncNotice && <Notice tone="success">{syncNotice}</Notice>}

      {inbox.error && (
        <Notice tone="error">{runtimeConfigMessage(inbox.error)}</Notice>
      )}
      {!inbox.loading && !inbox.error && items.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No actionable mail right now"
          detail="Connect Gmail from Reconstruct My Year, then sync your mailbox to find hidden academic opportunities and deadlines."
        />
      )}
      <div className="space-y-4">
        {items.map((item) => (
          <InboxItemCard key={item.id} item={item} onAct={act} busy={busyId === item.id} />
        ))}
      </div>
    </motion.div>
  );
}
