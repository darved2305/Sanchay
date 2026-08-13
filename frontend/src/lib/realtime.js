import { useEffect } from 'react';
import { getSupabaseClient } from './supabase';
import { invalidateQueries } from './queryCache';

const DEFAULT_QUERY_KEYS = [
  ['dashboard', 'faculty'],
  ['notifications'],
  ['appraisal'],
];

export function subscribeToFacultyUpdates({ profileId, queryKeys = DEFAULT_QUERY_KEYS, onEvent, channelName } = {}) {
  if (!profileId) return () => {};

  let client;
  try {
    client = getSupabaseClient();
  } catch {
    const fallback = window.setInterval(() => queryKeys.forEach((key) => invalidateQueries(key)), 5000);
    return () => window.clearInterval(fallback);
  }
  const channel = client.channel(channelName || `faculty-updates:${profileId}`);
  let pollingTimer;

  const invalidate = (payload) => {
    queryKeys.forEach((key) => invalidateQueries(key));
    onEvent?.(payload);
  };

  const startPolling = () => {
    if (pollingTimer) return;
    pollingTimer = window.setInterval(() => {
      queryKeys.forEach((key) => invalidateQueries(key));
      onEvent?.({ type: 'polling-fallback' });
    }, 5000);
  };

  const stopPolling = () => {
    if (!pollingTimer) return;
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  };

  // Every pipeline that can produce/change an activity or a document runs as
  // a FastAPI background task, not a request the current tab is waiting on --
  // CV Import, Reconstruct My Year, Teaching Change, Any Form, Career
  // dossiers, LOR letters. Without a direct subscription to the tables those
  // pipelines write, a tab sitting on the Activities/Career/LOR page never
  // finds out a background job for THIS SAME user just finished, and a
  // second open tab/device never learns about it either. One postgres_changes
  // listener per owner-scoped table, all funneling into the same
  // `invalidate` so any page mounting this hook picks up every source.
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appraisal_submissions' }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `profile_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'academic_activities',
      filter: `owner_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'background_jobs',
      filter: `owner_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'form_jobs',
      filter: `owner_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'teaching_changes',
      filter: `owner_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'career_recommendations',
      filter: `profile_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'recommendation_letters',
      filter: `profile_id=eq.${profileId}`,
    }, invalidate)
    // connection_requests/messages/community_posts RLS is join/OR-based
    // (participant of a conversation, member of a community, sender OR
    // recipient), not a single equality column -- Realtime's filter syntax
    // can't express that, but the table's own RLS SELECT policy still
    // applies to what gets delivered, so subscribing unfiltered (or with two
    // one-sided filters, for the OR case) is exactly as scoped as any other
    // query this same user could run.
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'connection_requests',
      filter: `from_profile_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'connection_requests',
      filter: `to_profile_id=eq.${profileId}`,
    }, invalidate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, invalidate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_posts' }, invalidate)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') stopPolling();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling();
    });

  return () => {
    stopPolling();
    client.removeChannel(channel);
  };
}

export function useFacultyRealtime({ profileId, queryKeys, onEvent } = {}) {
  useEffect(() => subscribeToFacultyUpdates({ profileId, queryKeys, onEvent }), [profileId, queryKeys, onEvent]);
}

/**
 * Subscribes to new rows in `messages` for one conversation. Used by LOR/
 * Community's message thread for sub-second delivery, with the same 5s
 * polling fallback pattern as the rest of the app when the channel drops.
 */
export function useConversationRealtime({ conversationId, onMessage } = {}) {
  useEffect(() => {
    if (!conversationId) return undefined;
    let client;
    try {
      client = getSupabaseClient();
    } catch {
      const fallback = window.setInterval(() => onMessage?.({ type: 'polling-fallback' }), 5000);
      return () => window.clearInterval(fallback);
    }
    const channel = client.channel(`messages:conv:${conversationId}`);
    let pollingTimer;
    const startPolling = () => {
      if (pollingTimer) return;
      pollingTimer = window.setInterval(() => onMessage?.({ type: 'polling-fallback' }), 5000);
    };
    const stopPolling = () => {
      if (!pollingTimer) return;
      window.clearInterval(pollingTimer);
      pollingTimer = undefined;
    };
    channel
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => onMessage?.(payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') stopPolling();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling();
      });
    return () => {
      stopPolling();
      client.removeChannel(channel);
    };
  }, [conversationId, onMessage]);
}
