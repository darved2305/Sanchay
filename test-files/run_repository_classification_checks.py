"""Feed every real file under test-files/repository-samples/ through the
ACTUAL Smart Academic Repository pipeline the API calls after a real
upload -- app/services/document_text.extract_text, then
app/services/repository_classify.classify_document (deterministic first,
falling back to a real Groq call when the deterministic pass isn't
confident) and, for anything that looks like a student-outcome document,
app/services/repository_classify.extract_student_outcome.

This is a REPORT, not a pass/fail assertion suite: nothing here hardcodes
what category/company/role a file "should" get. The point is to see what
the real pipeline actually produces against real research papers (pulled
from arXiv/PLOS/Nature) and realistic constructed offer/OJT letters, and
judge from that whether classification is working -- not to bake in the
expected answer and check it matches.

Run from anywhere (needs a real GROQ_API_KEY in .env to exercise the LLM
fallback path; deterministic-only results are still reported if absent):
    backend/.venv/Scripts/python.exe test-files/run_repository_classification_checks.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time
from pathlib import Path

logging.basicConfig(level=logging.WARNING, format="%(message)s")
_STANDARD_LOG_KEYS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message"}


class _ShowExtra(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        extra = {k: v for k, v in record.__dict__.items() if k not in _STANDARD_LOG_KEYS}
        if extra:
            record.msg = f"{record.msg} | {extra}"
        return True


logging.getLogger("app.services.llm").addFilter(_ShowExtra())

ROOT = Path(__file__).parent / "repository-samples"
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.core.config import get_settings  # noqa: E402
from app.services.document_text import extract_text  # noqa: E402
from app.services.llm import LLMProvider  # noqa: E402
from app.services.repository_classify import classify_document, extract_student_outcome  # noqa: E402

MIME_BY_EXT = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


async def classify_one(path: Path, llm: LLMProvider) -> dict:
    mime = MIME_BY_EXT[path.suffix.lower()]
    content = path.read_bytes()
    text = extract_text(content, mime)
    result = await classify_document(path.name, text, llm)
    outcome = await extract_student_outcome(path.name, text, llm)
    return {
        "file": path.name,
        "chars_extracted": len(text),
        "category": result.document_category,
        "type": result.document_type,
        "confidence": result.confidence,
        "needs_confirmation": result.needs_confirmation,
        "student_outcome": outcome,
    }


def print_result(folder: str, r: dict) -> None:
    print(f"\n[{folder}] {r['file']}")
    print(f"  extracted_text: {r['chars_extracted']} chars")
    print(f"  classify_document -> category={r['category']!r} type={r['type']!r} "
          f"confidence={r['confidence']} needs_confirmation={r['needs_confirmation']}")
    if r["student_outcome"] is not None:
        o = r["student_outcome"]
        print(f"  extract_student_outcome -> outcome_type={o.get('outcome_type')!r} "
              f"student_name={o.get('student_name')!r} company={o.get('company')!r} "
              f"role={o.get('role')!r} offer_date={o.get('offer_date')!r} "
              f"start_date={o.get('start_date')!r} end_date={o.get('end_date')!r} "
              f"confidence={o.get('confidence')}")


def main() -> None:
    llm = LLMProvider(get_settings())
    print(f"Groq configured: {llm.configured}  (LLM fallback only fires when the deterministic pass is unconfident)")

    name_filter = sys.argv[1:]  # optional: only run files whose name contains any of these substrings

    folders = ["research-papers", "journal-articles", "offer-letters", "ojt-letters"]
    all_results: list[tuple[str, dict]] = []
    first_llm_call_made = False

    for folder in folders:
        folder_path = ROOT / folder
        if not folder_path.exists():
            print(f"\n(skipping {folder}/ -- not found)")
            continue
        for path in sorted(folder_path.glob("*.pdf")):
            if name_filter and not any(f in path.name for f in name_filter):
                continue
            # Same free-tier pacing courtesy as run_checks.py's OCR checks --
            # only matters once we're actually about to make a second live
            # Groq call in a short window.
            if first_llm_call_made:
                time.sleep(20)
            r = asyncio.run(classify_one(path, llm))
            first_llm_call_made = llm.configured
            print_result(folder, r)
            all_results.append((folder, r))

    print(f"\n{len(all_results)} file(s) run through the real classification pipeline.")
    print("Review the categories/types/extracted fields above by eye -- this script")
    print("does not grade itself, since the whole point is to see the real output.")


if __name__ == "__main__":
    main()
