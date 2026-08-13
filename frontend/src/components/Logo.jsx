import React from 'react';

/*
 * Single source for the product wordmark so headers, auth screens, and the
 * landing page never drift apart visually.
 */
export default function Logo({ compact = false, onClick, href }) {
  const mark = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary)] shadow-[0_6px_16px_rgb(139_124_246_/_22%)]">
      <span className="h-5 w-5 rotate-45 rounded-md border-2 border-white/90 border-t-transparent" />
    </span>
  );
  const wordmark = (
    <span className="text-left">
      <strong className="block font-[Manrope] text-lg font-extrabold leading-tight tracking-tight text-[var(--brand-ink)]">Sanchaya</strong>
      {!compact && <small className="block text-[11px] font-semibold leading-tight text-[var(--brand-muted)]">Your Impact. Clearly.</small>}
    </span>
  );

  const content = <span className="flex items-center gap-2.5">{mark}{wordmark}</span>;
  if (href) return <a href={href} className="inline-flex">{content}</a>;
  if (onClick) return <button type="button" onClick={onClick} className="inline-flex">{content}</button>;
  return content;
}
