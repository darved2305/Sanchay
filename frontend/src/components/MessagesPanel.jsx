import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { api, listItems, payloadData } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Avatar, Button, EmptyState, Notice } from './ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { useConversationRealtime } from '../lib/realtime';

function Thread({ conversationId, peerName }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = payloadData(await api.messages.getMessages(conversationId));
      setMessages(listItems(result));
      await api.messages.markRead(conversationId);
      invalidateQueries(['messages', 'conversations']);
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useConversationRealtime({ conversationId, onMessage: () => void load() });
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true); setError('');
    try {
      await api.messages.sendMessage(conversationId, draft.trim());
      setDraft('');
      await load();
    } catch (err) {
      setError(runtimeConfigMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[520px] flex-col">
      <div className="border-b border-[var(--brand-border-soft)] p-4">
        <p className="font-bold text-[var(--brand-ink)]">{peerName}</p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {loading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--brand-primary)]" />}
        {!loading && messages.length === 0 && <p className="text-center text-sm font-medium text-[var(--brand-muted)]">Say hello.</p>}
        {messages.map((message) => (
          <div key={message.id} className="max-w-[80%] rounded-[var(--radius-control)] bg-[var(--brand-surface-muted)] px-3 py-2 text-sm text-[var(--brand-text)]">
            {message.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <Notice tone="error" className="mx-4">{error}</Notice>}
      <div className="flex items-center gap-2 border-t border-[var(--brand-border-soft)] p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          placeholder="Type a message…"
          className="input flex-1"
        />
        <Button variant="primary" size="sm" onClick={send} disabled={busy || !draft.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function MessagesPanel() {
  const conversations = useApiQuery(['messages', 'conversations'], () => api.messages.conversations());
  const [activeId, setActiveId] = useState(null);
  const items = listItems(conversations.data);
  const active = items.find((c) => c.id === activeId) || items[0];

  useEffect(() => {
    if (!activeId && items.length > 0) setActiveId(items[0].id);
  }, [items, activeId]);

  if (!conversations.loading && items.length === 0) {
    return <EmptyState icon={MessageCircle} title="No conversations yet" detail="Connect with a colleague in Discover, then message them here." />;
  }

  return (
    <div className="app-surface grid grid-cols-1 overflow-hidden md:grid-cols-[240px_1fr]">
      <div className="divide-y divide-[var(--brand-border-soft)] border-b border-[var(--brand-border-soft)] md:border-b-0 md:border-r">
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveId(c.id)}
            className={`flex w-full items-center gap-2.5 p-3 text-left transition hover:bg-[var(--brand-primary-softer)] ${active?.id === c.id ? 'bg-[var(--brand-primary-softer)]' : ''}`}
          >
            <Avatar name={c.peer_name} src={c.peer_photo_url} size="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[var(--brand-ink)]">{c.peer_name}</p>
              <p className="truncate text-xs font-medium text-[var(--brand-muted)]">{c.last_message_body || 'No messages yet'}</p>
            </div>
            {c.unread_count > 0 && <span className="rounded-full bg-[var(--brand-primary)] px-1.5 py-0.5 text-[10px] font-bold text-white">{c.unread_count}</span>}
          </button>
        ))}
      </div>
      {active ? <Thread conversationId={active.id} peerName={active.peer_name} /> : <div className="p-8 text-center text-sm text-[var(--brand-muted)]">Select a conversation</div>}
    </div>
  );
}
