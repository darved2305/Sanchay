import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Download, Loader2, Target, TrendingUp, X } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader, ProgressBar, Skeleton } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

export default function CareerGrowthPage() {
  const rules = useApiQuery(['career', 'rules'], () => api.career.rules());
  const goal = useApiQuery(['career', 'goals'], () => api.career.goals());
  const progress = useApiQuery(['career', 'progress'], () => api.career.progress());
  const recommendations = useApiQuery(['career', 'recommendations'], () => api.career.recommendations());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dossierUrl, setDossierUrl] = useState('');

  const ruleItems = listItems(rules.data);
  const activeGoal = payloadData(goal.data)?.active_goal;
  const progressData = payloadData(progress.data)?.progress;
  const recommendationItems = listItems(recommendations.data);

  const handleSetGoal = async (careerRuleId) => {
    setBusy(true); setError('');
    try {
      await api.career.setGoal(careerRuleId);
      invalidateQueries(['career']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async (id) => {
    try {
      await api.career.dismissRecommendation(id);
      invalidateQueries(['career', 'recommendations']);
    } catch { /* ignore, list refresh retries */ }
  };

  const handleDossier = async () => {
    setBusy(true); setError(''); setDossierUrl('');
    try {
      const result = payloadData(await api.career.dossier());
      setDossierUrl(result.download_url);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (rules.loading && goal.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-64 !rounded-[var(--radius-panel)]" />
      </div>
    );
  }

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader title="Career Growth" subtitle="What should I do next? See exactly which promotion criteria you satisfy, what's missing, and concrete next moves." />

      {error && <Notice tone="error">{error}</Notice>}

      {!activeGoal && ruleItems.length === 0 && (
        <EmptyState
          icon={Target}
          title="No career goals are configured yet"
          detail="Your institution administrator sets up promotion rules under Admin → Institution. Once configured, pick a goal here to see your progress."
        />
      )}

      {!activeGoal && ruleItems.length > 0 && (
        <div className="app-surface space-y-4 p-6">
          <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Choose a career goal</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {ruleItems.map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => handleSetGoal(rule.id)}
                disabled={busy}
                className="app-surface app-surface-hover !rounded-[var(--radius-card)] p-4 text-left"
              >
                <h3 className="font-bold text-[var(--brand-ink)]">{rule.goal_label}</h3>
                {rule.description && <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{rule.description}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeGoal && progressData && (
        <motion.section {...cardEnter} className="app-surface space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--brand-border-soft)] pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-[var(--brand-ink)]">{activeGoal.goal_label}</h2>
              <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">Evidence completeness: {progressData.evidence_completeness}%</p>
            </div>
            <Button variant="primary" onClick={handleDossier} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Generate Promotion Dossier
            </Button>
          </div>
          {dossierUrl && (
            <Notice tone="success">
              Dossier ready. <a href={dossierUrl} target="_blank" rel="noreferrer" className="font-bold underline">Download PDF</a>
            </Notice>
          )}
          <div className="space-y-3">
            {progressData.rules.map((rule) => (
              <div key={rule.key} className="rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {rule.satisfied ? <CheckCircle2 className="h-4 w-4 text-[var(--brand-success)]" /> : <span className="h-4 w-4 rounded-full border-2 border-[var(--brand-butter-strong)]" />}
                    <span className="font-bold text-[var(--brand-ink)]">{rule.label}</span>
                  </div>
                  <span className={`text-sm font-extrabold ${rule.satisfied ? 'text-[var(--brand-mint-ink)]' : 'text-[var(--brand-butter-ink)]'}`}>
                    {rule.count} / {rule.threshold}
                  </span>
                </div>
                <ProgressBar value={(rule.count / Math.max(rule.threshold, 1)) * 100} className="mt-2" />
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {activeGoal && recommendationItems.length > 0 && (
        <motion.section {...cardEnter} className="app-surface space-y-4 p-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[var(--brand-primary)]" />
            <h2 className="text-lg font-extrabold text-[var(--brand-ink)]">Next Best Academic Move</h2>
          </div>
          <div className="space-y-2.5">
            {recommendationItems.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] p-4">
                <div className="min-w-0">
                  <h4 className="font-bold text-[var(--brand-ink)]">{item.opportunity?.title || 'Opportunity'}</h4>
                  <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{item.reason}</p>
                  {item.opportunity?.url && (
                    <a href={item.opportunity.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-[var(--brand-primary-hover)] hover:underline">Learn more →</a>
                  )}
                </div>
                <button type="button" onClick={() => handleDismiss(item.id)} aria-label="Dismiss" className="shrink-0 rounded-full p-1.5 text-[var(--brand-muted)] hover:bg-[var(--brand-danger-soft)] hover:text-[var(--brand-rose-ink)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </motion.section>
      )}
    </motion.div>
  );
}
