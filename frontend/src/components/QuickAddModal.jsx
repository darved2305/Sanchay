import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Mic, Sparkles, X } from 'lucide-react';
import { api, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Button, Notice } from './ui';
import ProposalCard from './ProposalCard';
import { modalEnter } from '../lib/motion';

const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export default function QuickAddModal({ isOpen, onClose, onConfirmed }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [listening, setListening] = useState(false);

  const reset = () => { setText(''); setProposal(null); setError(''); };
  const close = () => { reset(); onClose?.(); };

  const handleParse = async () => {
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      const activity = payloadData(await api.activitiesQuickAdd(text.trim()));
      setProposal(activity);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!proposal?.id) return;
    setBusy(true); setError('');
    try {
      await api.activities.confirm(proposal.id);
      onConfirmed?.();
      close();
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleVoice = () => {
    if (!SpeechRecognitionCtor) {
      setError('Voice capture is not supported in this browser. Type your activity instead.');
      return;
    }
    const recognizer = new SpeechRecognitionCtor();
    recognizer.lang = 'en-US';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    recognizer.onstart = () => setListening(true);
    recognizer.onend = () => setListening(false);
    recognizer.onerror = () => { setListening(false); setError('Voice capture failed. Please try typing instead.'); };
    recognizer.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) setText((previous) => (previous ? `${previous} ${transcript}` : transcript));
    };
    recognizer.start();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Quick add activity">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[rgb(28_27_32_/_45%)] backdrop-blur-[2px]" onClick={close} />
        <motion.div {...modalEnter} className="app-surface relative w-full max-w-lg space-y-4 !rounded-[var(--radius-panel)] p-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-extrabold text-[var(--brand-ink)]">
              <Sparkles className="h-5 w-5 text-[var(--brand-primary)]" /> Quick Add
            </h3>
            <button type="button" onClick={close} aria-label="Close" className="rounded-[var(--radius-control)] p-2 text-[var(--brand-muted)] hover:bg-[var(--brand-surface-muted)]">
              <X className="h-5 w-5" />
            </button>
          </div>

          {!proposal && (
            <>
              <p className="text-sm font-medium text-[var(--brand-muted)]">
                Describe what you did in plain language. e.g. "Conducted a 2-hour seminar on GenAI today for TE IT"
              </p>
              <div className="relative">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={3}
                  className="input w-full resize-none !pr-11"
                  placeholder="What did you do?"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleVoice}
                  aria-label="Dictate with voice"
                  title="Dictate with voice"
                  className={`absolute right-2.5 top-2.5 rounded-full p-1.5 transition ${listening ? 'bg-[var(--brand-danger-soft)] text-[var(--brand-rose-ink)]' : 'text-[var(--brand-muted)] hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary)]'}`}
                >
                  <Mic className="h-4 w-4" />
                </button>
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>Cancel</Button>
                <Button variant="primary" onClick={handleParse} disabled={busy || !text.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Parse activity
                </Button>
              </div>
            </>
          )}

          {proposal && (
            <>
              <ProposalCard
                title={proposal.title}
                category={proposal.category}
                date={proposal.start_date}
                organization={proposal.organization}
                sourceChips={['Quick Add']}
                confidence={proposal.confidence}
              />
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={reset} disabled={busy}>Try again</Button>
                <Button variant="success" onClick={handleConfirm} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm & add to record
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
