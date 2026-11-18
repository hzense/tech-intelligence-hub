"""Bounded egress scenarios from archived aggregates, not billing attribution."""

import csv
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
PRIOR = BASE.parent.parent / "2026-11-17-neon-egress" / "analysis"
prior = json.loads((PRIOR / "calculations.json").read_text(encoding="utf-8"))
with (PRIOR / "routes.csv").open(encoding="utf-8", newline="") as handle:
    routes = list(csv.DictReader(handle))
assert len({row["route"] for row in routes}) == len(routes)
catalog_bytes = prior["current_catalog_content_bytes"]
signal_count = 184  # 2026-11-17 sources.md, not a new production measurement.
assert catalog_bytes == 303852 and "decimal MB" in prior["units"]
requests = sum(
    int(row["requests"])
    for row in routes
    if row["route"] in {"/resources/[id]", "/persons/[id]"}
)
assert requests == 1028
baseline_bytes = requests * catalog_bytes
assert round(baseline_bytes / 1_000_000, 2) == 312.36
by_relation = []
for related_count in [5, 10, 20, 50]:
    fraction = related_count / signal_count
    by_relation.append({
        "assumed_related_signals_per_request": related_count,
        "estimated_content_mb": baseline_bytes * fraction / 1_000_000,
        "estimated_content_reduction_percent": (1 - fraction) * 100,
    })
by_cache = []
metadata_bytes = 16384  # Explicit assumption for a version manifest, not measured.
for hit_rate in [0.5, 0.8, 0.9, 0.95]:
    total = baseline_bytes * (1 - hit_rate) + requests * metadata_bytes
    by_cache.append({
        "assumed_cache_hit_rate": hit_rate,
        "assumed_metadata_bytes_per_request": metadata_bytes,
        "estimated_content_plus_metadata_mb": total / 1_000_000,
        "estimated_reduction_percent": (1 - total / baseline_bytes) * 100,
    })
assert all(
    left["estimated_content_mb"] < right["estimated_content_mb"]
    for left, right in zip(by_relation, by_relation[1:])
)
assert all(
    left["estimated_content_plus_metadata_mb"] > right["estimated_content_plus_metadata_mb"]
    for left, right in zip(by_cache, by_cache[1:])
)
result = {
    "observation_date": "2026-11-17",
    "analysis_date": "2026-11-18",
    "units": "decimal MB; per selected 12-hour route cohort, not calendar-day totals",
    "catalog_signal_count": signal_count,
    "catalog_content_bytes": catalog_bytes,
    "selected_route_requests": requests,
    "conditional_baseline_content_mb": baseline_bytes / 1_000_000,
    "related_row_scenarios": by_relation,
    "cache_scenarios": by_cache,
    "limitations": "Assumed reads, association counts, uniform record size, cache hit rate and metadata size. Excludes ACL, protocol, report, other route and refresh-race overhead. Not measured savings or a billing forecast.",
}
(BASE / "scenarios.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
bars = [("Full catalog (184)", result["conditional_baseline_content_mb"])] + [
    (f'{row["assumed_related_signals_per_request"]} related (assumed)', row["estimated_content_mb"])
    for row in by_relation
]
svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="850" height="365" viewBox="0 0 850 365">',
    '<rect width="850" height="365" fill="white"/>',
    '<g font-family="Arial, sans-serif" fill="#243344" font-size="14">',
    '<text x="24" y="30" font-size="19">Scenario only: content egress for 1,028 detail requests (MB)</text>',
    '<text x="24" y="55">2026-11-17 aggregates; equal record sizes assumed; excludes other traffic.</text>',
]
for i, (label, mb) in enumerate(bars):
    y = 88 + i * 45
    width = mb / result["conditional_baseline_content_mb"] * 450
    color = "#9b5a39" if i == 0 else "#327884"
    svg.extend([
        f'<text x="24" y="{y + 19}">{label}</text>',
        f'<rect x="220" y="{y}" width="{width:.2f}" height="28" fill="{color}"/>',
        f'<text x="{230 + width:.2f}" y="{y + 19}">{mb:.2f} MB</text>',
    ])
svg.extend([
    '<text x="24" y="340">Not measured SQL attribution, observed savings, or a monthly forecast.</text>',
    '</g></svg>\n',
])
(BASE / "figures").mkdir(exist_ok=True)
(BASE / "figures/related-signals-scenario.svg").write_text("\n".join(svg), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
