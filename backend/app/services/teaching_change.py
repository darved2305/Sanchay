"""USP 7 — Teaching Change Detector: deterministic diff first, LLM second.

Per PROJECT_V2.md USP 7: compute file-hash and line-level diffs between two
course snapshots deterministically, and only then let an LLM interpret the
*actual detected differences* into pedagogical language. Without an LLM
provider, deterministic descriptions are generated directly from the diff
stats -- "no meaningful changes detected" is an honest, valid output either
way, never fabricated.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Any


@dataclass
class SnapshotFile:
    file_name: str
    sha256: str
    extracted_text: str | None = None


def diff_snapshots(files_a: list[SnapshotFile], files_b: list[SnapshotFile]) -> dict[str, Any]:
    """Deterministic file-level diff by filename, then hash comparison."""

    by_name_a = {f.file_name: f for f in files_a}
    by_name_b = {f.file_name: f for f in files_b}
    added = sorted(set(by_name_b) - set(by_name_a))
    removed = sorted(set(by_name_a) - set(by_name_b))
    common = sorted(set(by_name_a) & set(by_name_b))
    changed: list[dict[str, Any]] = []
    unchanged: list[str] = []
    for name in common:
        file_a, file_b = by_name_a[name], by_name_b[name]
        if file_a.sha256 == file_b.sha256:
            unchanged.append(name)
            continue
        line_stats = _line_diff_stats(file_a.extracted_text or "", file_b.extracted_text or "")
        # A different file hash doesn't mean different content -- re-exporting
        # or re-saving a PDF/DOCX changes embedded metadata/timestamps even
        # when the visible text is untouched. Only report it as a real change
        # when the extracted text itself actually differs; otherwise this is
        # the same "no meaningful change" case as an identical hash.
        if line_stats["lines_added"] == 0 and line_stats["lines_removed"] == 0:
            unchanged.append(name)
            continue
        changed.append({"file_name": name, **line_stats})
    return {"added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def _line_diff_stats(text_a: str, text_b: str) -> dict[str, int]:
    lines_a = text_a.splitlines()
    lines_b = text_b.splitlines()
    matcher = difflib.SequenceMatcher(a=lines_a, b=lines_b)
    added_lines = removed_lines = 0
    for tag, a_start, a_end, b_start, b_end in matcher.get_opcodes():
        if tag == "replace":
            removed_lines += a_end - a_start
            added_lines += b_end - b_start
        elif tag == "delete":
            removed_lines += a_end - a_start
        elif tag == "insert":
            added_lines += b_end - b_start
    return {"lines_added": added_lines, "lines_removed": removed_lines}


def has_meaningful_changes(diff: dict[str, Any]) -> bool:
    return bool(diff["added"] or diff["removed"] or diff["changed"])


def deterministic_change_descriptions(diff: dict[str, Any]) -> list[dict[str, str]]:
    """Plain descriptions generated directly from the diff, no LLM needed."""

    descriptions: list[dict[str, str]] = []
    if diff["added"]:
        descriptions.append({
            "change_type": "material_added",
            "description": f"{len(diff['added'])} new file(s) added: {', '.join(diff['added'][:5])}"
            + ("…" if len(diff["added"]) > 5 else ""),
        })
    if diff["removed"]:
        descriptions.append({
            "change_type": "material_removed",
            "description": f"{len(diff['removed'])} file(s) removed: {', '.join(diff['removed'][:5])}"
            + ("…" if len(diff["removed"]) > 5 else ""),
        })
    for item in diff["changed"]:
        descriptions.append({
            "change_type": "material_modified",
            "description": f"\"{item['file_name']}\" modified ({item['lines_added']} lines added, {item['lines_removed']} lines removed)",
        })
    return descriptions


TEACHING_CHANGE_SCHEMA = {
    "type": "object",
    "properties": {
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "change_type": {
                        "type": "string",
                        "enum": ["new_lab", "curriculum_refresh", "new_tool", "new_assignment", "assessment_redesign", "material_added", "material_removed", "material_modified"],
                    },
                    "description": {"type": "string"},
                },
                "required": ["change_type", "description"],
            },
        }
    },
    "required": ["changes"],
}


async def summarize_changes(diff: dict[str, Any], llm: Any) -> list[dict[str, str]]:
    """Interpret the deterministic diff into pedagogical language via LLM,
    falling back to the deterministic descriptions when no provider is
    configured or the call fails."""

    deterministic = deterministic_change_descriptions(diff)
    if not deterministic:
        return []
    diff_summary = (
        f"Files added: {diff['added']}\n"
        f"Files removed: {diff['removed']}\n"
        f"Files changed (with line-level diff stats): {diff['changed']}\n"
        f"Files unchanged: {diff['unchanged']}"
    )
    llm_result = await llm.extract_structured(
        instruction=(
            "This is a deterministic file-level diff between two years of one course's teaching material "
            "(syllabus, slides, labs, assignments). Interpret ONLY the changes listed below into concrete "
            "pedagogical improvements (new lab, curriculum refresh, new tool, new assignment, assessment "
            "redesign). Never claim a change that isn't reflected in the diff, and never invent an outcome "
            "or improvement metric that isn't stated."
        ),
        source_text=diff_summary,
        json_schema=TEACHING_CHANGE_SCHEMA,
        schema_name="teaching_changes",
    )
    llm_changes = llm_result.get("changes") if llm_result else None
    if llm_changes:
        return [{"change_type": c["change_type"], "description": c["description"]} for c in llm_changes if c.get("description")]
    return deterministic
