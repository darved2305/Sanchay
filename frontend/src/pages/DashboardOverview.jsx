import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Bell, CheckCircle2, Clock3, FileCheck, Plus, RefreshCw, Upload } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { useApiQuery } from '../lib/queryCache';
import { runtimeConfigMessage } from '../lib/config';
import { categoryLabel, CATEGORY_COLOR_TOKENS } from '../lib/constants';
import { Button, Card, ErrorState, ProgressBar, Skeleton, StatusBadge } from '../components/ui';
import { cardEnter, pageEnter, staggerParent } from '../lib/motion';

function displayName(data, profile) {
  return data?.full_name || data?.name || profile?.full_name || profile?.name || 'Faculty member';
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function asPercent(value) {
  if (typeof value === 'number') return Math.max(0, Math.min(100, value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.replace('%', ''));
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));
  }
  return null;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 !rounded-[var(--radius-card)]" />
        <Skeleton className="h-64 !rounded-[var(--radius-card)]" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Skeleton className="h-48 !rounded-[var(--radius-card)]" />
        <Skeleton className="h-48 !rounded-[var(--radius-card)]" />
        <Skeleton className="h-48 !rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

export default function DashboardOverview({ setCurrentView, onOpenAddModal, profile }) {
  const dashboard = useApiQuery(['dashboard', 'faculty'], () => api.dashboardFaculty());
  const data = payloadData(dashboard.data) || {};
  const appraisal = data.appraisal || {};
  const readinessValue = asPercent(appraisal.readiness ?? data.readiness ?? appraisal.completion);
  const recents = data.recent_activities || data.recentActivities || [];
  const deadlines = data.deadlines || [];
  const inbox = data.inbox || [];
  const categoryCounts = useMemo(() => {
    const payload = payloadData(dashboard.data) || {};
    return payload.category_counts || payload.categoryCounts || {};
  }, [dashboard.data]);
  const pendingEvidence = data.pending_evidence || data.pendingEvidence || [];
  const categoryEntries = useMemo(() => Object.entries(categoryCounts).filter(([, value]) => Number(value) > 0), [categoryCounts]);
  const totalCategories = categoryEntries.reduce((total, [, value]) => total + Number(value), 0);
  const hasRecord = recents.length > 0 || categoryEntries.length > 0 || inbox.length > 0;

  if (dashboard.loading && !dashboard.data) return <OverviewSkeleton />;

  if (dashboard.error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">Faculty overview</h1>
        <Card><ErrorState title="We could not load your overview" detail={runtimeConfigMessage(dashboard.error)} onRetry={dashboard.refetch} /></Card>
      </div>
    );
  }

  return (
    <motion.div {...pageEnter} className="space-y-7 pb-12">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">{greeting()}, {displayName(data, profile)}</h1>
          <p className="mt-1.5 text-[15px] font-medium text-[var(--brand-muted)]">Here is what needs your attention today.</p>
        </div>
        <div className="flex items-center gap-2.5 self-start rounded-[var(--radius-pill)] border border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 py-2 shadow-[var(--shadow-soft)] sm:self-auto">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand-success)]" aria-hidden="true" />
          <span className="text-sm font-bold text-[var(--brand-ink)]">{appraisal.cycle || data.current_cycle || 'Current appraisal cycle'}</span>
          {appraisal.status && <StatusBadge status={appraisal.status} />}
        </div>
      </div>

      {/* New-user setup banner */}
      {!hasRecord && (
        <div className="rounded-[var(--radius-panel)] border border-[var(--brand-lavender-strong)] bg-[var(--brand-primary-softer)] p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <span className="chip chip-primary">Your record is ready</span>
              <h2 className="mt-3 text-xl font-extrabold text-[var(--brand-ink)]">Start with one real contribution</h2>
              <p className="mt-1 max-w-xl text-sm font-medium text-[var(--brand-muted)]">
                Add an activity, upload evidence, or update your profile. Counts and readiness appear as your data arrives.
              </p>
            </div>
            <Button variant="primary" className="shrink-0" onClick={() => onOpenAddModal?.()}>
              <Plus className="h-4 w-4" /> Add Activity
            </Button>
          </div>
        </div>
      )}

      {/* Readiness + inbox */}
      <motion.div {...staggerParent} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <motion.section {...cardEnter} className="app-surface flex flex-col justify-between p-6 lg:col-span-7">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Appraisal readiness</h2>
                <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Live status for the current cycle.</p>
              </div>
              <span className="icon-chip bg-[var(--brand-primary-soft)] text-[var(--brand-primary-hover)]"><FileCheck className="h-5 w-5" /></span>
            </div>
            {readinessValue === null ? (
              <p className="mt-10 text-sm font-semibold text-[var(--brand-muted)]">Readiness has not been calculated yet.</p>
            ) : (
              <div className="mt-7">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-5xl font-extrabold tracking-tight text-[var(--brand-ink)]">{Math.round(readinessValue)}%</span>
                  <StatusBadge status={appraisal.status || 'draft'} />
                </div>
                <ProgressBar value={readinessValue} className="mt-4" />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('appraisal')}
            className="mt-7 flex items-center gap-2 border-t border-[var(--brand-border-soft)] pt-4 text-sm font-bold text-[var(--brand-primary-hover)] transition hover:underline"
          >
            Open Appraisal <ArrowRight className="h-4 w-4" />
          </button>
        </motion.section>

        <motion.section {...cardEnter} className="rounded-[var(--radius-card)] border border-[var(--brand-butter-strong)] bg-[var(--brand-butter)] p-6 lg:col-span-5">
          <div className="flex items-center gap-2 text-[var(--brand-butter-ink)]">
            <Bell className="h-5 w-5" />
            <h2 className="text-xs font-bold uppercase tracking-wider">Academic inbox</h2>
          </div>
          {inbox.length === 0 ? (
            <div className="mt-8">
              <h3 className="text-xl font-extrabold text-[var(--brand-ink)]">Nothing needs your attention</h3>
              <p className="mt-2 text-sm font-medium text-[var(--brand-muted)]">New proposals, evidence matches and review updates will appear here.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {inbox.slice(0, 4).map((item, index) => (
                <button
                  key={item.id || `${item.kind}-${index}`}
                  type="button"
                  onClick={() => item.link_path ? window.location.assign(item.link_path) : setCurrentView('appraisal')}
                  className="flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-3 text-left transition hover:border-[var(--brand-lavender-strong)] hover:bg-[var(--brand-primary-softer)]"
                >
                  <span>
                    <p className="font-bold text-[var(--brand-ink)]">{item.text || item.title || item.kind || 'Review item'}</p>
                    <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">{item.count ?? 1} item{Number(item.count) === 1 ? '' : 's'}</p>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
                </button>
              ))}
            </div>
          )}
        </motion.section>
      </motion.div>

      {/* Deadlines / pending evidence / recents */}
      <motion.div {...staggerParent} className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <motion.section {...cardEnter} className="app-surface flex flex-col p-6">
          <div className="flex items-center gap-2.5">
            <span className="icon-chip !h-8 !w-8 chip-sky"><Clock3 className="h-4 w-4" /></span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Upcoming deadlines</h3>
          </div>
          <div className="mt-5 flex-1 space-y-3">
            {deadlines.length === 0 ? (
              <p className="text-sm font-medium text-[var(--brand-muted)]">No deadlines are currently returned.</p>
            ) : deadlines.slice(0, 4).map((item, index) => (
              <div key={item.id || `${item.title}-${index}`} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3">
                <p className="font-bold text-[var(--brand-ink)]">{item.title || item.name || 'Deadline'}</p>
                <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">{formatDate(item.due_at || item.deadline || item.date)}{item.subtitle ? ` · ${item.subtitle}` : ''}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section {...cardEnter} className="app-surface flex flex-col p-6">
          <div className="flex items-center gap-2.5">
            <span className="icon-chip !h-8 !w-8 chip-butter"><Upload className="h-4 w-4" /></span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Pending evidence</h3>
          </div>
          <div className="mt-5 flex-1 space-y-3">
            {pendingEvidence.length === 0 ? (
              <p className="text-sm font-medium text-[var(--brand-muted)]">No pending evidence returned.</p>
            ) : pendingEvidence.slice(0, 4).map((item, index) => (
              <div key={item.id || `${item.category}-${index}`} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-3">
                <div>
                  <p className="font-bold text-[var(--brand-ink)]">{item.category || item.title || 'Evidence item'}</p>
                  <p className="text-xs font-medium text-[var(--brand-muted)]">{item.count ?? 1} item{Number(item.count) === 1 ? '' : 's'}</p>
                </div>
                <Button variant="attention" size="sm" onClick={() => setCurrentView('evidence')}>Upload</Button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setCurrentView('evidence')} className="mt-5 border-t border-[var(--brand-border-soft)] pt-4 text-left text-sm font-bold text-[var(--brand-primary-hover)] hover:underline">
            Open Evidence Library
          </button>
        </motion.section>

        <motion.section {...cardEnter} className="app-surface flex flex-col p-6">
          <div className="flex items-center gap-2.5">
            <span className="icon-chip !h-8 !w-8 chip-mint"><RefreshCw className="h-4 w-4" /></span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--brand-muted)]">Recent activities</h3>
          </div>
          <div className="mt-5 flex-1 space-y-3">
            {recents.length === 0 ? (
              <p className="text-sm font-medium text-[var(--brand-muted)]">No recent activities returned.</p>
            ) : recents.slice(0, 5).map((item, index) => (
              <div key={item.id || `${item.title}-${index}`} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-success-soft)] text-[var(--brand-mint-ink)]">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-[var(--brand-ink)]">{item.title || item.activity || item.text || 'Activity'}</p>
                  <p className="mt-0.5 text-xs font-medium text-[var(--brand-subtle)]">{formatDate(item.start_date || item.created_at || item.date)}</p>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setCurrentView('activities')} className="mt-5 border-t border-[var(--brand-border-soft)] pt-4 text-left text-sm font-bold text-[var(--brand-primary-hover)] hover:underline">
            View Activities
          </button>
        </motion.section>
      </motion.div>

      {/* Contribution overview */}
      <motion.section {...cardEnter} className="app-surface p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">Contribution overview</h2>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Category counts returned for this faculty record.</p>
          </div>
          <span className="chip chip-surface">{totalCategories || 0} loaded activities</span>
        </div>
        {categoryEntries.length === 0 ? (
          <p className="mt-6 rounded-[var(--radius-control)] bg-[var(--brand-canvas-soft)] p-5 text-sm font-semibold text-[var(--brand-muted)]">
            No category counts are available yet. Add an activity to begin.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {categoryEntries.map(([key, value]) => {
              const count = Number(value);
              const percentage = totalCategories ? Math.round((count / totalCategories) * 100) : 0;
              const token = CATEGORY_COLOR_TOKENS[key] || 'surface';
              return (
                <div key={key} className="rounded-[var(--radius-control)] border border-[var(--brand-border-soft)] bg-[var(--brand-canvas-soft)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`chip chip-${token} !border-0`}>{categoryLabel(key)}</span>
                    <span className="text-sm font-extrabold text-[var(--brand-ink)]">{count}</span>
                  </div>
                  <ProgressBar value={percentage} className="mt-3 !h-2" />
                  <p className="mt-1.5 text-xs font-medium text-[var(--brand-subtle)]">{percentage}% of returned categories</p>
                </div>
              );
            })}
          </div>
        )}
      </motion.section>

      {/* Quick actions */}
      <motion.section {...cardEnter}>
        <h3 className="mb-3.5 text-xs font-bold uppercase tracking-wider text-[var(--brand-subtle)]">Quick actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button type="button" onClick={() => onOpenAddModal?.()} className="app-surface app-surface-hover p-5 text-left">
            <span className="icon-chip bg-[var(--brand-primary)] text-white"><Plus className="h-5 w-5" /></span>
            <h4 className="mt-3 text-lg font-extrabold text-[var(--brand-ink)]">Log an activity</h4>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Add a contribution to your record.</p>
          </button>
          <button type="button" onClick={() => setCurrentView('evidence')} className="app-surface app-surface-hover p-5 text-left">
            <span className="icon-chip chip-butter"><Upload className="h-5 w-5" /></span>
            <h4 className="mt-3 text-lg font-extrabold text-[var(--brand-ink)]">Add evidence</h4>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Upload proof and attach selected activities.</p>
          </button>
          <button type="button" onClick={() => setCurrentView('appraisal')} className="app-surface app-surface-hover p-5 text-left">
            <span className="icon-chip chip-mint"><FileCheck className="h-5 w-5" /></span>
            <h4 className="mt-3 text-lg font-extrabold text-[var(--brand-ink)]">Open appraisal</h4>
            <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Review the current cycle from the API.</p>
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
