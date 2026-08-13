"""USP 8 — deterministic promotion-rule evaluation and opportunity matching.

Every number here is a plain count against a configurable threshold -- no ML
score, no probability. This is the antidote to "AI scored you 0.7"
(PROJECT_V2.md §7, USP 8): a professor sees exactly which criterion is short
and by how much.
"""

from __future__ import annotations

from typing import Any


def evaluate_career_rules(rules: list[dict[str, Any]], activities: list[dict[str, Any]]) -> dict[str, Any]:
    """Evaluate a career goal's rules against a faculty member's confirmed activities.

    ``rules`` items: {key, label, categories: [activity_category,...], min_count}.
    An empty/missing ``categories`` list matches every activity (a general
    "total contribution" rule). Returns per-rule counts plus an overall
    evidence-completeness percentage across every activity used by any rule.
    """

    rule_results: list[dict[str, Any]] = []
    counted_activity_ids: set[str] = set()
    evidenced_activity_ids: set[str] = set()

    for rule in rules:
        categories = set(rule.get("categories") or [])
        matching = [a for a in activities if not categories or a.get("category") in categories]
        count = len(matching)
        threshold = int(rule.get("min_count", 0))
        satisfied = count >= threshold
        rule_results.append({
            "key": rule.get("key"),
            "label": rule.get("label", rule.get("key")),
            "categories": sorted(categories),
            "count": count,
            "threshold": threshold,
            "satisfied": satisfied,
            "gap": max(0, threshold - count),
        })
        for activity in matching:
            activity_id = str(activity.get("id"))
            counted_activity_ids.add(activity_id)
            if activity.get("evidence_status") == "attached":
                evidenced_activity_ids.add(activity_id)

    evidence_completeness = (
        round(len(evidenced_activity_ids) * 100 / len(counted_activity_ids), 1) if counted_activity_ids else 100.0
    )
    return {
        "rules": rule_results,
        "evidence_completeness": evidence_completeness,
        "satisfied": all(rule["satisfied"] for rule in rule_results) if rule_results else False,
    }


def match_opportunities(rule_results: list[dict[str, Any]], opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Recommend opportunities that close an unmet rule's gap, each with a stated reason.

    Matching is deterministic: an opportunity's ``kind``/``tags`` must
    intersect the gap rule's key or categories. No fuzzy ranking.
    """

    recommendations: list[dict[str, Any]] = []
    for rule in rule_results:
        if rule["satisfied"]:
            continue
        rule_tokens = {rule["key"], *rule.get("categories", [])}
        for opportunity in opportunities:
            opportunity_tokens = {opportunity.get("kind"), *(opportunity.get("tags") or [])}
            if rule_tokens & opportunity_tokens:
                recommendations.append({
                    "opportunity_id": opportunity["id"],
                    "gap_key": rule["key"],
                    "reason": (
                        f"Fills your {rule['label']} gap "
                        f"({rule['count']}/{rule['threshold']} completed)"
                        + (f"; deadline {opportunity['deadline']}" if opportunity.get("deadline") else "")
                        + "."
                    ),
                })
    return recommendations
