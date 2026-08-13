import React, { useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { CategoryChip, Button } from './ui';
import { categoryLabel } from '../lib/constants';

/*
 * The one shared surface for every automation proposal in the product:
 * Quick Add, Reconstruct candidates, Shared Facts, CV Import drafts,
 * publication candidates. Title, category, date, source chips, confidence,
 * a "why suggested" drawer, and Confirm / Edit / Ignore -- learned once.
 */
export default function ProposalCard({
  title,
  category,
  date,
  organization,
  sourceChips = [],
  confidence,
  whySuggested,
  onConfirm,
  onEdit,
  onIgnore,
  confirmLabel = 'Confirm',
  ignoreLabel = 'Ignore',
  busy = false,
}) {
  const [showWhy, setShowWhy] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-4 transition hover:border-[var(--brand-lavender-strong)] hover:shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryChip category={category} label={categoryLabel(category)} />
          {date && <span className="text-xs font-bold text-[var(--brand-subtle)]">{date}</span>}
          {typeof confidence === 'number' && (
            <span className="chip chip-surface !border-0 !text-[11px]">{Math.round(confidence * 100)}% confidence</span>
          )}
        </div>
        <h4 className="text-base font-extrabold text-[var(--brand-ink)]">{title}</h4>
        {organization && <p className="text-sm font-medium text-[var(--brand-muted)]">{organization}</p>}
        {sourceChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-xs font-bold text-[var(--brand-subtle)]">Found from:</span>
            {sourceChips.map((chip) => (
              <span key={chip} className="rounded-md bg-[var(--brand-surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-muted)]">{chip}</span>
            ))}
          </div>
        )}
        {whySuggested && (
          <div>
            <button type="button" onClick={() => setShowWhy((value) => !value)} className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-primary-hover)] hover:underline">
              Why was this suggested? <ChevronDown className={`h-3 w-3 transition ${showWhy ? 'rotate-180' : ''}`} />
            </button>
            {showWhy && <p className="mt-1.5 max-w-md text-xs font-medium text-[var(--brand-muted)]">{whySuggested}</p>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        {onConfirm && (
          <Button variant="success" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {confirmLabel}
          </Button>
        )}
        {onEdit && (
          <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>Edit</Button>
        )}
        {onIgnore && (
          <Button variant="ghost" size="sm" onClick={onIgnore} disabled={busy} className="hover:!bg-[var(--brand-danger-soft)] hover:!text-[var(--brand-rose-ink)]">
            <X className="h-4 w-4" /> {ignoreLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
