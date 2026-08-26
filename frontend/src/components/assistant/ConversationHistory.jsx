import React from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Skeleton } from '../ui';

/*
 * Past conversations, most recently active first. Shown in place of the chat
 * when the teacher asks for history, using the same card/list vocabulary as
 * the rest of the product rather than a chat-app drawer.
 */

function relativeDay(value) {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function ConversationHistory({ query, activeId, onOpen, onNew }) {
  const conversations = Array.isArray(query.data?.conversations) ? query.data.conversations : [];

  if (query.loading) {
    return (
      <Card className="divide-y divide-[var(--brand-border-soft)] p-0">
        {[0, 1, 2].map((key) => (
          <div key={key} className="space-y-2 px-4 py-3.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </Card>
    );
  }

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No past conversations yet"
        detail="Once you ask the assistant something, it will be saved here so you can pick it back up later."
        action={<Button onClick={onNew}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Start a conversation</Button>}
      />
    );
  }

  return (
    <Card className="divide-y divide-[var(--brand-border-soft)] p-0">
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onOpen(conversation.id)}
            aria-current={active ? 'true' : undefined}
            className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors first:rounded-t-[var(--radius-card)] last:rounded-b-[var(--radius-card)] hover:bg-[var(--brand-surface)] ${
              active ? 'bg-[var(--brand-surface)]' : ''
            }`}
          >
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[var(--brand-ink)]">{conversation.title}</p>
              {conversation.preview && (
                <p className="mt-0.5 truncate text-xs font-medium text-[var(--brand-muted)]">{conversation.preview}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-subtle)]">
                {relativeDay(conversation.updated_at)}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-[var(--brand-subtle)]">
                {conversation.message_count} {conversation.message_count === 1 ? 'message' : 'messages'}
              </p>
            </div>
          </button>
        );
      })}
    </Card>
  );
}
