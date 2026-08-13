"""Feed every fixture under test-files/ through the REAL parsing code paths
(app/services/document_text.py, any_form.py, cv_import.py, teaching_change.py)
-- the same functions the API layer calls after a real upload -- and report
pass/fail per fixture.

CV Import accepts PDF/DOCX/XLSX (deterministic extraction) and JPG/scanned
PDF (Groq vision-model OCR, extract_text_with_ocr_fallback) -- the OCR
checks make a real Groq API call using GROQ_API_KEY from .env, so they're
skipped (reported as a failure, not silently ignored) if no key is
configured. A plain-text CV is still a genuine "wrong format" edge case:
it must be rejected at upload with a 415, not silently accepted.

This does not exercise the HTTP layer (signed upload URLs, Supabase Storage,
auth) -- it proves the extraction/parsing logic itself is correct against
real file bytes, which is the part most likely to silently misbehave.

Run from anywhere:
    backend/.venv/Scripts/python.exe test-files/run_checks.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent / "backend"))

from app.api.cv_import import ALLOWED_CV_MIME_TYPES  # noqa: E402
from app.api.forms import ALLOWED_FORM_MIME_TYPES  # noqa: E402
from app.core.config import Settings, get_settings  # noqa: E402
from app.services.any_form import compute_coverage, detect_fields_xlsx, resolve_field  # noqa: E402
from app.services.career import evaluate_career_rules  # noqa: E402
from app.services.cv_import import extract_cv_activities  # noqa: E402
from app.services.document_text import extract_text, extract_text_with_ocr_fallback  # noqa: E402
from app.services.llm import LLMProvider  # noqa: E402
from app.services.teaching_change import SnapshotFile, diff_snapshots, has_meaningful_changes  # noqa: E402

PASS = "PASS"
FAIL = "FAIL"
results: list[tuple[str, str, str]] = []  # (section, check, detail)


def record(section: str, ok: bool, check: str, detail: str = "") -> None:
    results.append((section, PASS if ok else FAIL, f"{check}{': ' + detail if detail else ''}"))


MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".jpg": "image/jpeg",
    ".txt": "text/plain",
}


def check_cv_import() -> None:
    section = "cv-import"
    no_llm = LLMProvider(Settings(groq_api_key=None))  # forces the deterministic heuristic path
    live_llm = LLMProvider(get_settings())  # real GROQ_API_KEY from .env -- OCR needs an actual model call

    # Deterministic formats: PDF (real text layer), DOCX, XLSX. No network call.
    for name in ("sample_cv.pdf", "sample_cv.docx", "sample_cv.xlsx"):
        path = ROOT / "cv-import" / name
        mime = MIME_BY_EXT[path.suffix]
        record(section, mime in ALLOWED_CV_MIME_TYPES, f"{name}: MIME accepted by upload-url check", mime)
        text = extract_text(path.read_bytes(), mime)
        record(section, bool(text.strip()), f"{name}: text extracted", f"{len(text)} chars")
        drafts = asyncio.run(extract_cv_activities(text, no_llm))
        categories = {d["category"] for d in drafts}
        record(
            section, len(drafts) >= 5 and "publication" in categories and "invited_talk" in categories,
            f"{name}: activities parsed", f"{len(drafts)} drafts, categories={sorted(categories)}",
        )

    # OCR formats: a photographed JPG (no text layer at all) and a scanned
    # PDF (image embedded as the page, get_text() returns empty). These make
    # a real Groq API call -- that's the point: it proves OCR actually reads
    # the fixture, not just that the code path exists.
    if not live_llm.configured:
        record(section, False, "OCR checks skipped: GROQ_API_KEY not configured in .env")
    else:
        ocr_targets = (("photographed_cv.jpg", "image/jpeg"), ("scanned_cv.pdf", "application/pdf"))
        for position, (name, mime) in enumerate(ocr_targets):
            if position > 0:
                # Two large vision calls back to back can trip the free
                # tier's tokens-per-minute limit even though each is well
                # within a single real upload's budget -- this pause is a
                # test-script artifact, not something a real single-file
                # upload needs.
                print("(pausing ~35s between OCR checks to stay under the Groq free-tier rate limit...)")
                import time as _time
                _time.sleep(35)
            path = ROOT / "cv-import" / name
            content = path.read_bytes()
            text = asyncio.run(extract_text_with_ocr_fallback(content, mime, live_llm))
            record(section, bool(text.strip()), f"{name}: OCR transcribed text", f"{len(text)} chars: {text[:80]!r}...")
            drafts = asyncio.run(extract_cv_activities(text, no_llm))
            record(section, len(drafts) >= 3, f"{name}: activities parsed from OCR text", f"{len(drafts)} drafts")

    # Still a genuine edge case: a format CV Import has never supported.
    path = ROOT / "cv-import" / "unsupported_cv.txt"
    mime = MIME_BY_EXT[path.suffix]
    record(section, mime not in ALLOWED_CV_MIME_TYPES, "unsupported_cv.txt: correctly rejected at upload (415), not silently accepted", mime)


def check_any_form() -> None:
    section = "any-form"
    path = ROOT / "any-form" / "matching_schema.xlsx"
    mime = MIME_BY_EXT[path.suffix]
    record(section, mime in ALLOWED_FORM_MIME_TYPES, "matching_schema.xlsx: MIME accepted", mime)
    fields = detect_fields_xlsx(path.read_bytes())
    labels = {f.label for f in fields}
    record(section, {"Faculty Name", "Department", "Number of Publications"} <= labels, "matching_schema.xlsx: expected labels detected", str(sorted(labels)))
    context = {"full_name": "Dr. Ananya Sharma", "department_name": "Computer Science", "category_counts": {"publication": 4}}
    field_rows = []
    for field in fields:
        value, confidence, resolve_status = resolve_field(field.label, context)
        field_rows.append({"status": resolve_status})
    coverage = compute_coverage(field_rows)
    record(section, coverage["fields_auto_filled"] >= 2, "matching_schema.xlsx: fields auto-filled from profile context", str(coverage))

    path = ROOT / "any-form" / "edge_case_no_labels.xlsx"
    fields = detect_fields_xlsx(path.read_bytes())
    record(section, fields == [], "edge_case_no_labels.xlsx: zero fields detected, no crash (honest empty result)", f"{len(fields)} fields")


def check_teaching_change() -> None:
    section = "teaching-change"
    v1_dir, v2_dir = ROOT / "teaching-change" / "course_v1", ROOT / "teaching-change" / "course_v2"
    import hashlib

    def snapshot(directory: Path) -> list[SnapshotFile]:
        files = []
        for path in sorted(directory.glob("*.pdf")):
            content = path.read_bytes()
            text = extract_text(content, "application/pdf")
            files.append(SnapshotFile(path.name, hashlib.sha256(content).hexdigest(), text))
        return files

    files_a, files_b = snapshot(v1_dir), snapshot(v2_dir)
    record(section, all(f.extracted_text and f.extracted_text.strip() for f in files_a + files_b), "PDF text extracted for every snapshot file")
    diff = diff_snapshots(files_a, files_b)
    record(section, diff["added"] == ["lab2_new.pdf"], "new file detected as added", str(diff["added"]))
    record(section, diff["unchanged"] == ["lab1.pdf"], "identical file detected as unchanged", str(diff["unchanged"]))
    record(section, len(diff["changed"]) == 1 and diff["changed"][0]["file_name"] == "syllabus.pdf", "edited file detected as changed", str(diff["changed"]))
    record(section, has_meaningful_changes(diff), "has_meaningful_changes reports True for this diff")


def check_career_dossier() -> None:
    """Career Growth is rules-over-data, not file-driven (already covered by
    backend/tests/test_usp_helpers.py's evaluate_career_rules/match_opportunities
    cases). The one part with no test coverage anywhere is the PDF generator
    itself -- check it against both a normal case and the zero-activities
    edge case (a brand new faculty account with a goal set but nothing
    confirmed yet), since that's exactly the kind of input a real demo hits."""

    section = "career-growth (dossier PDF)"
    from app.api.career import _dossier_pdf_bytes

    rules = [{"key": "research", "label": "Research publications", "categories": ["publication"], "min_count": 2}]
    activities = [{"id": "1", "category": "publication", "title": "Privacy-Preserving ML", "evidence_status": "attached"}]
    progress = evaluate_career_rules(rules, activities)
    pdf_bytes = _dossier_pdf_bytes("Dr. Ananya Sharma", "Associate Professor", progress, activities)
    record(section, pdf_bytes.startswith(b"%PDF"), "normal case: valid PDF produced", f"{len(pdf_bytes)} bytes")

    empty_progress = evaluate_career_rules(rules, [])
    pdf_bytes_empty = _dossier_pdf_bytes("Dr. New Faculty", "Assistant Professor", empty_progress, [])
    record(section, pdf_bytes_empty.startswith(b"%PDF"), "edge case: zero confirmed activities still produces a valid PDF", f"{len(pdf_bytes_empty)} bytes")


def check_lor_letter_export() -> None:
    section = "lor-studio (letter DOCX)"
    from app.api.lor import _letter_docx_bytes
    from app.services.lor import draft_letter

    from docx import Document
    import io as _io

    facts = {
        "student_name": "Rohan Mehta", "purpose": "ms", "faculty_name": "Dr. Ananya Sharma",
        "designation": "Associate Professor", "institution_name": "Vidyanagar Institute of Technology",
        "links": [{"relationship": "project guide", "course_or_project": "Capstone Project", "start_date": "August 2024", "end_date": "May 2025", "notes": "Consistently demonstrated initiative."}],
        "achievements": [{"title": "Best Capstone Award", "description": "Top final-year project", "achieved_on": "May 2025"}],
    }
    draft = draft_letter(facts)
    docx_bytes = _letter_docx_bytes(facts["student_name"], draft)
    reopened = Document(_io.BytesIO(docx_bytes))
    reopened_text = "\n".join(p.text for p in reopened.paragraphs)
    record(section, "Rohan Mehta" in reopened_text, "normal case: DOCX round-trips and contains the student's name")

    facts_no_achievements = {**facts, "achievements": []}
    draft_empty = draft_letter(facts_no_achievements)
    docx_bytes_empty = _letter_docx_bytes(facts_no_achievements["student_name"], draft_empty)
    record(section, docx_bytes_empty[:2] == b"PK", "edge case: no recorded achievements still produces a valid DOCX")


def check_evidence_library() -> None:
    section = "evidence-library"
    from app.api.evidence import ALLOWED_MIME_TYPES

    for name in ("sample_certificate.pdf", "sample_certificate.jpg"):
        path = ROOT / "evidence-library" / name
        mime = MIME_BY_EXT[path.suffix]
        record(section, mime in ALLOWED_MIME_TYPES, f"{name}: MIME accepted for upload", mime)


def main() -> None:
    check_cv_import()
    check_any_form()
    check_teaching_change()
    check_career_dossier()
    check_lor_letter_export()
    check_evidence_library()

    width = max(len(f"[{s}] {c}") for s, _, c in results)
    current_section = None
    failures = 0
    for section, status, check in results:
        if section != current_section:
            print(f"\n== {section} ==")
            current_section = section
        line = f"  {status:4}  {check}"
        print(line)
        if status == FAIL:
            failures += 1

    print(f"\n{len(results) - failures}/{len(results)} checks passed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
