"""Versioned API router for compulsory product capabilities."""

from fastapi import APIRouter

from . import action_inbox, activities, admin, admin_requests, appraisals, auth_profile, career, cv_import, deadline_rescue, evidence, forms, grantops, lor, network, notifications, publications, reconstruct, shared_facts, teaching_change

api_router = APIRouter()
api_router.include_router(auth_profile.router)
api_router.include_router(action_inbox.router)
api_router.include_router(grantops.router)
api_router.include_router(activities.router)
api_router.include_router(evidence.router)
api_router.include_router(publications.router)
api_router.include_router(appraisals.router)
api_router.include_router(admin.router)
api_router.include_router(notifications.router)
api_router.include_router(cv_import.router)
api_router.include_router(career.router)
api_router.include_router(career.opportunities_router)
api_router.include_router(career.admin_router)
api_router.include_router(shared_facts.admin_router)
api_router.include_router(shared_facts.faculty_router)
api_router.include_router(reconstruct.router)
api_router.include_router(forms.router)
api_router.include_router(deadline_rescue.router)
api_router.include_router(admin_requests.router)
api_router.include_router(admin_requests.reports_router)
api_router.include_router(teaching_change.router)
api_router.include_router(lor.router)
api_router.include_router(lor.students_router)
api_router.include_router(network.router)
api_router.include_router(network.messages_router)
