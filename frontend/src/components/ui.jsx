import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { CATEGORY_COLOR_TOKENS } from '../lib/constants';

/*
 * Shared UI primitives. Every page composes these so buttons, chips, badges,
 * tables, notices, and empty states stay visually identical across the app.
 * Color only enters through the semantic classes defined in styles/brand.css.
 */

export function Button({ variant = 'primary', size, className = '', type = 'button', ...props }) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  return <button type={type} className={`btn btn-${variant} ${sizeClass} ${className}`.trim()} {...props} />;
}

export function Card({ className = '', hover = false, ...props }) {
  return <div className={`app-surface ${hover ? 'app-surface-hover' : ''} ${className}`.trim()} {...props} />;
}

export function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0">
        {breadcrumb}
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] font-medium text-[var(--brand-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">{actions}</div>}
    </div>
  );
}

export function CategoryChip({ category, label, className = '' }) {
  const token = CATEGORY_COLOR_TOKENS[category] || 'surface';
  return <span className={`chip chip-${token} ${className}`.trim()}>{label || category || 'Other'}</span>;
}

const STATUS_TOKENS = {
  draft: 'draft',
  not_started: 'draft',
  submitted: 'submitted',
  under_review: 'under_review',
  pending: 'pending',
  pending_review: 'under_review',
  in_review: 'under_review',
  returned: 'returned',
  revision_requested: 'returned',
  revisions_requested: 'returned',
  approved: 'approved',
  confirmed: 'approved',
  rejected: 'rejected',
  archived: 'draft',
};

export function StatusBadge({ status, icon: Icon, className = '' }) {
  const normalized = String(status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const token = STATUS_TOKENS[normalized] || 'pending';
  const text = normalized ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Status unavailable';
  return (
    <span className={`status-badge status-${token} ${className}`.trim()}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {text}
    </span>
  );
}

export function FilterChip({ active = false, className = '', ...props }) {
  return <button type="button" data-active={active} className={`filter-chip ${className}`.trim()} {...props} />;
}

export function Field({ label, hint, optional, children, htmlFor }) {
  return (
    <div>
      {label && (
        <label htmlFor={htmlFor} className="input-label">
          {label} {optional && <span className="font-medium text-[var(--brand-subtle)]">(optional)</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-xs font-medium text-[var(--brand-subtle)]">{hint}</p>}
    </div>
  );
}

export function Notice({ tone = 'info', children, className = '', role }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div role={role || (tone === 'error' ? 'alert' : 'status')} className={`notice notice-${tone} ${className}`.trim()}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, detail, action, className = '' }) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      {Icon && <div className="empty-state-icon"><Icon className="h-6 w-6" aria-hidden="true" /></div>}
      <h3 className="text-lg font-bold text-[var(--brand-ink)]">{title}</h3>
      {detail && <p className="max-w-md text-sm font-medium text-[var(--brand-muted)]">{detail}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', detail, onRetry, retryLabel = 'Retry', className = '' }) {
  return (
    <div className={`empty-state ${className}`.trim()} role="alert">
      <div className="empty-state-icon" style={{ background: 'var(--brand-danger-soft)', color: 'var(--brand-rose-ink)' }}>
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-bold text-[var(--brand-ink)]">{title}</h3>
      {detail && <p className="max-w-md text-sm font-medium text-[var(--brand-muted)]">{detail}</p>}
      {onRetry && <div className="mt-3"><Button variant="secondary" size="sm" onClick={onRetry}>{retryLabel}</Button></div>}
    </div>
  );
}

export function Skeleton({ className = '', style }) {
  return <div aria-hidden="true" className={`skeleton ${className}`.trim()} style={style} />;
}

export function ProgressBar({ value, tone, className = '' }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
  const fillStyle = tone ? { background: tone } : undefined;
  return (
    <div className={`progress-track ${className}`.trim()} role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${clamped}%`, ...fillStyle }} />
    </div>
  );
}

export function Avatar({ name, src, size = 'h-10 w-10', className = '' }) {
  const text = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  if (src) {
    return <img src={src} alt={name || 'Faculty member'} className={`${size} rounded-full border-2 border-[var(--brand-lavender-strong)] object-cover ${className}`.trim()} />;
  }
  return (
    <span aria-hidden="true" className={`${size} flex items-center justify-center rounded-full border-2 border-[var(--brand-lavender-strong)] bg-[var(--brand-lavender)] text-xs font-extrabold text-[var(--brand-lavender-ink)] ${className}`.trim()}>
      {text}
    </span>
  );
}

export function StatCard({ icon: Icon, label, value, detail, tone = 'lavender', className = '' }) {
  return (
    <Card className={`p-5 ${className}`.trim()}>
      <div className="flex items-center gap-3">
        {Icon && <span className={`icon-chip chip-${tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>}
        <span className="text-sm font-bold text-[var(--brand-muted)]">{label}</span>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-[var(--brand-ink)]">{value ?? '—'}</p>
      {detail && <p className="mt-1 text-xs font-semibold text-[var(--brand-subtle)]">{detail}</p>}
    </Card>
  );
}
