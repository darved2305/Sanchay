import React from 'react';
import { ArrowRight, Download } from 'lucide-react';
import { Button, Card } from '../ui';
import AssistantMarkdown from './AssistantMarkdown';

/*
 * Renders one assistant turn: the reply bubble plus a compact block for every
 * observation the agent gathered. Blocks are keyed off ToolResult.ui_hint --
 * "list" becomes a table, "navigate" a button into that page, "download" a
 * signed link, "detail" a card. Nothing here invents UI the backend did not
 * ask for.
 */

function rowTitle(row) {
  if (!row || typeof row !== 'object') return String(row ?? '');
  return row.name || row.title || row.file_name || row.full_name || row.summary || row.subject || row.label || String(row.id ?? '');
}

function rowDetail(row) {
  if (!row || typeof row !== 'object') return '';
  const detail = row.what
    || row.description
    || [row.category, row.status, row.document_category, row.academic_year, row.start_date]
      .filter(Boolean)
      .join(' · ');
  return typeof detail === 'string' ? detail : '';
}

function viewLabel(view) {
  return String(view || 'page').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function ListBlock({ data }) {
  // PLATFORM_MAP observations arrive as data.areas; every other list tool
  // nests its rows under a single array key, so fall back to finding it.
  const areas = Array.isArray(data?.areas) ? data.areas : null;
  const rows = areas || Object.values(data || {}).find((value) => Array.isArray(value) && value.length > 0) || [];
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--brand-border)] bg-[var(--brand-surface)]">
      <ul className="divide-y divide-[var(--brand-border-soft)]">
        {rows.slice(0, 8).map((row, index) => (
          <li key={index} className="px-3 py-2">
            <p className="truncate text-sm font-bold text-[var(--brand-ink)]">{rowTitle(row)}</p>
            {rowDetail(row) && <p className="truncate text-xs font-medium text-[var(--brand-muted)]">{rowDetail(row)}</p>}
          </li>
        ))}
      </ul>
      {rows.length > 8 && (
        <p className="border-t border-[var(--brand-border-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-subtle)]">
          {rows.length - 8} more not shown
        </p>
      )}
    </div>
  );
}

function DetailBlock({ summary, data }) {
  const entries = Object.entries(data || {})
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 6);
  return (
    <Card className="p-3">
      {summary && <p className="text-sm font-bold text-[var(--brand-ink)]">{summary}</p>}
      {entries.length > 0 && (
        <dl className="mt-2 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 font-bold uppercase tracking-wide text-[var(--brand-subtle)]">{key.replace(/_/g, ' ')}</dt>
              <dd className="min-w-0 truncate text-right font-semibold text-[var(--brand-ink)]">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function ObservationBlock({ observation, setCurrentView }) {
  if (!observation) return null;
  const { ok, summary, data, ui_hint: uiHint, ui_target: uiTarget } = observation;

  if (ok === false) {
    return <p className="text-xs font-semibold text-[var(--brand-rose-ink)]">{summary}</p>;
  }
  if (uiHint === 'navigate' && uiTarget) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {summary && <span className="text-sm font-bold text-[var(--brand-ink)]">{summary}</span>}
        <Button variant="secondary" size="sm" onClick={() => setCurrentView(uiTarget)}>
          Open {viewLabel(uiTarget)}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }
  if (uiHint === 'download' && uiTarget) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {summary && <span className="text-sm font-bold text-[var(--brand-ink)]">{summary}</span>}
        <a href={uiTarget} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Download
        </a>
      </div>
    );
  }
  if (uiHint === 'list') {
    return (
      <div className="space-y-1.5">
        {summary && <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand-subtle)]">{summary}</p>}
        <ListBlock data={data} />
      </div>
    );
  }
  if (uiHint === 'detail' && data) {
    return <DetailBlock summary={summary} data={data} />;
  }
  if (summary && data) {
    return <p className="text-sm font-semibold text-[var(--brand-muted)]">{summary}</p>;
  }
  return null;
}

export default function MessageList({ items, setCurrentView }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={
              item.role === 'user'
                ? 'max-w-[85%] rounded-[var(--radius-card)] rounded-br-md bg-[var(--brand-primary)] px-4 py-3 text-white shadow-sm'
                : 'app-surface w-full max-w-full rounded-[var(--radius-card)] rounded-bl-md px-4 py-3'
            }
          >
            {/* Only the assistant's own replies are markdown. What the teacher
                typed is shown verbatim -- rendering their text as markup would
                mangle a title containing an asterisk or underscore. */}
            {item.text && (item.role === 'assistant'
              ? <AssistantMarkdown text={item.text} setCurrentView={setCurrentView} />
              : <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.text}</p>)}
            {item.role === 'assistant' && Array.isArray(item.turn?.observations) && item.turn.observations.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-[var(--brand-border-soft)] pt-3">
                {item.turn.observations.map((observation, index) => (
                  <ObservationBlock key={index} observation={observation} setCurrentView={setCurrentView} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
