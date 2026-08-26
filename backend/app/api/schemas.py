"""Pydantic request contracts for the public API."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
import re
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ActivityCategory(StrEnum):
    teaching = "teaching"
    research = "research"
    publication = "publication"
    project = "project"
    grant = "grant"
    workshop_fdp = "workshop_fdp"
    seminar = "seminar"
    invited_talk = "invited_talk"
    mentorship = "mentorship"
    committee = "committee"
    institutional_service = "institutional_service"
    community_engagement = "community_engagement"
    award = "award"
    patent = "patent"
    reviewing = "reviewing"
    conference = "conference"
    other = "other"


class ActivityStatus(StrEnum):
    proposed = "proposed"
    confirmed = "confirmed"
    archived = "archived"


class EvidenceStatus(StrEnum):
    none_needed = "none_needed"
    pending = "pending"
    attached = "attached"


class ActivitySource(StrEnum):
    manual = "manual"
    cv_import = "cv_import"
    publication_sync = "publication_sync"
    reconstruction = "reconstruction"
    quick_capture = "quick_capture"
    batch_certificates = "batch_certificates"
    shared_fact = "shared_fact"
    evidence_import = "evidence_import"
    grantops = "grantops"


class SubmissionStatus(StrEnum):
    draft = "draft"
    submitted = "submitted"
    under_review = "under_review"
    returned = "returned"
    approved = "approved"
    rejected = "rejected"


class ReviewAction(StrEnum):
    comment = "comment"
    return_ = "return"
    approve = "approve"
    reject = "reject"


class ProfilePatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    employee_code: str | None = Field(default=None, max_length=80)
    institution_name: str | None = Field(default=None, max_length=300)
    department_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    photo_url: str | None = Field(default=None, max_length=1000)
    bio: str | None = Field(default=None, max_length=5000)
    research_interests: list[str] | None = Field(default=None, max_length=50)
    teaching_interests: list[str] | None = Field(default=None, max_length=50)
    expertise: list[str] | None = Field(default=None, max_length=50)
    career_goals: str | None = Field(default=None, max_length=5000)
    open_to_mentorship: bool | None = None
    open_to_collaboration: bool | None = None
    accepting_phd_inquiries: bool | None = None
    open_to_grant_collaboration: bool | None = None
    open_to_reviewing: bool | None = None
    designation: str | None = Field(default=None, max_length=200)
    date_joined: date | None = None
    current_academic_year: str | None = Field(default=None, max_length=30)
    orcid_id: str | None = Field(default=None, max_length=100)
    scholar_url: str | None = Field(default=None, max_length=1000)
    openalex_author_id: str | None = Field(default=None, max_length=100)
    qualifications: list[dict[str, Any]] | None = None
    phd_status: str | None = Field(default=None, max_length=40)

    @field_validator("research_interests", "teaching_interests", "expertise")
    @classmethod
    def clean_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [item.strip() for item in value if item.strip()]
        if any(len(item) > 100 for item in cleaned):
            raise ValueError("Tags must be at most 100 characters")
        return list(dict.fromkeys(cleaned))

    @field_validator("orcid_id")
    @classmethod
    def valid_orcid(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return value
        normalized = value.strip().removeprefix("https://orcid.org/").removeprefix("http://orcid.org/")
        if not re.fullmatch(r"\d{4}-\d{4}-\d{4}-[\dX]{4}", normalized, flags=re.IGNORECASE):
            raise ValueError("ORCID iD must use the 0000-0000-0000-0000 format")
        return normalized.upper() if normalized.endswith("x") else normalized


class ActivityCreate(BaseModel):
    category: ActivityCategory
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    role: str | None = Field(default=None, max_length=300)
    organization: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    start_date: date | None = None
    end_date: date | None = None
    duration_hours: Decimal | None = Field(default=None, ge=0, le=100000)
    academic_year: str = Field(min_length=4, max_length=30)
    doi: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=2000)
    metadata: dict[str, Any] = Field(default_factory=dict)
    visibility: Literal["private", "institution", "network"] = "private"
    evidence_status: EvidenceStatus = EvidenceStatus.none_needed

    @model_validator(mode="after")
    def valid_date_range(self) -> "ActivityCreate":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class ActivityPatch(BaseModel):
    category: ActivityCategory | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    role: str | None = Field(default=None, max_length=300)
    organization: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    start_date: date | None = None
    end_date: date | None = None
    duration_hours: Decimal | None = Field(default=None, ge=0, le=100000)
    academic_year: str | None = Field(default=None, min_length=4, max_length=30)
    doi: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=2000)
    metadata: dict[str, Any] | None = None
    visibility: Literal["private", "institution", "network"] | None = None
    evidence_status: EvidenceStatus | None = None

    @model_validator(mode="after")
    def valid_date_range(self) -> "ActivityPatch":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class BulkConfirmRequest(BaseModel):
    activity_ids: list[UUID] = Field(min_length=1, max_length=100)


class QuickAddRequest(BaseModel):
    text: str = Field(min_length=3, max_length=1000)


class ScholarImportRequest(BaseModel):
    # A full Google Scholar profile page (Ctrl+A copy) with dozens of
    # publications comfortably runs well past a few thousand characters.
    text: str = Field(min_length=40, max_length=60000)


class CareerGoalSetRequest(BaseModel):
    career_rule_id: UUID


class CareerRuleCreate(BaseModel):
    goal_key: str = Field(min_length=1, max_length=100)
    goal_label: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    rules: list[dict[str, Any]] = Field(min_length=1, max_length=20)


class ReconstructRunCreate(BaseModel):
    academic_year: str = Field(min_length=4, max_length=30)


class FormFieldPatch(BaseModel):
    value: str | None = Field(default=None, max_length=1000)


class DepartmentReportRequest(BaseModel):
    department: str | None = Field(default=None, max_length=200)
    academic_year: str | None = Field(default=None, max_length=30)


class AdminRequestProcessRequest(BaseModel):
    department: str | None = Field(default=None, max_length=200)
    academic_year: str | None = Field(default=None, max_length=30)


class CourseSnapshotCreate(BaseModel):
    course_title: str = Field(min_length=1, max_length=300)
    academic_year: str = Field(min_length=4, max_length=30)


class TeachingCompareRequest(BaseModel):
    snapshot_a_id: UUID
    snapshot_b_id: UUID

    @model_validator(mode="after")
    def distinct_snapshots(self) -> "TeachingCompareRequest":
        if self.snapshot_a_id == self.snapshot_b_id:
            raise ValueError("snapshot_a_id and snapshot_b_id must be different snapshots")
        return self


class StudentLinkCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    roll_number: str | None = Field(default=None, max_length=100)
    program: str | None = Field(default=None, max_length=200)
    relationship: str = Field(min_length=1, max_length=100)
    course_or_project: str | None = Field(default=None, max_length=300)
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def valid_date_range(self) -> "StudentLinkCreate":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class StudentAchievementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=2000)
    achieved_on: date | None = None


class LorPurpose(StrEnum):
    ms = "ms"
    job = "job"
    scholarship = "scholarship"
    phd = "phd"


class LetterDraftRequest(BaseModel):
    student_id: UUID
    purpose: LorPurpose


class LetterDraftUpdate(BaseModel):
    draft_text: str = Field(min_length=1, max_length=20000)


class ConnectionRequestCreate(BaseModel):
    to_profile_id: UUID
    note: str | None = Field(default=None, max_length=1000)


class ConnectionRespondRequest(BaseModel):
    action: Literal["accept", "decline"]


class CommunityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class PostKind(StrEnum):
    post = "post"
    question = "question"
    opportunity = "opportunity"
    collaboration = "collaboration"
    announcement = "announcement"


class CollaborationPayload(BaseModel):
    research_area: str | None = Field(default=None, max_length=200)
    looking_for: str | None = Field(default=None, max_length=200)
    skills_needed: list[str] = Field(default_factory=list, max_length=15)


class CommunityPostCreate(BaseModel):
    community_id: UUID | None = None
    kind: PostKind = PostKind.post
    body: str = Field(min_length=1, max_length=5000)
    collaboration_payload: CollaborationPayload | None = None


class PostCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ReactionRequest(BaseModel):
    reaction_type: Literal["like", "insightful", "celebrate"] = "like"


class CollaborationWorkspaceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    research_area: str | None = Field(default=None, max_length=200)
    goal: str | None = Field(default=None, max_length=2000)
    source_post_id: UUID | None = None


class CollaborationMemberAdd(BaseModel):
    profile_id: UUID
    role: str | None = Field(default=None, max_length=100)


class MessageCreate(BaseModel):
    peer_profile_id: UUID


class InstitutionEventParticipant(BaseModel):
    profile_id: UUID
    role: str = Field(default="participant", max_length=100)


class InstitutionEventCreate(BaseModel):
    category: ActivityCategory
    title: str = Field(min_length=1, max_length=300)
    organization: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    start_date: date | None = None
    end_date: date | None = None
    participants: list[InstitutionEventParticipant] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def valid_date_range(self) -> "InstitutionEventCreate":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class EvidenceUploadRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    mime: str = Field(min_length=1, max_length=150)
    size: int = Field(gt=0, le=25 * 1024 * 1024)


class EvidenceAttachRequest(BaseModel):
    activity_id: UUID


class EvidenceClassificationConfirm(BaseModel):
    document_category: str | None = Field(default=None, max_length=60)
    document_type: str | None = Field(default=None, max_length=120)


class ActionInboxStatusUpdate(BaseModel):
    action: Literal["save", "accept", "decline", "sent_to_grantops", "start_collaboration", "ignore"]


class ActionInboxDraftRequest(BaseModel):
    reply_type: Literal["accept", "conditional", "decline"]
    edited_text: str | None = Field(default=None, max_length=8000)
    polish: bool = False


class EvidenceBulkDownloadRequest(BaseModel):
    evidence_ids: list[UUID] | None = Field(default=None, max_length=500)
    document_category: str | None = Field(default=None, max_length=60)
    year: int | None = Field(default=None, ge=1900, le=2200)
    tag: str | None = Field(default=None, max_length=100)


class GrantOpportunityCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    agency: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    url: str | None = Field(default=None, max_length=500)
    deadline: date | None = None
    amount: str | None = Field(default=None, max_length=100)
    disciplines: list[str] = Field(default_factory=list, max_length=20)
    eligibility_rules: dict[str, Any] = Field(default_factory=dict)
    required_documents: list[str] = Field(default_factory=list, max_length=30)


class GrantStageUpdate(BaseModel):
    stage: Literal[
        "discovered", "interested", "eligibility_check", "team_formation", "preparing",
        "internal_review", "ready_to_submit", "submitted", "awarded", "rejected",
        "active", "completed", "archived",
    ]
    notes: str | None = Field(default=None, max_length=4000)


class GrantTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_date: date | None = None


class GrantMemberInvite(BaseModel):
    profile_id: UUID
    role: str | None = Field(default=None, max_length=100)


class GrantAwardRequest(BaseModel):
    award_amount: str | None = Field(default=None, max_length=100)


class CareerGoalParseRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


class CareerGoalCustomCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    target_date: date | None = None
    measurable_outcomes: list[dict[str, Any]] = Field(default_factory=list, max_length=10)
    raw_text: str | None = Field(default=None, max_length=2000)
    source: Literal["custom", "suggested"] = "custom"


class CareerGoalStatusUpdate(BaseModel):
    status: Literal["active", "dismissed", "completed"]


class PublicationCandidateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: UUID
    profile_id: UUID
    publication_id: UUID
    source: str
    status: str
    match_score: Decimal | float | None = None
    match_reasons: dict[str, Any] | list[Any] | None = None
    publication: dict[str, Any] | None = None


class AppraisalCycleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    academic_year: str = Field(min_length=4, max_length=30)
    template_id: UUID
    opens_at: datetime | None = None
    due_at: datetime | None = None

    @model_validator(mode="after")
    def valid_dates(self) -> "AppraisalCycleCreate":
        if self.opens_at and self.due_at and self.due_at < self.opens_at:
            raise ValueError("due_at cannot be before opens_at")
        return self


class SubmissionItemUpdate(BaseModel):
    section_id: UUID
    activity_id: UUID | None = None
    free_text: str | None = Field(default=None, max_length=10000)
    faculty_note: str | None = Field(default=None, max_length=10000)
    position: int = Field(default=0, ge=0, le=10000)


class SubmissionItemsPatch(BaseModel):
    items: list[SubmissionItemUpdate] = Field(max_length=1000)


class SubmissionReviewRequest(BaseModel):
    action: ReviewAction
    section_id: UUID | None = None
    comment: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def comment_required_for_return(self) -> "SubmissionReviewRequest":
        if self.action in {ReviewAction.return_, ReviewAction.comment} and not (self.comment and self.comment.strip()):
            action = "returning" if self.action == ReviewAction.return_ else "commenting on"
            raise ValueError(f"A comment is required when {action} a submission")
        return self


class NotificationReadRequest(BaseModel):
    ids: list[UUID] | None = Field(default=None, max_length=1000)
    all: bool = False

    @model_validator(mode="after")
    def has_target(self) -> "NotificationReadRequest":
        if not self.all and not self.ids:
            raise ValueError("Provide ids or set all=true")
        return self


class ApiPage(BaseModel):
    items: list[dict[str, Any]]
    next_cursor: str | None = None
