import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, History, Loader2, Mic, Paperclip, Sparkles, Undo2 } from 'lucide-react';
import { api, uploadEvidenceFile } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { invalidateQueries, useApiQuery } from '../lib/queryCache';
import { Button, Card, EmptyState, Notice, PageHeader } from '../components/ui';
import { pageEnter } from '../lib/motion';
import MessageList from '../components/assistant/MessageList';
import ToolCallCard from '../components/assistant/ToolCallCard';
import ConversationHistory from '../components/assistant/ConversationHistory';
import ExecutionTimeline from '../components/assistant/ExecutionTimeline';

// Same SpeechRecognition pattern QuickAddModal uses; kept identical on
// purpose so a fix in one place is easy to mirror in the other.
const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

const SUGGESTED_PROMPTS = [
  'What can I do on Sanchaya?',
  'Show me my publications from 2025',
  'Add this certificate to my Evidence Vault',
  'Am I ready for my appraisal?',
];

// Which cached dashboard queries an executed plan may have made stale,
// keyed by the step's permission scope. The agent writes to the DB behind
// the dashboard's back; without this the UI keeps showing old data.
const SCOPE_QUERY_KEYS = {
  activities: [['activities'], ['dashboard', 'faculty']],
  evidence: [['evidence'], ['dashboard', 'faculty']],
  documents: [['appraisal'], ['dashboard', 'faculty']],
  profile: [['profile']],
};

function invalidateAfterExecution(steps = []) {
  const keys = [['dashboard', 'faculty']];
  steps.forEach((step) => {
    (SCOPE_QUERY_KEYS[step.scope] || []).forEach((key) => {
      if (!keys.some((existing) => existing[0] === key[0] && existing[1] === key[1])) keys.push(key);
    });
  });
  keys.forEach((key) => invalidateQueries(key));
}

const CONVERSATION_KEY = 'sanchaya.assistant.conversationId';

export default function AssistantPage({ setCurrentView }) {
  const [messages, setMessages] = useState([]);
  // Survives reloads and navigation away from this page. Messages are already
  // persisted server-side; without remembering which conversation we were in,
  // every visit silently started an empty one and the history looked lost.
  const [conversationId, setConversationId] = useState(() => {
    try {
      return window.localStorage.getItem(CONVERSATION_KEY) || null;
    } catch {
      return null; // private-mode / storage disabled: degrade to a fresh chat
    }
  });
  const [restoring, setRestoring] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [execution, setExecution] = useState(null);

  const bottomRef = useRef(null);
  const idRef = useRef(0);

  const permissionsQuery = useApiQuery(['assistant', 'permissions'], () => api.assistant.getPermissions());
  const grantableScopes = new Set(
    (Array.isArray(permissionsQuery.data?.scopes) ? permissionsQuery.data.scopes : [])
      .filter((entry) => entry.grantable !== false)
      .map((entry) => entry.scope),
  );
  const planScopes = [...new Set((pendingPlan?.steps || []).map((step) => step.scope).filter(Boolean))];
  const sharedScope = planScopes.length === 1 && grantableScopes.has(planScopes[0]) ? planScopes[0] : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingPlan, execution]);

  // Replay the stored conversation once on mount. Runs only when there are no
  // messages in state yet, so it can never clobber a chat already in progress.
  useEffect(() => {
    if (!conversationId || messages.length > 0) return undefined;
    let cancelled = false;
    setRestoring(true);
    api.assistant
      .getConversation(conversationId)
      .then((data) => {
        if (cancelled) return;
        const restored = (Array.isArray(data?.messages) ? data.messages : [])
          // 'tool' rows are the loop's own bookkeeping and carry no content to
          // show; observations are rendered from the live turn, not replayed.
          .filter((row) => (row.role === 'user' || row.role === 'assistant') && row.content)
          .map((row) => ({ id: nextId(), role: row.role, text: row.content }));
        setMessages(restored);
      })
      .catch(() => {
        // A conversation that no longer exists (or belongs to someone else)
        // must not wedge the page -- forget it and start clean.
        if (cancelled) return;
        forgetConversation();
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rememberConversation = (id) => {
    setConversationId(id);
    try {
      if (id) window.localStorage.setItem(CONVERSATION_KEY, id);
    } catch { /* storage unavailable; the chat still works for this session */ }
  };

  const forgetConversation = () => {
    setConversationId(null);
    setMessages([]);
    setPendingPlan(null);
    setExecution(null);
    try {
      window.localStorage.removeItem(CONVERSATION_KEY);
    } catch { /* nothing to clean up */ }
  };

  const nextId = () => {
    idRef.current += 1;
    return `m${idRef.current}`;
  };

  const executePlan = async (planId, approve, alwaysAllowScope) => {
    setConfirming(approve ? 'allow' : 'deny');
    setError('');
    try {
      const result = await api.assistant.confirmPlan(planId, { approve, always_allow_scope: alwaysAllowScope });
      setExecution({ ...result, denied: !approve });
      setPendingPlan((current) => (current?.planId === planId ? null : current));
      if (approve && Array.isArray(result?.steps)) invalidateAfterExecution(result.steps);
      return result;
    } catch (err) {
      setError(runtimeConfigMessage(err));
      return null;
    } finally {
      setConfirming(null);
    }
  };

  const send = async (rawText) => {
    const text = String(rawText ?? input).trim();
    if (!text || sending) return;
    setMessages((previous) => [...previous, { id: nextId(), role: 'user', text }]);
    setInput('');
    setSending(true);
    setError('');
    setDegraded(false);
    try {
      const turn = await api.assistant.sendMessage({ message: text, conversation_id: conversationId });
      if (turn.conversation_id) rememberConversation(turn.conversation_id);
      setDegraded(Boolean(turn.degraded));
      setMessages((previous) => [...previous, { id: nextId(), role: 'assistant', text: turn.reply || '', turn }]);
      // Steps already covered by always-allow grants skip the approval
      // round-trip entirely -- the backend still executes them through the
      // same confirm endpoint.
      if (turn.plan_id && Array.isArray(turn.steps) && turn.steps.length > 0) {
        if (turn.auto_executable) {
          await executePlan(turn.plan_id, true, null);
        } else {
          setPendingPlan({ planId: turn.plan_id, steps: turn.steps });
        }
      }
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleVoice = () => {
    if (!SpeechRecognitionCtor) {
      setError('Voice capture is not supported in this browser. Type your request instead.');
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
      if (transcript) setInput((previous) => (previous ? `${previous} ${transcript}` : transcript));
    };
    recognizer.start();
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || attaching) return;
    setAttaching(true);
    setError('');
    try {
      await uploadEvidenceFile(file);
      setInput((previous) => `${previous ? `${previous} ` : ''}I just uploaded "${file.name}" to my Evidence Vault — please record and classify it.`);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setAttaching(false);
    }
  };

  // Loads the list lazily: nobody pays for it until they open history, and it
  // refetches on open so a conversation started moments ago is present.
  const conversationsQuery = useApiQuery(
    ['assistant', 'conversations', showHistory ? 'open' : 'closed'],
    () => (showHistory ? api.assistant.listConversations() : Promise.resolve({ conversations: [] })),
  );

  const toggleHistory = () => setShowHistory((current) => !current);

  const openConversation = async (id) => {
    if (id === conversationId) {
      setShowHistory(false);
      return;
    }
    setError('');
    setPendingPlan(null);
    setExecution(null);
    setDegraded(false);
    setRestoring(true);
    try {
      const data = await api.assistant.getConversation(id);
      const restored = (Array.isArray(data?.messages) ? data.messages : [])
        .filter((row) => (row.role === 'user' || row.role === 'assistant') && row.content)
        .map((row) => ({ id: nextId(), role: row.role, text: row.content }));
      setMessages(restored);
      rememberConversation(id);
      setShowHistory(false);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setRestoring(false);
    }
  };

  const startNewConversation = () => {
    // Also drops the stored id, so "New conversation" survives a reload
    // instead of the previous chat reappearing on the next mount.
    forgetConversation();
    setDegraded(false);
    setError('');
    setInput('');
  };

  const isEmpty = messages.length === 0;

  return (
    <motion.div {...pageEnter} className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Sanchaya Assistant"
        subtitle="Ask in plain language — look things up, record evidence, draft your appraisal. Anything that changes your data waits for your explicit approval."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={toggleHistory}>
              <History className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {showHistory ? 'Back to chat' : 'Past conversations'}
            </Button>
            {!isEmpty && (
              <Button variant="secondary" size="sm" onClick={startNewConversation}>
                <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                New conversation
              </Button>
            )}
          </div>
        }
      />

      {showHistory && (
        <ConversationHistory
          query={conversationsQuery}
          activeId={conversationId}
          onOpen={openConversation}
          onNew={() => {
            startNewConversation();
            setShowHistory(false);
          }}
        />
      )}

      {permissionsQuery.error && (
        <Notice tone="error">Could not load your assistant permissions. Approval cards may be incomplete.</Notice>
      )}
      {degraded && (
        <Notice tone="info">
          The assistant is unavailable right now — the AI service did not respond. Your data is untouched; please try again in a little while.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {!showHistory && (isEmpty ? (
        <Card className="p-6">
          <EmptyState
            icon={Sparkles}
            title="Your assistant for everyday academic paperwork"
            detail="Search your records, attach proof to activities, generate appraisal PDFs or ask what Sanchaya can do. Write actions are staged and shown to you before anything runs."
          />
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => send(prompt)}
                className="rounded-[var(--radius-control)] border border-[var(--brand-border)] bg-[var(--brand-surface)] px-3 py-2.5 text-left text-sm font-semibold text-[var(--brand-text)] transition hover:border-[var(--brand-lavender-strong)] hover:bg-[var(--brand-primary-softer)] hover:text-[var(--brand-primary-hover)] disabled:opacity-60"
              >
                {prompt}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <MessageList items={messages} setCurrentView={setCurrentView} />
      ))}

      {!showHistory && pendingPlan && (
        <ToolCallCard
          steps={pendingPlan.steps}
          busy={confirming !== null}
          action={confirming}
          sharedScope={sharedScope}
          onAllow={(alwaysAllowScope) => executePlan(pendingPlan.planId, true, alwaysAllowScope)}
          onDeny={() => executePlan(pendingPlan.planId, false, null)}
        />
      )}

      {!showHistory && execution && <ExecutionTimeline result={execution} setCurrentView={setCurrentView} />}

      <div ref={bottomRef} />

      {!showHistory && (
      <Card className="p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={listening ? 'Listening…' : 'Ask anything — “what needs my attention this week?”'}
          aria-label="Message the assistant"
          disabled={sending}
          className="w-full resize-none bg-transparent px-1 text-sm font-medium leading-relaxed text-[var(--brand-ink)] outline-none placeholder:text-[var(--brand-subtle)]"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant={listening ? 'attention' : 'ghost'}
              size="sm"
              onClick={handleVoice}
              disabled={sending || attaching}
              aria-label={listening ? 'Listening' : 'Speak your message'}
            >
              <Mic className={`h-4 w-4 ${listening ? 'animate-pulse' : ''}`} aria-hidden="true" />
            </Button>
            <label
              className={`btn btn-ghost btn-sm cursor-pointer ${attaching ? 'opacity-60' : ''}`}
              title="Upload a document to your Evidence Vault and mention it here"
            >
              {attaching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
              <input type="file" className="hidden" onChange={handleFileSelected} disabled={sending || attaching} />
            </label>
          </div>
          <Button variant="primary" size="sm" disabled={sending || attaching || !input.trim()} onClick={() => send()}>
            {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Bot className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {sending ? 'Thinking…' : 'Send'}
          </Button>
        </div>
      </Card>
      )}
    </motion.div>
  );
}
