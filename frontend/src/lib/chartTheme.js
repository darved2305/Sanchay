/*
 * Chart theme bridge. Chart libraries (Recharts) require literal color
 * strings, so we resolve the canonical brand CSS variables at runtime.
 * The fallback values mirror styles/brand.css and exist only so charts can
 * never render in an off-brand library-default color if a variable is
 * missing (e.g. during early paint). This is the single documented place
 * where token values are duplicated.
 */

const FALLBACKS = {
  '--brand-chart-1': '#8b7cf6',
  '--brand-chart-2': '#4ba67b',
  '--brand-chart-3': '#f0a58a',
  '--brand-chart-4': '#7caee8',
  '--brand-chart-5': '#e8c85a',
  '--brand-chart-grid': '#efece8',
  '--brand-muted': '#706d78',
  '--brand-ink': '#1c1b20',
  '--brand-surface': '#ffffff',
  '--brand-border-soft': '#efece8',
};

export function chartVar(name) {
  if (typeof window === 'undefined') return FALLBACKS[name] || '#8b7cf6';
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || FALLBACKS[name] || '#8b7cf6';
}

export function chartPalette() {
  return [
    chartVar('--brand-chart-1'),
    chartVar('--brand-chart-2'),
    chartVar('--brand-chart-3'),
    chartVar('--brand-chart-4'),
    chartVar('--brand-chart-5'),
  ];
}

export const CHART_TOOLTIP_STYLE = {
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--brand-border)',
  background: 'var(--brand-surface)',
  boxShadow: 'var(--shadow-raised)',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--brand-ink)',
};
