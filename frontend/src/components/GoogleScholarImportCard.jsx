import React, { useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Notice } from './ui';

export default function GoogleScholarImportCard({ onImported }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = payloadData(await api.publications.scholarImport(value));
      setResult(response);
      if (response?.matched) {
        setText('');
        onImported?.();
      }
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--brand-border-soft)] bg-[var(--brand-surface)] p-6">
      <span className="chip chip-primary !border-[var(--brand-surface)]">
        <GraduationCap className="h-3.5 w-3.5" />Get Google Scholar
      </span>
      <h2 className="mt-3 text-xl font-extrabold text-[var(--brand-ink)]">Import from your Scholar profile</h2>
      <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--brand-muted)]">
        Open your profile at scholar.google.com/citations, select all (Ctrl+A), copy, then paste the page below and press Enter.
        We check it's really you before adding anything to your record.
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={5}
        maxLength={60000}
        disabled={busy}
        className="input mt-4 w-full resize-y"
        placeholder="Paste your Google Scholar profile page here, then press Enter"
        aria-label="Pasted Google Scholar profile content"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium text-[var(--brand-subtle)]">Press Enter to import &middot; Shift+Enter for a new line</p>
        <Button variant="primary" size="sm" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />}
          {busy ? 'Verifying…' : 'Import'}
        </Button>
      </div>

      {error && <Notice tone="error" className="mt-4">{error}</Notice>}

      {result && !result.matched && (
        <Notice tone="error" className="mt-4">
          {result.extracted_name
            ? `The pasted page appears to belong to "${result.extracted_name}", which doesn't match your profile name. Nothing was imported.`
            : 'This does not look like a Google Scholar profile page. Nothing was imported.'}
        </Notice>
      )}

      {result?.matched && (
        <Notice tone="success" className="mt-4">
          Imported {result.count} publication{result.count === 1 ? '' : 's'} for {result.extracted_name}.
          {result.skipped?.length > 0 && ` ${result.skipped.length} already accounted for and skipped.`}
          {result.extraction_method === 'heuristic' && ' (Read with the basic parser, not AI extraction — double-check the details.)'}
        </Notice>
      )}
    </section>
  );
}
