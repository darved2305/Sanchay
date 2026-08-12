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

  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appraisal_submissions' }, invalidate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `profile_id=eq.${profileId}`,
    }, invalidate)
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
