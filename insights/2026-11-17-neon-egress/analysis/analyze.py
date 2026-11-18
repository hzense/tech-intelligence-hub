"""Recompute read-only observations; no external dependencies or network calls."""
import csv
import json
from datetime import datetime
from html import escape
from pathlib import Path

BASE = Path(__file__).resolve().parent


def read_csv(name):
    with (BASE / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


daily = read_csv("daily.csv")
assert len({row["day_label"] for row in daily}) == len(daily)
for row in daily:
    row["hours"] = (datetime.fromisoformat(row["through"]) - datetime.fromisoformat(row["from"])).total_seconds() / 3600
    assert row["hours"] > 0 and row["coverage"] == "partial"
    row["mb"] = float(row["egress_mb"])
    assert row["mb"] >= 0
    row["mb_per_hour"] = row["mb"] / row["hours"]

last, prior = daily[-1], daily[-2]
catalog_bytes = 303852
routes = read_csv("routes.csv")
detail_requests = sum(int(row["requests"]) for row in routes if row["route"] in {"/resources/[id]", "/persons/[id]"})
values = {
    "units": "decimal MB; timestamps Europe/Berlin",
    "last_label": last["day_label"],
    "last_window_hours": last["hours"],
    "last_window_mb_per_hour": last["mb_per_hour"],
    "previous_window_mb_per_hour": prior["mb_per_hour"],
    "hourly_rate_ratio_vs_previous_window": last["mb_per_hour"] / prior["mb_per_hour"],
    "last_24h_equivalent_mb_if_constant_rate": last["mb_per_hour"] * 24,
    "current_catalog_content_bytes": catalog_bytes,
    "current_12h_resource_person_requests": detail_requests,
    "scenario_one_catalog_read_per_detail_request_mb": catalog_bytes * detail_requests / 1_000_000,
    "scenario_catalog_reads_equivalent_to_778_94mb": last["mb"] * 1_000_000 / catalog_bytes,
    "current_12h_identified_bot_requests": sum(int(row["requests"]) for row in read_csv("bots.csv")),
    "limitations": "Scenario only, not measured SQL counts or attribution. Current 12h traffic is not yesterday. Daily labels cover partial, unequal intervals.",
}
(BASE / "calculations.json").write_text(json.dumps(values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Operational bar chart: actual observed partial windows, not calendar-day totals.
bars = []
shown = daily[-7:]
for index, row in enumerate(shown):
    x = 105 + index * 93
    height = row["mb"] / 800 * 270
    color = "#b54c32" if index == len(shown) - 1 else "#47789b"
    bars.append(f'<rect x="{x}" y="{360-height:.2f}" width="52" height="{height:.2f}" fill="{color}"/>')
    bars.append(f'<text x="{x+26}" y="{350-height:.2f}" text-anchor="middle">{row["mb"]:.2f}</text>')
    bars.append(f'<text x="{x+26}" y="383" text-anchor="middle">{escape(row["day_label"][5:])}</text>')
    bars.append(f'<text x="{x+26}" y="405" text-anchor="middle">{row["hours"]:.2f} h</text>')
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="800" height="470" viewBox="0 0 800 470">
<rect width="800" height="470" fill="white"/><g font-family="Arial, sans-serif" font-size="13" fill="#263444">
<text x="35" y="30" font-size="19">Neon egress: observed partial windows (MB)</text>
<text x="35" y="54">Labels are NOT midnight-to-midnight totals. Europe/Berlin.</text>
<line x1="75" y1="90" x2="75" y2="360" stroke="#777"/><line x1="75" y1="360" x2="760" y2="360" stroke="#777"/>
<text x="35" y="95">800</text><text x="50" y="365">0</text>
''' + "\n".join(bars) + '''
<text x="35" y="445">Source: hzense.com/admin/dashboard, observed 2026-11-17; rounded to 0.01 MB.</text>
</g></svg>'''
(BASE / "figures").mkdir(exist_ok=True)
(BASE / "figures" / "partial-window-egress.svg").write_text(svg, encoding="utf-8")
print(json.dumps(values, ensure_ascii=False, indent=2))
