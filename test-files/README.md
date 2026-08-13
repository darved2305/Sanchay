# test-files

Real fixture files (real PDF/DOCX/XLSX/JPG bytes, not synthetic in-memory
objects) for manually or automatically exercising the upload-driven
features: CV Import, Any Form, Teaching Change Detector, and Evidence
Library. Includes edge cases a real demo is likely to hit.

## Regenerate

```
backend/.venv/Scripts/python.exe test-files/generate_fixtures.py
```

## Verify parsing works against these real files

```
backend/.venv/Scripts/python.exe test-files/run_checks.py
```

Runs the actual extraction/parsing/generation functions the API layer calls
(`document_text.extract_text`, `any_form.detect_fields_xlsx`,
`cv_import.extract_cv_activities`, `teaching_change.diff_snapshots`,
`career._dossier_pdf_bytes`, `lor._letter_docx_bytes`) against every fixture
below and reports pass/fail, 23 checks in total. It does not exercise the
HTTP layer (signed upload URLs, Supabase Storage, auth) -- for that, use the
files below through the running app/UI directly.

Career Growth and LOR Studio aren't file-upload features (Career Growth is
rules evaluated against your existing activities; LOR Studio drafts from
student/achievement records you enter) -- backend/tests/test_usp_helpers.py
already covers their rule-evaluation and letter-drafting logic with
synthetic data. What that suite didn't cover, and this script adds, is the
one part of each that touches real bytes: the generated Promotion Dossier
PDF and the generated LOR .docx, each checked against both a normal case and
a zero-data edge case (new faculty account, student with no recorded
achievements).

## Contents

- `cv-import/sample_cv.pdf`, `sample_cv.docx` -- realistic professor CV with
  one line per supported category (FDP, invited talk, publication,
  reviewing, mentorship, committee, award) plus one non-academic line that
  should NOT become an activity.
- `cv-import/unsupported_cv.jpg`, `unsupported_cv.xlsx` -- **edge case**: CV
  Import only accepts PDF/DOCX (`ALLOWED_CV_MIME_TYPES` in
  `backend/app/api/cv_import.py`). These prove the upload is rejected with a
  clear 415 rather than silently succeeding with zero activities. If you
  want CV Import to actually accept scanned/photographed CVs or spreadsheets,
  that's a real feature gap (no OCR or xlsx-text extraction exists today) --
  flag it and we can scope adding it.
- `any-form/matching_schema.xlsx` -- a form with recognizable `Label:` cells
  (Faculty Name, Department, Number of Publications, ...) that resolve
  against a faculty profile.
- `any-form/edge_case_no_labels.xlsx` -- a plain data table with no
  `Label:` cells at all, i.e. the wrong file uploaded by mistake. Should
  detect zero fields, not error.
- `teaching-change/course_v1/` vs `course_v2/` -- two syllabus snapshots:
  one file added (`lab2_new.pdf`), one unchanged (`lab1.pdf`), one edited
  (`syllabus.pdf`, one line added). Upload v1 as one snapshot and v2 as
  another, then compare.
- `evidence-library/sample_certificate.pdf`, `.jpg` -- generic evidence
  uploads (PDF and image) for the Evidence Library.

## Known gaps this surfaced

- CV Import: no path for image (OCR) or spreadsheet CVs -- PDF/DOCX only.
- `app/api/forms.py`'s docstring claims an LLM fallback for unrecognized
  form labels; no such call exists in the code. Every unmatched label
  becomes `needs_new_info` today.
