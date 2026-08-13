import React from 'react';

/*
 * Decorative, hand-drawn academic marks used sparingly on public surfaces.
 * All are aria-hidden and purely decorative.
 */

export function Squiggle({ className = '', style }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 60 24" fill="none" className={className} style={style}>
      <path d="M2 16c6-10 10-10 14-2s8 8 14 0 10-8 14-2 8 6 14 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Sparkle({ className = '', style }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" className={className} style={style}>
      <path d="M16 2v10M16 20v10M2 16h10M20 16h10M6.5 6.5l5 5M20.5 20.5l5 5M25.5 6.5l-5 5M11.5 20.5l-5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Underline({ className = '', style }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 200 12" fill="none" preserveAspectRatio="none" className={className} style={style}>
      <path d="M2 8.5C40 3 120 2 198 6.5" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function LoopArrow({ className = '', style }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M8 34c-3-12 6-24 18-24 9 0 15 6 15 13 0 8-8 12-14 9-5-2.6-5-9 1-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M6 26l2 8 8-2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
