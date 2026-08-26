import React, { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button, Card, Notice } from '../ui';

/*
 * The approval card. This is the trust boundary of the whole assistant: the
 * model has *staged* writes but nothing has happened yet. The card names the
 * number of changes, shows each step's summary with its server-declared risk
 * class, marks steps already covered by an always-allow grant, and offers the
 * grant checkbox only when every step shares a single scope the backend
 * actually allows pre-approving (activities / evidence / documents -- see
 * agent/permissions.py GRANTABLE_SCOPES).
 */

const RISK_BADGES = {
  read: 'chip chip-surface',
  write_low: 'chip chip-mint',
  write_high: 'chip chip-butter',
  destructive: 'chip chip-rose',
  external: 'chip chip-lavender',
};

const RISK_LABELS = {
  read: 'Read only',
  write_low: 'Safe change',
  write_high: 'Sensitive',
  destructive: 'Destructive',
  external: 'External',
};

const SCOPE_GRANT_LABELS = {
  activities: 'academic records',
  evidence: 'evidence vault',
  documents: 'appraisal documents',
};

function RiskBadge({ riskClass }) {
  const key = String(riskClass || '').toLowerCase();
  return (
    <span className={`${RISK_BADGES[key] || 'chip chip-surface'} shrink-0 text-[11px] font-bold`}>
      {RISK_LABELS[key] || 'Review'}
    </span>
  );
}

export default function ToolCallCard({ steps = [], busy = false, action = null, error = '', sharedScope = null, onAllow, onDeny }) {
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const count = steps.length;

  return (
    <Card className="border border-[var(--brand-lavender-strong)] p-5">
      <div className="flex items-start gap-3">
        <span className="icon-chip chip-lavender shrink-0"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold text-[var(--brand-ink)]">
            Sanchaya wants to make {count} {count === 1 ? 'change' : 'changes'} to your account
          </h3>
          <p className="mt-0.5 text-xs font-medium text-[var(--brand-muted)]">
            Nothing below has happened yet — you approve each step before it runs.
          </p>
        </div>
      </div>

      <ul className="my-4 divide-y divide-[var(--brand-border-soft)] rounded-[var(--radius-card)] border border-[var(--brand-border)] bg-[var(--brand-surface)] px-3">
        {steps.map((step, index) => (
          <li key={index} className="flex items-center justify-between gap-3 py-2.5 first:pt-3 last:pb-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--brand-ink)]">{step.summary}</p>
              {!step.auto_approved && (
                <p className="text-xs font-medium text-[var(--brand-subtle)]">Needs your approval</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {step.auto_approved && (
                <span className="status-badge status-approved">Already permitted</span>
              )}
              <RiskBadge riskClass={step.risk_class} />
            </div>
          </li>
        ))}
      </ul>

      {error && <Notice tone="error" className="mb-3">{error}</Notice>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {sharedScope ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--brand-text)]">
            <input
              type="checkbox"
              checked={alwaysAllow}
              onChange={(event) => setAlwaysAllow(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded accent-[var(--brand-primary)]"
            />
            Always allow Sanchaya to manage your {SCOPE_GRANT_LABELS[sharedScope] || sharedScope}
          </label>
        ) : (
          <span />
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onDeny}>
            Deny
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => onAllow(alwaysAllow && sharedScope ? sharedScope : null)}
          >
            {action === 'allow' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Allow
          </Button>
        </div>
      </div>
    </Card>
  );
}
