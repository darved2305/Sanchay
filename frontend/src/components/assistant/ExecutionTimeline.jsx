import React from 'react';
import { ArrowRight, CheckCircle2, Clock, Download, MinusCircle, XCircle } from 'lucide-react';
import { Card, Notice } from '../ui';

/*
 * Post-approval timeline: what the executor actually did. Rendered straight
 * from the confirm response's steps -- succeeded gets a check, failed a cross
 * plus its error, skipped is muted. A failed step never hides the others.
 */

const STATUS_ICONS = {
  succeeded: { Icon: CheckCircle2, className: 'text-[var(--brand-mint-strong)]', label: 'Done' },
  failed: { Icon: XCircle, className: 'text-[var(--brand-rose-strong)]', label: 'Failed' },
  skipped: { Icon: MinusCircle, className: 'text-[var(--brand-subtle)]', label: 'Skipped' },
  pending: { Icon: Clock, className: 'text-[var(--brand-subtle)]', label: 'Not run' },
};

function StepRow({ step, setCurrentView }) {
  const meta = STATUS_ICONS[step.status] || STATUS_ICONS.pending;
  const { Icon } = meta;
  const resultSummary = typeof step.result?.summary === 'string' ? step.result.summary : null;
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-hidden="true" />
      <div className={`min-w-0 ${step.status === 'skipped' || step.status === 'pending' ? 'opacity-55' : ''}`}>
        <p className="text-sm font-bold text-[var(--brand-ink)]">{step.summary}</p>
        {resultSummary && step.status === 'succeeded' && (
          <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">{resultSummary}</p>
        )}
        {step.status === 'failed' && step.error && (
          <p className="mt-0.5 text-xs font-semibold text-[var(--brand-rose-ink)]">{step.error}</p>
        )}
        {/* A tool that produced a file returns its signed URL as ui_target.
            Without surfacing it the document is generated and stored but the
            teacher has no way to reach it -- the step reads "Done" and hands
            back nothing. Links are short-lived by design, hence the note. */}
        {step.status === 'succeeded' && step.result?.ui_hint === 'download' && step.result?.ui_target && (
          <a
            href={step.result.ui_target}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm mt-2"
            download
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Download PDF
          </a>
        )}
        {step.status === 'succeeded' && step.result?.ui_hint === 'navigate' && step.result?.ui_target && setCurrentView && (
          <button
            type="button"
            onClick={() => setCurrentView(step.result.ui_target)}
            className="btn btn-secondary btn-sm mt-2"
          >
            Open
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <span className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-subtle)]">
        {meta.label}
      </span>
    </li>
  );
}

export default function ExecutionTimeline({ result, setCurrentView }) {
  if (!result) return null;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (steps.length === 0 && result.denied) {
    return (
      <Notice tone="info">Changes discarded — nothing was written to your account.</Notice>
    );
  }

  return (
    <Card className="p-4">
      {result.denied ? (
        <Notice tone="info" className="mb-3">Changes discarded — nothing was written to your account.</Notice>
      ) : result.status === 'completed' ? (
        <Notice tone="success" className="mb-3">All done — the rest of your dashboard has been refreshed.</Notice>
      ) : result.status === 'failed' ? (
        <Notice tone="error" className="mb-3">
          Some changes did not go through. Everything that could run safely has been left intact.
        </Notice>
      ) : null}
      <ul className="divide-y divide-[var(--brand-border-soft)]">
        {steps.map((step, index) => <StepRow key={index} step={step} setCurrentView={setCurrentView} />)}
      </ul>
    </Card>
  );
}
