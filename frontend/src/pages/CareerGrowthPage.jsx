import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, ChevronUp, Download, Lightbulb, Loader2, Sparkles, Target, TrendingUp, X } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, EmptyState, Notice, PageHeader, ProgressBar, Skeleton } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';

function GoalOpportunities({ goalId }) {
  const [open, setOpen] = useState(false);
  const opportunities = useApiQuery(['career', 'goal-opportunities', goalId], () => api.career.goalOpportunities(goalId), { enabled: open });
  const data = payloadData(opportunities.data);
  const inboxItems = data?.inbox_items || [];
  const grants = data?.grants || [];
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs font-bold text-[var(--brand-primary-hover)]">
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Opportunities for this goal
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {inboxItems.length === 0 && grants.length === 0 && !opportunities.loading && (
            <p className="text-xs font-medium text-[var(--brand-muted)]">Nothing matches this goal yet — check back after your next Action Inbox sync.</p>
          )}
          {inboxItems.map((item) => (
            <div key={item.inbox_item_id} className="rounded-[var(--radius-control)] bg-[var(--brand-mint)] p-2">
              <p className="text-xs font-bold text-[var(--brand-mint-ink)]">{item.subject}</p>
              <p className="text-xs font-medium text-[var(--brand-mint-ink)]">{item.reasons.join(' · ')}</p>
            </div>
          ))}
          {grants.map((g) => (
            <div key={g.grant_opportunity_id} className="rounded-[var(--radius-control)] bg-[var(--brand-sky)] p-2">
              <p className="text-xs font-bold text-[var(--brand-sky-ink)]">{g.title}</p>
              <p className="text-xs font-medium text-[var(--brand-sky-ink)]">{g.reasons.join(' · ')}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomGoalCard({ goal, onDismiss }) {
  return (
    <motion.div {...cardEnter} className="app-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="chip chip-peach !border-0 !text-[10px] uppercase">{goal.source === 'suggested' ? 'Accepted suggestion' : 'Your goal'}</span>
          <h3 className="mt-1.5 text-base font-extrabold text-[var(--brand-ink)]">{goal.title}</h3>
          {goal.description && <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{goal.description}</p>}
          {goal.target_date && <p className="mt-1 text-xs font-semibold text-[var(--brand-subtle)]">Target: {goal.target_date}</p>}
        </div>
        <button type="button" onClick={() => onDismiss(goal.id)} aria-label="Dismiss goal" className="shrink-0 rounded-full p-1.5 text-[var(--brand-muted)] hover:bg-[var(--brand-danger-soft)] hover:text-[var(--brand-rose-ink)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      {goal.progress?.outcomes?.length > 0 && (
        <div className="mt-3 space-y-2">
          {goal.progress.outcomes.map((o) => (
            <div key={o.key + o.label}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[var(--brand-ink)]">{o.label}</span>
                <span className={`font-extrabold ${o.satisfied ? 'text-[var(--brand-mint-ink)]' : 'text-[var(--brand-butter-ink)]'}`}>
                  {o.tracked ? `${o.count} / ${o.target}` : 'Tracked manually'}
                </span>
              </div>
              {o.tracked && <ProgressBar value={(o.count / Math.max(o.target, 1)) * 100} className="mt-1" />}
            </div>
          ))}
        </div>
      )}
      <GoalOpportunities goalId={goal.id} />
    </motion.div>
  );
}

function SuggestedGoalCard({ suggestion, onAccept, onHide, busy }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--brand-lavender-strong)] bg-[var(--brand-primary-softer)] p-4">
      <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-[var(--brand-primary)]" /><h4 className="font-extrabold text-[var(--brand-ink)]">{suggestion.title}</h4></div>
      <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{suggestion.description}</p>
      <ul className="mt-2 space-y-0.5">
        {suggestion.reasons.map((r) => <li key={r} className="text-xs font-semibold text-[var(--brand-primary-hover)]">✓ {r}</li>)}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" onClick={() => onAccept(suggestion)} disabled={busy}>Accept goal</Button>
        <Button variant="ghost" size="sm" onClick={() => onHide(suggestion.key)}>Dismiss</Button>
      </div>
    </div>
  );
}

function NaturalLanguageGoalForm({ onCreated }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parse = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(payloadData(await api.career.parseGoal(text))); }
    catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError('');
    try {
      await api.career.createCustomGoal({ ...preview, raw_text: text, source: 'custom' });
      setText(''); setPreview(null);
      onCreated?.();
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="app-surface space-y-3 p-5">
      <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--brand-primary)]" /><h3 className="font-extrabold text-[var(--brand-ink)]">Set your own career goal</h3></div>
      <p className="text-xs font-medium text-[var(--brand-muted)]">Type it in your own words — e.g. "I want to publish three Q1 journal papers in healthcare AI by June 2027."</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} rows={2} className="input w-full" placeholder="I want to…" />
      {error && <Notice tone="error">{error}</Notice>}
      {!preview && <Button variant="secondary" size="sm" onClick={parse} disabled={busy || !text.trim()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Preview goal</Button>}
      {preview && (
        <div className="rounded-[var(--radius-control)] bg-[var(--brand-surface-muted)] p-3">
          <p className="font-bold text-[var(--brand-ink)]">{preview.title}</p>
          <p className="mt-1 text-sm font-medium text-[var(--brand-muted)]">{preview.description}</p>
          {preview.target_date && <p className="mt-1 text-xs font-semibold text-[var(--brand-subtle)]">Target: {preview.target_date}</p>}
          {preview.measurable_outcomes?.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {preview.measurable_outcomes.map((o) => <li key={o.key} className="text-xs font-semibold text-[var(--brand-ink)]">{o.label}: target {o.target}</li>)}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={confirm} disabled={busy}>Confirm goal</Button>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Edit text</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CareerGrowthPage() {
  const rules = useApiQuery(['career', 'rules'], () => api.career.rules());
  const goal = useApiQuery(['career', 'goals'], () => api.career.goals());
  const progress = useApiQuery(['career', 'progress'], () => api.career.progress());
  const recommendations = useApiQuery(['career', 'recommendations'], () => api.career.recommendations());
  const allGoals = useApiQuery(['career', 'all-goals'], () => api.career.allGoals());
  const suggested = useApiQuery(['career', 'suggested'], () => api.career.suggestedGoals());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dossierUrl, setDossierUrl] = useState('');
  const [hiddenSuggestions, setHiddenSuggestions] = useState([]);

  const ruleItems = listItems(rules.data);
  const activeGoal = payloadData(goal.data)?.active_goal;
  const progressData = payloadData(progress.data)?.progress;
  const recommendationItems = listItems(recommendations.data);
  const customGoals = payloadData(allGoals.data)?.custom_goals || [];
  const suggestionItems = listItems(suggested.data).filter((s) => !hiddenSuggestions.includes(s.key));

  const acceptSuggestion = async (suggestion) => {
    setBusy(true); setError('');
    try {
      await api.career.createCustomGoal({
        title: suggestion.title, description: suggestion.description, target_date: null,
        measurable_outcomes: suggestion.measurable_outcomes, raw_text: null, source: 'suggested',
      });
      setHiddenSuggestions((prev) => [...prev, suggestion.key]);
      invalidateQueries(['career']);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };
  const dismissCustomGoal = async (id) => {
    try { await api.career.updateCustomGoal(id, 'dismissed'); invalidateQueries(['career']); }
    catch (err) { setError(runtimeConfigMessage(err)); }
  };

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

      <NaturalLanguageGoalForm onCreated={() => invalidateQueries(['career'])} />

      {suggestionItems.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">Suggested for you</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {suggestionItems.map((s) => (
              <SuggestedGoalCard key={s.key} suggestion={s} onAccept={acceptSuggestion} onHide={(key) => setHiddenSuggestions((prev) => [...prev, key])} busy={busy} />
            ))}
          </div>
        </section>
      )}

      {customGoals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">Your goals</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {customGoals.map((g) => <CustomGoalCard key={g.id} goal={g} onDismiss={dismissCustomGoal} />)}
          </div>
        </section>
      )}

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
