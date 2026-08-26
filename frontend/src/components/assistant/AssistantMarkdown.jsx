import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/*
 * Renders an assistant reply as markdown.
 *
 * The model answers with tables, bold and lists because it is prompted to be
 * concrete about the platform; rendered as plain text those come through as
 * literal pipes and asterisks. remark-gfm is what makes tables work -- they
 * are not part of base CommonMark.
 *
 * On top of that this linkifies platform page names. When the assistant says
 * "Evidence Vault", the words become a control that actually opens that page,
 * which is the product's whole premise: the assistant operates the platform
 * rather than telling you where to click.
 */

// Mirrors PLATFORM_MAP in backend/app/agent/tools/read.py. Kept in the same
// order so longer names are matched before any shorter name nested inside one.
const PLATFORM_VIEWS = [
  ['Reconstruct My Year', 'reconstruct'],
  ['Teaching Change Detector', 'teaching-change'],
  ['Any Form Assistant', 'forms'],
  ['Academic Records', 'activities'],
  ['Evidence Vault', 'evidence'],
  ['Deadline Rescue', 'rescue'],
  ['Career Growth', 'career'],
  ['Action Inbox', 'action-inbox'],
  ['LOR Studio', 'lor-studio'],
  ['CV Import', 'cv-import'],
  ['Dashboard', 'dashboard'],
  ['Community', 'community'],
  ['GrantOps', 'grantops'],
  ['Appraisal', 'appraisal'],
  ['Profile', 'profile'],
];

const VIEW_BY_NAME = new Map(PLATFORM_VIEWS.map(([name, view]) => [name.toLowerCase(), view]));

// Escaped so a name containing regex metacharacters can never break the pattern.
const NAME_PATTERN = new RegExp(
  `(?<![\\w/])(${PLATFORM_VIEWS.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w/])`,
  'g',
);

/**
 * Turn bare platform names into markdown links using a private URL scheme.
 *
 * Done on the source text rather than on rendered nodes so a name already
 * inside a real link, a code span, or a heading is left alone by the markdown
 * parser itself instead of needing to be detected here.
 */
function linkifyPlatformNames(markdown) {
  if (typeof markdown !== 'string' || !markdown) return '';
  const segments = markdown.split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/g);
  return segments
    .map((segment, index) =>
      // Odd indices are the delimiters captured above: existing links and code
      // spans, which must be passed through untouched.
      index % 2 === 1 ? segment : segment.replace(NAME_PATTERN, (name) => `[${name}](sanchaya:view/${VIEW_BY_NAME.get(name.toLowerCase())})`),
    )
    .join('');
}

export default function AssistantMarkdown({ text, setCurrentView }) {
  const source = useMemo(() => linkifyPlatformNames(text), [text]);
  if (!source) return null;

  const components = {
    p: ({ children }) => <p className="text-sm leading-relaxed">{children}</p>,
    strong: ({ children }) => <strong className="font-bold text-[var(--brand-ink)]">{children}</strong>,
    ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">{children}</ol>,
    h1: ({ children }) => <h3 className="text-sm font-bold text-[var(--brand-ink)]">{children}</h3>,
    h2: ({ children }) => <h3 className="text-sm font-bold text-[var(--brand-ink)]">{children}</h3>,
    h3: ({ children }) => <h3 className="text-sm font-bold text-[var(--brand-ink)]">{children}</h3>,
    code: ({ children }) => (
      <code className="rounded bg-[var(--brand-surface-muted,rgba(0,0,0,0.05))] px-1 py-0.5 font-mono text-xs">{children}</code>
    ),
    // Wide tables scroll inside their own bubble rather than stretching the
    // conversation column.
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--brand-border)]">
        <table className="w-full border-collapse text-left text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-[var(--brand-surface)]">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-[var(--brand-border)] px-3 py-2 font-bold uppercase tracking-wide text-[var(--brand-subtle)]">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border-b border-[var(--brand-border-soft)] px-3 py-2 align-top">{children}</td>,
    a: ({ href, children }) => {
      const view = typeof href === 'string' && href.startsWith('sanchaya:view/') ? href.slice('sanchaya:view/'.length) : null;
      if (view) {
        return (
          <button
            type="button"
            onClick={() => setCurrentView?.(view)}
            className="font-bold text-[var(--brand-primary)] underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className="font-bold text-[var(--brand-primary)] underline underline-offset-2">
          {children}
        </a>
      );
    },
  };

  return (
    <div className="space-y-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
