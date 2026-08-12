"""Idempotently seed Supabase Auth and compulsory database demo data.

Passwords come only from environment variables. Run after applying the SQL
migration:

    python scripts/seed_supabase.py
"""

from __future__ import annotations

import os
import sys
from datetime import date
from typing import Any

import httpx


def env(name: str, *, required: bool = True) -> str:
    value = os.getenv(name, "").strip()
    if required and not value:
        raise RuntimeError(f"Missing {name}")
    return value


class SupabaseAdmin:
    def __init__(self) -> None:
        self.base = env("SUPABASE_URL").rstrip("/")
        self.key = env("SUPABASE_SERVICE_ROLE_KEY")
        self.client = httpx.Client(timeout=30)
        self.headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}

    def close(self) -> None:
        self.client.close()

    def auth_user(self, email: str, password: str, metadata: dict[str, Any]) -> str:
        response = self.client.get(f"{self.base}/auth/v1/admin/users", headers=self.headers, params={"page": 1, "per_page": 1000})
        response.raise_for_status()
        users = response.json().get("users", [])
        existing = next((item for item in users if item.get("email", "").lower() == email.lower()), None)
        if existing:
            user_id = existing["id"]
            update = self.client.put(f"{self.base}/auth/v1/admin/users/{user_id}", headers=self.headers, json={"password": password, "email_confirm": True, "user_metadata": metadata})
            update.raise_for_status()
            return user_id
        created = self.client.post(f"{self.base}/auth/v1/admin/users", headers=self.headers, json={"email": email, "password": password, "email_confirm": True, "user_metadata": metadata})
        created.raise_for_status()
        return created.json()["id"]

    def rows(self, table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        response = self.client.get(f"{self.base}/rest/v1/{table}", headers=self.headers, params={"select": "*", **params})
        response.raise_for_status()
        return response.json()

    def upsert(self, table: str, values: dict[str, Any], conflict: str) -> dict[str, Any]:
        headers = {**self.headers, "Prefer": f"resolution=merge-duplicates,return=representation"}
        response = self.client.post(f"{self.base}/rest/v1/{table}", headers=headers, params={"on_conflict": conflict}, json=values)
        response.raise_for_status()
        data = response.json()
        return data[0] if isinstance(data, list) else data

    def update(self, table: str, params: dict[str, Any], values: dict[str, Any]) -> None:
        response = self.client.patch(f"{self.base}/rest/v1/{table}", headers={**self.headers, "Prefer": "return=minimal"}, params=params, json=values)
        response.raise_for_status()


def main() -> int:
    admin = SupabaseAdmin()
    try:
        institution = admin.upsert("institutions", {"name": "Vidyanagar Institute of Technology", "short_name": "VIT-M", "city": "Mumbai"}, "name")
        institution_id = institution["id"]
        department = admin.upsert("departments", {"institution_id": institution_id, "name": "Computer Science", "code": "CSE"}, "institution_id,name")
        department_id = department["id"]

        faculty_email = env("SEED_FACULTY_EMAIL")
        admin_email = env("SEED_ADMIN_EMAIL")
        faculty_id = admin.auth_user(faculty_email, env("SEED_FACULTY_PASSWORD"), {"full_name": "Dr. Ananya Sharma", "role": "faculty", "institution": "Vidyanagar Institute of Technology", "department": "Computer Science", "employee_code": "FAC001"})
        admin_id = admin.auth_user(admin_email, env("SEED_ADMIN_PASSWORD"), {"full_name": "Dr. Meera Kulkarni", "role": "admin", "institution": "Vidyanagar Institute of Technology", "department": "Computer Science"})
        admin.upsert("profiles", {"id": faculty_id, "role": "faculty", "full_name": "Dr. Ananya Sharma", "email": faculty_email, "institution_id": institution_id, "department_id": department_id}, "id")
        admin.upsert("profiles", {"id": admin_id, "role": "admin", "full_name": "Dr. Meera Kulkarni", "email": admin_email, "institution_id": institution_id, "department_id": department_id}, "id")
        admin.upsert("faculty_profiles", {"profile_id": faculty_id, "institution_id": institution_id, "employee_code": "FAC001", "designation": "Associate Professor", "current_academic_year": "2025-26", "orcid_id": None}, "profile_id")
        admin.upsert("faculty_profiles", {"profile_id": admin_id, "institution_id": institution_id, "employee_code": "ADM001", "designation": "Head of Department", "current_academic_year": "2025-26"}, "profile_id")

        template = admin.upsert("appraisal_templates", {"institution_id": institution_id, "name": "Annual Faculty Appraisal", "description": "Annual appraisal template backed by confirmed academic activities."}, "institution_id,name")
        section_definitions = [
            (1, "Teaching", ["teaching"]),
            (2, "Research / Publications", ["research", "publication", "patent", "reviewing"]),
            (3, "Mentoring", ["mentorship"]),
            (4, "Institutional Service", ["committee", "institutional_service", "community_engagement"]),
            (5, "Workshops / FDP / Seminars", ["workshop_fdp", "seminar", "invited_talk", "conference"]),
            (6, "Projects / Grants", ["project", "grant"]),
            (7, "Other Contributions", ["award", "other"]),
        ]
        section_ids: dict[str, str] = {}
        for position, title, categories in section_definitions:
            section = admin.upsert("appraisal_sections", {"template_id": template["id"], "position": position, "title": title, "categories": categories, "required": position <= 6, "allow_free_text": True}, "template_id,position")
            section_ids[title] = section["id"]
        cycle = admin.upsert("appraisal_cycles", {"institution_id": institution_id, "name": "Annual Appraisal 2025-26", "academic_year": "2025-26", "opens_at": "2026-04-01T00:00:00Z", "due_at": "2026-08-20T23:59:59Z", "status": "open", "template_id": template["id"]}, "institution_id,academic_year")

        activities = [
            ("teaching", "Advanced Algorithms — semester teaching", "Delivered lectures and assessment for the postgraduate algorithms course.", "2025-07-15", "Computer Science"),
            ("teaching", "Curriculum revision for Data Structures", "Updated lab manual and outcomes mapping.", "2025-08-04", "Computer Science"),
            ("publication", "Deep Learning for Time Series Forecasting", "Peer-reviewed publication recorded from the faculty record.", "2025-09-15", "Springer"),
            ("publication", "Ethics-aware AI in higher education", "Research publication.", "2025-11-20", "IEEE"),
            ("workshop_fdp", "Five-day FDP on Generative AI in Education", "Completed faculty development programme.", "2025-10-06", "VIT-M"),
            ("seminar", "Invited seminar on responsible AI", "Delivered an invited seminar for postgraduate researchers.", "2025-12-12", "VIT-M"),
            ("mentorship", "Mentored final-year capstone team", "Guided a student team through a healthcare monitoring project.", "2026-01-18", "Computer Science"),
            ("committee", "Department research committee", "Served on the departmental research review committee.", "2026-02-10", "VIT-M"),
            ("project", "Principal investigator — campus analytics pilot", "Led a funded institutional research pilot.", "2026-03-05", "VIT-M"),
        ]
        for category, title, description, start_date, organization in activities:
            existing = admin.rows("academic_activities", {"owner_id": f"eq.{faculty_id}", "title": f"eq.{title}", "academic_year": "eq.2025-26"})
            if not existing:
                admin.upsert("academic_activities", {"owner_id": faculty_id, "category": category, "title": title, "description": description, "organization": organization, "start_date": start_date, "academic_year": "2025-26", "visibility": "private", "status": "confirmed", "source": "manual", "evidence_status": "none_needed", "confirmed_at": f"{start_date}T00:00:00Z"}, "id")
        print(f"Seeded institution={institution_id} faculty={faculty_id} admin={admin_id} cycle={cycle['id']}")
        return 0
    finally:
        admin.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, httpx.HTTPError, KeyError) as exc:
        print(f"Seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
