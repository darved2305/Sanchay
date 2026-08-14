import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { SiGmail, SiGooglecalendar, SiGoogledrive } from 'react-icons/si';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader, ProgressBar, Skeleton } from '../components/ui';
import ProposalCard from '../components/ProposalCard';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

const SOURCE_ICONS = { gmail: SiGmail, google_calendar: SiGooglecalendar, google_drive: SiGoogledrive };
const SOURCE_LABELS = { gmail: 'Gmail', google_calendar: 'Calendar', google_drive: 'Drive' };

function currentAcademicYear() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

async function pollRun(runId, onUpdate, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const run = payloadData(await api.reconstruct.get(runId));
    onUpdate(run);
    if (run.job?.status === 'completed' || run.job?.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Reconstruction is taking longer than expected. Check back shortly.');
}

async function pollSyncJob(jobId, { intervalMs = 1200, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = payloadData(await api.reconstruct.syncJob(jobId));
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Sync is taking longer than expected. Check back shortly.');
}

export default function ReconstructMyYear({ setCurrentView }) {
  const sources = useApiQuery(['reconstruct', 'sources'], () => api.reconstruct.sources());
  // Cache-first (product expansion §58): read whatever's already persisted
  // immediately on mount -- no scan, no wait. `handleSync` below only ever
  // checks for *changes* since the last connect, never re-harvests everything.
  const cached = useApiQuery(['reconstruct', 'cached'], () => api.reconstruct.cachedCandidates());
  const [run, setRun] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [oauthBusy, setOauthBusy] = useState('');
  const [oauthNotice, setOauthNotice] = useState('');

  const sourceItems = payloadData(sources.data)?.sources || [];
  const fixtureMode = payloadData(sources.data)?.fixture_mode;
  const cachedItems = listItems(cached.data);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('google_oauth_connected');
    const oauthError = params.get('google_oauth_error');
    if (connected) {
      setOauthNotice(`${SOURCE_LABELS[connected] || connected} connected.`);
      invalidateQueries(['reconstruct', 'sources']);
    } else if (oauthError) {
      setError(`Google connection failed: ${oauthError.replace(/_/g, ' ')}`);
    }
    if (connected || oauthError) {
      params.delete('google_oauth_connected');
      params.delete('google_oauth_error');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
  }, []);

  const handleOAuth = async (provider, isConnected) => {
    setOauthBusy(provider); setError('');
    try {
      if (isConnected) {
        await api.reconstruct.oauthDisconnect(provider);
        invalidateQueries(['reconstruct', 'sources']);
      } else {
        const result = payloadData(await api.reconstruct.oauthStart(provider));
        window.location.href = result.authorize_url;
      }
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setOauthBusy('');
    }
  };

  const handleScan = async () => {
    setScanning(true); setError('');
    try {
      const started = payloadData(await api.reconstruct.start(currentAcademicYear()));
      const finished = await pollRun(started.run_id, setRun);
      setRun(finished);
      if (finished.job?.status === 'failed') {
        setError(finished.job.error || 'Reconstruction could not complete.');
        return;
      }
      const result = payloadData(await api.reconstruct.candidates(started.run_id, 'proposed'));
      setCandidates(listItems(result));
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setScanning(false);
    }
  };

  const respond = async (candidateId, action) => {
    setBusyId(candidateId);
    try {
      if (action === 'confirm') await api.reconstruct.confirmCandidate(candidateId);
      else await api.reconstruct.ignoreCandidate(candidateId);
      setCandidates((prev) => prev.filter((item) => item.id !== candidateId));
      invalidateQueries(['activities']);
      invalidateQueries(['dashboard', 'faculty']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const respondCached = async (clusterId, action) => {
    setBusyId(clusterId);
    try {
      if (action === 'confirm') await api.reconstruct.confirmCached(clusterId);
      else await api.reconstruct.ignoreCached(clusterId);
      invalidateQueries(['reconstruct', 'cached']);
      invalidateQueries(['activities']);
      invalidateQueries(['dashboard', 'faculty']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const handleSync = async () => {
    setSyncing(true); setError(''); setSyncNotice('');
    try {
      const started = payloadData(await api.reconstruct.sync());
      const job = await pollSyncJob(started.job_id);
      if (job.status === 'failed') {
        setError(job.error || 'Sync could not complete.');
      } else {
        const newCount = job.result?.new_clusters ?? 0;
        setSyncNotice(newCount > 0 ? `+${newCount} new activity candidate(s) found` : 'Up to date -- nothing new since last sync.');
        invalidateQueries(['reconstruct', 'cached']);
      }
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader
        title="Reconstruct My Year"
        subtitle="We scan your connected sources and correlate them into proposed activities. Review and confirm before anything is added."
        breadcrumb={
          <button type="button" onClick={() => setCurrentView('dashboard')} className="btn btn-ghost btn-sm mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </button>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Checking for anything new…' : 'Sync'}
            </Button>
            <Button variant="primary" onClick={handleScan} disabled={scanning}>
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning…' : 'Full rescan'}
            </Button>
          </div>
        }
      />

      {fixtureMode && (
        <Notice tone="info">Running in fixture mode -- Google sources aren't connected yet, so this run uses representative demo signals to exercise the full pipeline.</Notice>
      )}
      {oauthNotice && <Notice tone="success">{oauthNotice}</Notice>}
      {syncNotice && <Notice tone="success">{syncNotice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {sources.loading && <Skeleton className="h-20 sm:col-span-3" />}
        {!sources.loading && sourceItems.map((source) => {
          const Icon = SOURCE_ICONS[source.provider];
          const connected = source.status === 'connected';
          const notConfigured = source.status === 'not_configured';
          return (
            <div key={source.provider} className="app-surface flex flex-col gap-2 !rounded-[var(--radius-card)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="icon-chip !h-8 !w-8 chip-surface">{Icon && <Icon className="h-4 w-4" />}</span>
                  <span className="text-sm font-bold text-[var(--brand-ink)]">{SOURCE_LABELS[source.provider]}</span>
                </div>
                <span className={`chip !border-0 !px-2 !py-0 !text-[11px] ${connected ? 'chip-mint' : 'chip-surface'}`}>
                  {connected ? <CheckCircle2 className="h-3 w-3" /> : null} {connected ? 'Connected' : notConfigured ? 'Not configured' : 'Not connected'}
                </span>
              </div>
              {!notConfigured && (
                <button
                  type="button"
                  onClick={() => handleOAuth(source.provider, connected)}
                  disabled={oauthBusy === source.provider}
                  className="text-left text-xs font-bold text-[var(--brand-primary-hover)] hover:underline disabled:opacity-50"
                >
                  {oauthBusy === source.provider ? 'Working…' : connected ? 'Disconnect' : 'Connect with Google'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {scanning && (
        <motion.div {...cardEnter} className="app-surface flex flex-col items-center gap-3 !rounded-[var(--radius-panel)] p-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-primary)]" />
          <div className="w-full max-w-sm space-y-2">
            <p className="text-sm font-bold text-[var(--brand-ink)]">{run?.job?.progress_label || 'Starting scan…'}</p>
            <ProgressBar value={run?.job?.progress || 10} />
          </div>
        </motion.div>
      )}

      {/* Cache-first (product expansion §58): already-persisted candidates render
          immediately from the database, independent of `scanning`/`syncing` state. */}
      {cachedItems.length > 0 && (
        <motion.section {...cardEnter} className="app-surface space-y-4 p-6">
          <div className="border-b border-[var(--brand-border-soft)] pb-4">
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Recovered activities</h2>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Already found from your connected sources. Review and confirm.</p>
          </div>
          <div className="space-y-3">
            {cachedItems.map((item) => (
              <ProposalCard
                key={item.id}
                title={item.normalized_title}
                category={item.predicted_category}
                date={item.start_date}
                organization={item.organization}
                confidence={item.confidence}
                sourceChips={(item.sources || []).map((s) => SOURCE_LABELS[s.source] || s.source)}
                whySuggested={(item.sources || []).map((s) => s.snippet).filter(Boolean).join(' · ')}
                onConfirm={() => respondCached(item.id, 'confirm')}
                onIgnore={() => respondCached(item.id, 'ignore')}
                busy={busyId === item.id}
              />
            ))}
          </div>
        </motion.section>
      )}

      {!scanning && candidates.length > 0 && (
        <motion.section {...cardEnter} className="app-surface space-y-4 p-6">
          <div className="border-b border-[var(--brand-border-soft)] pb-4">
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Recovered activities</h2>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Review and confirm the activities to include in your academic year.</p>
          </div>
          <div className="space-y-3">
            {candidates.map((item) => (
              <ProposalCard
                key={item.id}
                title={item.title}
                category={item.category}
                date={item.start_date}
                organization={item.organization}
                confidence={item.confidence}
                sourceChips={(item.sources || []).map((s) => SOURCE_LABELS[s.source_type] || s.source_type)}
                whySuggested={(item.sources || []).map((s) => s.snippet).filter(Boolean).join(' · ')}
                onConfirm={() => respond(item.id, 'confirm')}
                onIgnore={() => respond(item.id, 'ignore')}
                busy={busyId === item.id}
              />
            ))}
          </div>
        </motion.section>
      )}

      {!scanning && run && candidates.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="No new candidates from this run"
          detail="Everything found either matches your existing record or wasn't academic. Try again after connecting more sources."
        />
      )}

      {!scanning && !run && !cached.loading && cachedItems.length === 0 && (
        <EmptyState
          icon={RefreshCw}
          title="Nothing scanned yet"
          detail="Click Sync to check connected sources for anything new, or Full rescan to scan everything from scratch."
        />
      )}
    </motion.div>
  );
}
