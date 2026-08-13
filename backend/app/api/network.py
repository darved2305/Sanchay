"""USP 9 — Academic Network: search/discovery, connections, communities, messaging."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import CurrentUser, require_faculty
from ..core.db import get_db
from ..services.network import rank_candidates
from .schemas import (
    CommunityCreate,
    CommunityPostCreate,
    ConnectionRequestCreate,
    ConnectionRespondRequest,
    MessageCreate,
    PostCommentCreate,
)
from .utils import rows_to_dicts

router = APIRouter(prefix="/community", tags=["network"])
messages_router = APIRouter(prefix="/messages", tags=["network"])

PROFILE_COLUMNS = """
    p.id, p.full_name, p.photo_url, p.bio, p.research_interests, p.expertise,
    p.open_to_mentorship, p.open_to_collaboration, p.accepting_phd_inquiries,
    i.name as institution_name, d.name as department_name, fp.designation
"""


async def _connection_state(session: AsyncSession, user_id: UUID, other_id: UUID) -> str:
    connected = await session.execute(
        text("select 1 from public.connections where (profile_id_a = :a and profile_id_b = :b) or (profile_id_a = :b and profile_id_b = :a)"),
        {"a": min(user_id, other_id), "b": max(user_id, other_id)},
    )
    if connected.first():
        return "connected"
    pending = await session.execute(
        text("select from_profile_id from public.connection_requests where status = 'pending' and ((from_profile_id = :user_id and to_profile_id = :other_id) or (from_profile_id = :other_id and to_profile_id = :user_id))"),
        {"user_id": user_id, "other_id": other_id},
    )
    row = pending.first()
    if row is None:
        return "none"
    return "pending_sent" if row[0] == user_id else "pending_received"


@router.get("/people")
async def search_people(
    q: str | None = Query(default=None, max_length=200),
    research_area: str | None = Query(default=None, max_length=200),
    open_to: str | None = Query(default=None, pattern="^(mentorship|collaboration|phd)$"),
    limit: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["p.id <> :user_id", "p.role = 'faculty'"]
    params: dict[str, Any] = {"user_id": user.user_id, "limit": limit}
    if q:
        clauses.append("(p.full_name ilike :q or p.bio ilike :q or :q_raw = any(p.expertise) or :q_raw = any(p.research_interests))")
        params["q"] = f"%{q}%"
        params["q_raw"] = q
    if research_area:
        clauses.append(":research_area = any(p.research_interests)")
        params["research_area"] = research_area
    if open_to == "mentorship":
        clauses.append("p.open_to_mentorship = true")
    elif open_to == "collaboration":
        clauses.append("p.open_to_collaboration = true")
    elif open_to == "phd":
        clauses.append("p.accepting_phd_inquiries = true")
    result = await session.execute(
        text(
            f"""
            select {PROFILE_COLUMNS}
            from public.profiles p
            left join public.institutions i on i.id = p.institution_id
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where {' and '.join(clauses)}
            order by p.full_name limit :limit
            """
        ),
        params,
    )
    people = rows_to_dicts(result.mappings().all())
    for person in people:
        person["connection_state"] = await _connection_state(session, user.user_id, person["id"])
    return {"items": people}


@router.get("/recommendations")
async def get_recommendations(
    intent: str | None = Query(default=None, pattern="^(mentor|phd_supervisor|collaborator)$"),
    user: CurrentUser = Depends(require_faculty),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    seeker_result = await session.execute(text("select research_interests, expertise, department_id from public.profiles where id = :id"), {"id": user.user_id})
    seeker_row = seeker_result.mappings().first()
    if seeker_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    seeker = dict(seeker_row)
    candidates_result = await session.execute(
        text(
            f"""
            select {PROFILE_COLUMNS}
            from public.profiles p
            left join public.institutions i on i.id = p.institution_id
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where p.id <> :user_id and p.role = 'faculty'
            limit 200
            """
        ),
        {"user_id": user.user_id},
    )
    candidates = rows_to_dicts(candidates_result.mappings().all())
    ranked = rank_candidates(seeker, candidates, intent)
    by_id = {str(c["id"]): c for c in candidates}
    items = []
    for entry in ranked[:20]:
        profile = by_id.get(str(entry["profile_id"]))
        if profile:
            items.append({**profile, "reasons": entry["reasons"], "connection_state": await _connection_state(session, user.user_id, profile["id"])})
    return {"items": items}


@router.post("/connections/requests")
async def send_connection_request(payload: ConnectionRequestCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if payload.to_profile_id == user.user_id:
        raise HTTPException(status_code=422, detail="Cannot connect with yourself")
    result = await session.execute(
        text(
            "insert into public.connection_requests (from_profile_id, to_profile_id, note) values (:from_id, :to_id, :note) "
            "on conflict (from_profile_id, to_profile_id) do update set note = excluded.note returning id, status::text as status"
        ),
        {"from_id": user.user_id, "to_id": payload.to_profile_id, "note": payload.note},
    )
    row = result.mappings().first()
    await session.execute(
        text("insert into public.notifications (profile_id, kind, title, body, link_path) values (:profile_id, 'connection_request', 'New connection request', :body, '/faculty/community')"),
        {"profile_id": payload.to_profile_id, "body": payload.note or "Someone wants to connect with you."},
    )
    await session.commit()
    return dict(row)


@router.get("/connections/requests")
async def list_connection_requests(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select r.id, r.note, r.status::text as status, r.created_at, p.id as from_profile_id, p.full_name as from_name, p.photo_url as from_photo_url
            from public.connection_requests r join public.profiles p on p.id = r.from_profile_id
            where r.to_profile_id = :user_id and r.status = 'pending' order by r.created_at desc
            """
        ),
        {"user_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.post("/connections/requests/{request_id}/respond")
async def respond_connection_request(request_id: UUID, payload: ConnectionRespondRequest, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text("select from_profile_id, to_profile_id, status::text as status from public.connection_requests where id = :id and to_profile_id = :user_id for update"),
        {"id": request_id, "user_id": user.user_id},
    )
    request_row = result.mappings().first()
    if request_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection request not found")
    if request_row["status"] != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Request is already {request_row['status']}")
    new_status = "accepted" if payload.action == "accept" else "declined"
    await session.execute(text("update public.connection_requests set status = cast(:status as connection_status), responded_at = now() where id = :id"), {"status": new_status, "id": request_id})
    if new_status == "accepted":
        a, b = sorted([request_row["from_profile_id"], request_row["to_profile_id"]], key=str)
        await session.execute(text("insert into public.connections (profile_id_a, profile_id_b) values (:a, :b) on conflict do nothing"), {"a": a, "b": b})
        await session.execute(
            text("insert into public.notifications (profile_id, kind, title, body, link_path) values (:profile_id, 'connection_accepted', 'Connection accepted', 'Your connection request was accepted.', '/faculty/community')"),
            {"profile_id": request_row["from_profile_id"]},
        )
    await session.commit()
    return {"status": new_status}


@router.get("/connections")
async def list_connections(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            f"""
            select {PROFILE_COLUMNS}
            from public.connections c
            join public.profiles p on p.id = (case when c.profile_id_a = :user_id then c.profile_id_b else c.profile_id_a end)
            left join public.institutions i on i.id = p.institution_id
            left join public.departments d on d.id = p.department_id
            left join public.faculty_profiles fp on fp.profile_id = p.id
            where c.profile_id_a = :user_id or c.profile_id_b = :user_id
            order by p.full_name
            """
        ),
        {"user_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.get("/communities")
async def list_communities(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select c.id, c.name, c.description, c.created_at, count(m.profile_id)::int as member_count,
                   exists(select 1 from public.community_members m2 where m2.community_id = c.id and m2.profile_id = :user_id) as joined
            from public.communities c left join public.community_members m on m.community_id = c.id
            group by c.id order by c.name
            """
        ),
        {"user_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.post("/communities")
async def create_community(payload: CommunityCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text("insert into public.communities (name, description, created_by) values (:name, :description, :created_by) returning id, name, description, created_at"),
        {"name": payload.name, "description": payload.description, "created_by": user.user_id},
    )
    row = result.mappings().first()
    await session.execute(text("insert into public.community_members (community_id, profile_id) values (:community_id, :profile_id)"), {"community_id": row["id"], "profile_id": user.user_id})
    await session.commit()
    return dict(row)


@router.post("/communities/{community_id}/join")
async def join_community(community_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    exists_result = await session.execute(text("select id from public.communities where id = :id"), {"id": community_id})
    if exists_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")
    await session.execute(text("insert into public.community_members (community_id, profile_id) values (:community_id, :profile_id) on conflict do nothing"), {"community_id": community_id, "profile_id": user.user_id})
    await session.commit()
    return {"ok": True}


@router.post("/communities/{community_id}/leave")
async def leave_community(community_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await session.execute(text("delete from public.community_members where community_id = :community_id and profile_id = :profile_id"), {"community_id": community_id, "profile_id": user.user_id})
    await session.commit()
    return {"ok": True}


@router.get("/feed")
async def get_feed(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select post.id, post.kind::text as kind, post.body, post.created_at, post.community_id,
                   author.id as author_id, author.full_name as author_name, author.photo_url as author_photo_url,
                   c.name as community_name,
                   (select count(*) from public.post_comments pc where pc.post_id = post.id)::int as comment_count,
                   (select count(*) from public.post_reactions pr where pr.post_id = post.id)::int as reaction_count,
                   exists(select 1 from public.post_reactions pr2 where pr2.post_id = post.id and pr2.profile_id = :user_id) as reacted
            from public.community_posts post
            join public.profiles author on author.id = post.author_id
            left join public.communities c on c.id = post.community_id
            where post.community_id is null
               or exists(select 1 from public.community_members m where m.community_id = post.community_id and m.profile_id = :user_id)
               or exists(select 1 from public.connections conn where (conn.profile_id_a = :user_id and conn.profile_id_b = post.author_id) or (conn.profile_id_b = :user_id and conn.profile_id_a = post.author_id))
            order by post.created_at desc limit 50
            """
        ),
        {"user_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.post("/posts")
async def create_post(payload: CommunityPostCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if payload.community_id:
        member = await session.execute(text("select 1 from public.community_members where community_id = :community_id and profile_id = :profile_id"), {"community_id": payload.community_id, "profile_id": user.user_id})
        if member.first() is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Join the community before posting in it")
    result = await session.execute(
        text("insert into public.community_posts (community_id, author_id, kind, body) values (:community_id, :author_id, cast(:kind as post_kind), :body) returning id, kind::text as kind, body, created_at"),
        {"community_id": payload.community_id, "author_id": user.user_id, "kind": payload.kind.value, "body": payload.body},
    )
    row = result.mappings().first()
    await session.commit()
    return dict(row)


@router.post("/posts/{post_id}/comments")
async def add_comment(post_id: UUID, payload: PostCommentCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    post_exists = await session.execute(text("select id from public.community_posts where id = :id"), {"id": post_id})
    if post_exists.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    result = await session.execute(
        text("insert into public.post_comments (post_id, author_id, body) values (:post_id, :author_id, :body) returning id, body, created_at"),
        {"post_id": post_id, "author_id": user.user_id, "body": payload.body},
    )
    row = result.mappings().first()
    await session.commit()
    return dict(row)


@router.get("/posts/{post_id}/comments")
async def list_comments(post_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            "select pc.id, pc.body, pc.created_at, p.full_name as author_name from public.post_comments pc "
            "join public.profiles p on p.id = pc.author_id where pc.post_id = :post_id order by pc.created_at"
        ),
        {"post_id": post_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@router.put("/posts/{post_id}/reaction")
async def add_reaction(post_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await session.execute(text("insert into public.post_reactions (post_id, profile_id) values (:post_id, :profile_id) on conflict do nothing"), {"post_id": post_id, "profile_id": user.user_id})
    await session.commit()
    return {"ok": True}


@router.delete("/posts/{post_id}/reaction")
async def remove_reaction(post_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await session.execute(text("delete from public.post_reactions where post_id = :post_id and profile_id = :profile_id"), {"post_id": post_id, "profile_id": user.user_id})
    await session.commit()
    return {"ok": True}


@messages_router.get("/conversations")
async def list_conversations(user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            select conv.id, peer.id as peer_id, peer.full_name as peer_name, peer.photo_url as peer_photo_url,
                   last_msg.body as last_message_body, last_msg.created_at as last_message_at,
                   (select count(*) from public.messages m where m.conversation_id = conv.id and m.created_at > coalesce(mine.last_read_at, 'epoch'::timestamptz) and m.sender_id <> :user_id)::int as unread_count
            from public.conversation_members mine
            join public.direct_conversations conv on conv.id = mine.conversation_id
            join public.conversation_members peer_member on peer_member.conversation_id = conv.id and peer_member.profile_id <> :user_id
            join public.profiles peer on peer.id = peer_member.profile_id
            left join lateral (
              select body, created_at from public.messages m where m.conversation_id = conv.id order by m.created_at desc limit 1
            ) last_msg on true
            where mine.profile_id = :user_id
            order by coalesce(last_msg.created_at, conv.created_at) desc
            """
        ),
        {"user_id": user.user_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@messages_router.post("/conversations")
async def start_conversation(payload: MessageCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if payload.peer_profile_id == user.user_id:
        raise HTTPException(status_code=422, detail="Cannot message yourself")
    existing = await session.execute(
        text(
            """
            select mine.conversation_id from public.conversation_members mine
            join public.conversation_members peer on peer.conversation_id = mine.conversation_id and peer.profile_id = :peer_id
            where mine.profile_id = :user_id
            """
        ),
        {"user_id": user.user_id, "peer_id": payload.peer_profile_id},
    )
    conversation_id = existing.scalar_one_or_none()
    if conversation_id is None:
        conversation_id = uuid4()
        await session.execute(text("insert into public.direct_conversations (id) values (:id)"), {"id": conversation_id})
        await session.execute(
            text("insert into public.conversation_members (conversation_id, profile_id) values (:conversation_id, :a), (:conversation_id, :b)"),
            {"conversation_id": conversation_id, "a": user.user_id, "b": payload.peer_profile_id},
        )
        await session.commit()
    return {"conversation_id": conversation_id}


async def _assert_conversation_member(session: AsyncSession, conversation_id: UUID, user_id: UUID) -> None:
    member = await session.execute(text("select 1 from public.conversation_members where conversation_id = :conversation_id and profile_id = :profile_id"), {"conversation_id": conversation_id, "profile_id": user_id})
    if member.first() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant in this conversation")


@messages_router.get("/conversations/{conversation_id}")
async def get_conversation_messages(conversation_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    await _assert_conversation_member(session, conversation_id, user.user_id)
    result = await session.execute(
        text("select id, sender_id, body, created_at from public.messages where conversation_id = :conversation_id order by created_at"),
        {"conversation_id": conversation_id},
    )
    return {"items": rows_to_dicts(result.mappings().all())}


@messages_router.post("/conversations/{conversation_id}")
async def send_message(conversation_id: UUID, payload: PostCommentCreate, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    await _assert_conversation_member(session, conversation_id, user.user_id)
    result = await session.execute(
        text("insert into public.messages (conversation_id, sender_id, body) values (:conversation_id, :sender_id, :body) returning id, sender_id, body, created_at"),
        {"conversation_id": conversation_id, "sender_id": user.user_id, "body": payload.body},
    )
    row = result.mappings().first()
    peer = await session.execute(text("select profile_id from public.conversation_members where conversation_id = :conversation_id and profile_id <> :sender_id"), {"conversation_id": conversation_id, "sender_id": user.user_id})
    peer_id = peer.scalar_one_or_none()
    if peer_id:
        await session.execute(
            text("insert into public.notifications (profile_id, kind, title, body, link_path) values (:profile_id, 'message', 'New message', :body, '/faculty/community')"),
            {"profile_id": peer_id, "body": payload.body[:200]},
        )
    await session.commit()
    return dict(row)


@messages_router.post("/conversations/{conversation_id}/read")
async def mark_conversation_read(conversation_id: UUID, user: CurrentUser = Depends(require_faculty), session: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    await _assert_conversation_member(session, conversation_id, user.user_id)
    await session.execute(text("update public.conversation_members set last_read_at = now() where conversation_id = :conversation_id and profile_id = :profile_id"), {"conversation_id": conversation_id, "profile_id": user.user_id})
    await session.commit()
    return {"ok": True}
