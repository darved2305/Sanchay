import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Heart, MessageCircle, PartyPopper, Plus, Search, Send, Sparkles, UserCheck, UserPlus, Users, X } from 'lucide-react';
import { api, listItems } from '../lib/api';
import { runtimeConfigMessage } from '../lib/config';
import { Avatar, Button, EmptyState, Notice, PageHeader } from '../components/ui';
import { useApiQuery, invalidateQueries } from '../lib/queryCache';
import { pageEnter, cardEnter } from '../lib/motion';
import MessagesPanel from '../components/MessagesPanel';

const TABS = [
  { id: 'discover', label: 'Discover' },
  { id: 'connections', label: 'Connections' },
  { id: 'communities', label: 'Communities' },
  { id: 'feed', label: 'Feed' },
  { id: 'workspaces', label: 'Collaboration Workspaces' },
  { id: 'messages', label: 'Messages' },
];

const OPEN_TO_FILTERS = [
  { id: '', label: 'Everyone' },
  { id: 'mentorship', label: 'Mentors' },
  { id: 'phd', label: 'PhD Supervisors' },
  { id: 'collaboration', label: 'Collaborators' },
  { id: 'grant_collaboration', label: 'Grant Collaborators' },
  { id: 'reviewing', label: 'Reviewers/Experts' },
];

function ConnectionStateButton({ person, onSend }) {
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { await onSend(person.id); } finally { setBusy(false); } };
  if (person.connection_state === 'connected') return <span className="chip chip-mint !border-0"><UserCheck className="h-3.5 w-3.5" /> Connected</span>;
  if (person.connection_state === 'pending_sent') return <span className="chip chip-butter !border-0">Pending</span>;
  if (person.connection_state === 'pending_received') return <span className="chip chip-sky !border-0">Wants to connect</span>;
  return <Button variant="primary" size="sm" onClick={send} disabled={busy}><UserPlus className="h-3.5 w-3.5" /> Connect</Button>;
}

function FollowButton({ profileId }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      if (following) await api.community.unfollow(profileId); else await api.community.follow(profileId);
      setFollowing((v) => !v);
    } catch { /* leave state unchanged on failure */ } finally { setBusy(false); }
  };
  return <Button variant="ghost" size="sm" onClick={toggle} disabled={busy}>{following ? 'Following' : 'Follow'}</Button>;
}

function PersonCard({ person, onSend }) {
  return (
    <div className="app-surface flex items-start gap-3 p-4">
      <Avatar name={person.full_name} src={person.photo_url} size="h-11 w-11" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[var(--brand-ink)]">{person.full_name}</p>
        <p className="text-xs font-medium text-[var(--brand-muted)]">{person.designation || 'Faculty'}{person.institution_name ? ` · ${person.institution_name}` : ''}</p>
        {person.research_interests?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {person.research_interests.slice(0, 3).map((tag) => <span key={tag} className="chip chip-lavender !border-0 !text-[10px]">{tag}</span>)}
          </div>
        )}
        {person.reasons?.length > 0 && (
          <p className="mt-1.5 text-xs font-semibold text-[var(--brand-primary-hover)]">{person.reasons.join(' · ')}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <ConnectionStateButton person={person} onSend={onSend} />
          <FollowButton profileId={person.id} />
        </div>
      </div>
    </div>
  );
}

function DiscoverTab() {
  const [query, setQuery] = useState('');
  const [openTo, setOpenTo] = useState('');
  const [error, setError] = useState('');
  const people = useApiQuery(['community', 'people', { q: query, open_to: openTo }], () => api.community.people({ q: query || undefined, open_to: openTo || undefined }));
  const recommendations = useApiQuery(['community', 'recommendations'], () => api.community.recommendations());

  const send = async (toProfileId) => {
    setError('');
    try {
      await api.community.sendConnectionRequest(toProfileId);
      invalidateQueries(['community', 'people']);
      invalidateQueries(['community', 'recommendations']);
    } catch (err) { setError(runtimeConfigMessage(err)); }
  };

  const peopleItems = listItems(people.data);
  const recommendationItems = listItems(recommendations.data);

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="app-surface flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-subtle)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, expertise, research interest" className="input !py-2 !pl-9" />
        </div>
        <select value={openTo} onChange={(e) => setOpenTo(e.target.value)} className="input !w-auto !py-2">
          {OPEN_TO_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>

      {recommendationItems.length > 0 && !query && (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--brand-primary)]" /><h3 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">Recommended for you</h3></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {recommendationItems.map((p) => <PersonCard key={p.id} person={p} onSend={send} />)}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">All faculty</h3>
        {!people.loading && peopleItems.length === 0 && <EmptyState icon={Users} title="No faculty found" detail="Try a different search." />}
        <div className="grid gap-3 sm:grid-cols-2">
          {peopleItems.map((p) => <PersonCard key={p.id} person={p} onSend={send} />)}
        </div>
      </div>
    </div>
  );
}

function ConnectionsTab() {
  const requests = useApiQuery(['community', 'requests'], () => api.community.connectionRequests());
  const connections = useApiQuery(['community', 'connections'], () => api.community.connections());
  const [error, setError] = useState('');

  const respond = async (requestId, action) => {
    setError('');
    try {
      await api.community.respondConnectionRequest(requestId, action);
      invalidateQueries(['community', 'requests']);
      invalidateQueries(['community', 'connections']);
    } catch (err) { setError(runtimeConfigMessage(err)); }
  };

  const requestItems = listItems(requests.data);
  const connectionItems = listItems(connections.data);

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      {requestItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">Pending requests</h3>
          {requestItems.map((r) => (
            <div key={r.id} className="app-surface flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={r.from_name} src={r.from_photo_url} size="h-10 w-10" />
                <div>
                  <p className="font-bold text-[var(--brand-ink)]">{r.from_name}</p>
                  {r.note && <p className="text-xs font-medium text-[var(--brand-muted)]">{r.note}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="success" size="sm" onClick={() => respond(r.id, 'accept')}><Check className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={() => respond(r.id, 'decline')}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--brand-muted)]">{connectionItems.length} connection(s)</h3>
        {!connections.loading && connectionItems.length === 0 && <EmptyState icon={UserPlus} title="No connections yet" detail="Find your first collaborator in Discover." />}
        <div className="grid gap-3 sm:grid-cols-2">
          {connectionItems.map((p) => (
            <div key={p.id} className="app-surface flex items-center gap-3 p-4">
              <Avatar name={p.full_name} src={p.photo_url} size="h-10 w-10" />
              <div>
                <p className="font-bold text-[var(--brand-ink)]">{p.full_name}</p>
                <p className="text-xs font-medium text-[var(--brand-muted)]">{p.designation || 'Faculty'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommunitiesTab() {
  const communities = useApiQuery(['community', 'communities'], () => api.community.communities());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      await api.community.createCommunity(name.trim());
      setName('');
      invalidateQueries(['community', 'communities']);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  const toggle = async (community) => {
    try {
      if (community.joined) await api.community.leaveCommunity(community.id);
      else await api.community.joinCommunity(community.id);
      invalidateQueries(['community', 'communities']);
    } catch (err) { setError(runtimeConfigMessage(err)); }
  };

  const items = listItems(communities.data);

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="app-surface flex flex-wrap items-center gap-2 p-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Start a new community (e.g. AI in Education)" className="input flex-1 min-w-[220px]" />
        <Button variant="primary" onClick={create} disabled={busy || !name.trim()}><Plus className="h-4 w-4" /> Create</Button>
      </div>
      {!communities.loading && items.length === 0 && <EmptyState icon={Users} title="No communities yet" detail="Start the first one above." />}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <div key={c.id} className="app-surface p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-[var(--brand-ink)]">{c.name}</p>
                <p className="text-xs font-medium text-[var(--brand-muted)]">{c.member_count} member(s)</p>
              </div>
              <Button variant={c.joined ? 'secondary' : 'primary'} size="sm" onClick={() => toggle(c)}>{c.joined ? 'Leave' : 'Join'}</Button>
            </div>
            {c.description && <p className="mt-2 text-sm text-[var(--brand-muted)]">{c.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

const POST_KINDS = [
  { id: 'post', label: 'Update' }, { id: 'question', label: 'Research Question' },
  { id: 'opportunity', label: 'Opportunity' }, { id: 'collaboration', label: 'Looking for Collaborators' },
  { id: 'announcement', label: 'Announcement' },
];
const REACTION_TYPES = [
  { id: 'like', icon: Heart, label: 'Like' }, { id: 'insightful', icon: Sparkles, label: 'Insightful' }, { id: 'celebrate', icon: PartyPopper, label: 'Celebrate' },
];

function FeedTab() {
  const feed = useApiQuery(['community', 'feed'], () => api.community.feed());
  const communities = useApiQuery(['community', 'communities'], () => api.community.communities());
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('post');
  const [communityId, setCommunityId] = useState('');
  const [researchArea, setResearchArea] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [skillsNeeded, setSkillsNeeded] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expandedInterests, setExpandedInterests] = useState(null);
  const interested = useApiQuery(['community', 'interested', expandedInterests], () => api.community.interested(expandedInterests), { enabled: !!expandedInterests });

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true); setError('');
    try {
      const collaborationPayload = kind === 'collaboration'
        ? { research_area: researchArea || null, looking_for: lookingFor || null, skills_needed: skillsNeeded ? skillsNeeded.split(',').map((s) => s.trim()).filter(Boolean) : [] }
        : null;
      await api.community.createPost(body.trim(), kind, communityId || null, collaborationPayload);
      setBody(''); setResearchArea(''); setLookingFor(''); setSkillsNeeded(''); setKind('post');
      invalidateQueries(['community', 'feed']);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  const react = async (item, reactionType) => {
    try {
      if (item.my_reaction === reactionType) await api.community.unreact(item.id);
      else await api.community.react(item.id, reactionType);
      invalidateQueries(['community', 'feed']);
    } catch { /* refresh retries */ }
  };

  const expressInterest = async (item) => {
    try { await api.community.expressInterest(item.id); invalidateQueries(['community', 'feed']); }
    catch { /* refresh retries */ }
  };

  const items = listItems(feed.data);
  const joinedCommunities = listItems(communities.data).filter((c) => c.joined);

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="app-surface space-y-2.5 p-4">
        <div className="flex flex-wrap gap-1.5">
          {POST_KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)} className={`chip !cursor-pointer !border-0 !text-xs ${kind === k.id ? 'chip-lavender' : 'bg-[var(--brand-surface-muted)]'}`}>{k.label}</button>
          ))}
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={kind === 'collaboration' ? 'Describe the project you need collaborators for…' : 'Share an update, question or opportunity…'} className="input resize-none" />
        {kind === 'collaboration' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={researchArea} onChange={(e) => setResearchArea(e.target.value)} placeholder="Research area" className="input !py-1.5 !text-xs" />
            <input value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} placeholder="Looking for (e.g. Medical imaging researcher)" className="input !py-1.5 !text-xs" />
            <input value={skillsNeeded} onChange={(e) => setSkillsNeeded(e.target.value)} placeholder="Skills needed (comma-separated)" className="input !py-1.5 !text-xs" />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <select value={communityId} onChange={(e) => setCommunityId(e.target.value)} className="input !w-auto !py-1.5 !text-xs">
            <option value="">Post to your network</option>
            {joinedCommunities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button variant="primary" size="sm" onClick={post} disabled={busy || !body.trim()}><Send className="h-3.5 w-3.5" /> Post</Button>
        </div>
      </div>
      {!feed.loading && items.length === 0 && <EmptyState icon={MessageCircle} title="Nothing here yet" detail="Connect with faculty or join a community to see posts." />}
      {items.map((item) => (
        <motion.div key={item.id} {...cardEnter} className="app-surface p-4">
          <div className="flex items-center gap-2.5">
            <Avatar name={item.author_name} src={item.author_photo_url} size="h-9 w-9" />
            <div>
              <p className="text-sm font-bold text-[var(--brand-ink)]">{item.author_name}</p>
              <p className="text-xs font-medium text-[var(--brand-subtle)]">{item.community_name || 'Your network'} · {POST_KINDS.find((k) => k.id === item.kind)?.label || item.kind}</p>
            </div>
          </div>
          <p className="mt-2.5 text-sm text-[var(--brand-text)]">{item.body}</p>
          {item.kind === 'collaboration' && item.collaboration_payload && (
            <div className="mt-2.5 rounded-[var(--radius-control)] bg-[var(--brand-lavender)] p-3">
              {item.collaboration_payload.research_area && <p className="text-xs font-bold text-[var(--brand-lavender-ink)]">Research area: {item.collaboration_payload.research_area}</p>}
              {item.collaboration_payload.looking_for && <p className="text-xs font-semibold text-[var(--brand-lavender-ink)]">Looking for: {item.collaboration_payload.looking_for}</p>}
              {item.collaboration_payload.skills_needed?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">{item.collaboration_payload.skills_needed.map((s) => <span key={s} className="chip chip-surface !border-0 !text-[10px]">{s}</span>)}</div>
              )}
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-4">
            {REACTION_TYPES.map((r) => {
              const Icon = r.icon;
              const active = item.my_reaction === r.id;
              return (
                <button key={r.id} type="button" onClick={() => react(item, r.id)} title={r.label} className={`inline-flex items-center gap-1 text-xs font-bold ${active ? 'text-[var(--brand-rose-ink)]' : 'text-[var(--brand-muted)]'}`}>
                  <Icon className={`h-3.5 w-3.5 ${active ? 'fill-current' : ''}`} />
                </button>
              );
            })}
            <span className="text-xs font-bold text-[var(--brand-muted)]">{item.reaction_count}</span>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand-muted)]"><MessageCircle className="h-3.5 w-3.5" /> {item.comment_count}</span>
            {item.kind === 'collaboration' && (
              <>
                <button type="button" onClick={() => expressInterest(item)} disabled={item.interested} className={`ml-auto text-xs font-bold ${item.interested ? 'text-[var(--brand-mint-ink)]' : 'text-[var(--brand-primary-hover)]'}`}>
                  {item.interested ? '✓ Interested' : 'Express Interest'}
                </button>
                <button type="button" onClick={() => setExpandedInterests(expandedInterests === item.id ? null : item.id)} className="text-xs font-bold text-[var(--brand-muted)] hover:underline">
                  {item.interest_count} interested
                </button>
              </>
            )}
          </div>
          {expandedInterests === item.id && (
            <div className="mt-2 space-y-1 border-t border-[var(--brand-border-soft)] pt-2">
              {listItems(interested.data).map((p) => <p key={p.id} className="text-xs font-semibold text-[var(--brand-ink)]">{p.full_name} — {p.institution_name}</p>)}
              {listItems(interested.data).length === 0 && !interested.loading && <p className="text-xs text-[var(--brand-muted)]">No one has expressed interest yet.</p>}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

const COLLAB_STAGE_LABELS = {
  introduced: 'Introduced', discussing: 'Discussing', planning: 'Planning',
  active: 'Active', submitted: 'Submitted', completed: 'Completed', paused: 'Paused',
};

function WorkspacesTab() {
  const workspaces = useApiQuery(['community', 'workspaces'], () => api.community.collaborationWorkspaces());
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true); setError('');
    try {
      await api.community.createCollaborationWorkspace({ title: title.trim() });
      setTitle('');
      invalidateQueries(['community', 'workspaces']);
    } catch (err) { setError(runtimeConfigMessage(err)); } finally { setBusy(false); }
  };

  const items = listItems(workspaces.data);
  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="app-surface flex flex-wrap items-center gap-2 p-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Start a collaboration workspace (e.g. Federated Learning in Radiology)" className="input flex-1 min-w-[220px]" />
        <Button variant="primary" onClick={create} disabled={busy || !title.trim()}><Plus className="h-4 w-4" /> Create</Button>
      </div>
      {!workspaces.loading && items.length === 0 && <EmptyState icon={Users} title="No collaboration workspaces yet" detail="Start one, or accept an interest from a collaboration post in Feed." />}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((w) => (
          <div key={w.id} className="app-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold text-[var(--brand-ink)]">{w.title}</p>
              <span className="chip chip-sky !border-0 !text-[10px]">{COLLAB_STAGE_LABELS[w.stage] || w.stage}</span>
            </div>
            {w.research_area && <p className="mt-1 text-xs font-medium text-[var(--brand-muted)]">{w.research_area}</p>}
            <p className="mt-1 text-xs font-semibold text-[var(--brand-subtle)]">{w.member_count} member(s)</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const [tab, setTab] = useState('discover');

  return (
    <motion.div {...pageEnter} className="space-y-6 pb-12">
      <PageHeader title="Community" subtitle="Find mentors, PhD supervisors and collaborators; join communities; message in real time." />
      <div className="flex flex-wrap gap-2 border-b border-[var(--brand-border-soft)] pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${tab === t.id ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--brand-surface)] text-[var(--brand-muted)] hover:bg-[var(--brand-primary-softer)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'discover' && <DiscoverTab />}
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'communities' && <CommunitiesTab />}
      {tab === 'feed' && <FeedTab />}
      {tab === 'workspaces' && <WorkspacesTab />}
      {tab === 'messages' && <MessagesPanel />}
    </motion.div>
  );
}
