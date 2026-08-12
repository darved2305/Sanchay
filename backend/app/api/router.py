"""Versioned API router for compulsory product capabilities."""

from fastapi import APIRouter

from . import activities, admin, appraisals, auth_profile, evidence, notifications, publications

api_router = APIRouter()
api_router.include_router(auth_profile.router)
api_router.include_router(activities.router)
api_router.include_router(evidence.router)
api_router.include_router(publications.router)
api_router.include_router(appraisals.router)
api_router.include_router(admin.router)
api_router.include_router(notifications.router)
