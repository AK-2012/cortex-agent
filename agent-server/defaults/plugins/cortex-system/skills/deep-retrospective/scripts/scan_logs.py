#!/usr/bin/env python3
# input: date range / keywords CLI args, optional --log-dir or --project-dir, local Claude Code log directory under ~/.claude/projects/, retrospective index under <project>/context/retrospectives/CORTEX.md
# output: ranked matching session metadata printed to stdout and written to _scan_results.json in the resolved log directory
# pos: provides session log scanning for deep-retrospective, automatically deriving the correct Claude log project slug from the current Cortex project path, and applying decay weighting to date ranges already covered by retrospectives to prevent old work from repeatedly ranking first
# >>> If I am updated, be sure to update my header comment and the CORTEX.md in the same folder <<<
"""
Scan Claude Code conversation logs for relevant sessions by date range and keywords.

Usage:
  python scan_logs.py --from 2026-03-01 --to 2026-03-03 --keywords "video,compose,render"
  python scan_logs.py --from 2026-03-01 --to 2026-03-03 --keywords "auth,login" --verbose

Output: JSON list of matching sessions with metadata and relevance scores.
"""

import os
import json
import glob
import argparse
import math
import re
from pathlib import Path
from datetime import datetime, timezone


DEFAULT_PROJECT_DIR = Path(__file__).resolve().parents[4]
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
RETROSPECTIVE_INDEX_PATH = (
    DEFAULT_PROJECT_DIR / "context" / "retrospectives" / "CORTEX.md"
)
RETROSPECTIVE_DECAY = 0.2
DATE_RANGE_RE = re.compile(
    r"(?P<start>\d{4}-\d{2}-\d{2})(?:\s*~\s*(?P<end>\d{4}-\d{2}-\d{2}))?"
)
SINGLE_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
MONTH_DAY_RE = re.compile(
    r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b",
    re.IGNORECASE,
)


def project_path_to_slug(project_dir):
    """Convert an absolute project path to Claude Code's project slug."""
    resolved = project_dir.expanduser().resolve()
    return str(resolved).replace(os.sep, "-")


def resolve_log_dir(project_dir=None, explicit_log_dir=None):
    """Resolve the Claude log directory for the current project."""
    if explicit_log_dir:
        return Path(explicit_log_dir).expanduser().resolve()

    base_project_dir = Path(project_dir).expanduser() if project_dir else DEFAULT_PROJECT_DIR
    slug = project_path_to_slug(base_project_dir)
    return (CLAUDE_PROJECTS_DIR / slug).resolve()


LOG_DIR = resolve_log_dir()


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def parse_markdown_row(line):
    line = line.strip()
    if not line.startswith("|"):
        return None
    cells = [cell.strip() for cell in line.strip("|").split("|")]
    if len(cells) < 4:
        return None
    if all(set(cell) <= {"-", ":"} for cell in cells):
        return None
    return cells


def infer_date_range_from_source(source_text, fallback_date):
    if not source_text:
        return fallback_date, fallback_date

    range_match = DATE_RANGE_RE.search(source_text)
    if range_match:
        start = parse_date(range_match.group("start"))
        end_str = range_match.group("end") or range_match.group("start")
        end = parse_date(end_str)
        return start, end

    all_iso_dates = SINGLE_DATE_RE.findall(source_text)
    if all_iso_dates:
        parsed = [parse_date(d) for d in all_iso_dates]
        return min(parsed), max(parsed)

    if MONTH_DAY_RE.search(source_text):
        parsed = []
        year = fallback_date.year
        for raw in MONTH_DAY_RE.findall(source_text):
            for fmt in ("%b %d", "%B %d"):
                try:
                    dt = datetime.strptime(raw, fmt).replace(
                        year=year, tzinfo=timezone.utc
                    )
                    parsed.append(dt)
                    break
                except ValueError:
                    continue
        if parsed:
            return min(parsed), max(parsed)

    return fallback_date, fallback_date


def load_retrospective_coverage(index_path=RETROSPECTIVE_INDEX_PATH):
    """Load retrospective report date coverage from retrospectives/CORTEX.md."""
    if not index_path.exists():
        return []

    coverage = []
    try:
        with open(index_path, encoding="utf-8") as f:
            for raw_line in f:
                row = parse_markdown_row(raw_line)
                if not row or row[0] == "File":
                    continue
                report_file, report_date_text, _topic, output = row[:4]
                report_date = parse_date(report_date_text)
                covered_from, covered_to = infer_date_range_from_source(
                    output, report_date
                )
                coverage.append(
                    {
                        "file": report_file.strip("`").strip(),
                        "report_date": report_date,
                        "covered_from": covered_from,
                        "covered_to": covered_to.replace(
                            hour=23, minute=59, second=59
                        ),
                    }
                )
    except Exception:
        return []

    return coverage


def find_covering_retrospectives(session_start, session_end, coverage):
    if not session_start and not session_end:
        return []

    start = session_start or session_end
    end = session_end or session_start
    matches = []
    for item in coverage:
        if item["covered_from"] <= end and start <= item["covered_to"]:
            matches.append(item)
    return matches


def compute_relevance(total_hits, total_chars, coverage_count):
    base_score = total_hits * math.log1p(total_chars)
    if coverage_count <= 0:
        return base_score
    return base_score * (RETROSPECTIVE_DECAY ** coverage_count)


def scan_session(path, keywords, date_from, date_to, retrospective_coverage=None):
    """Scan a single JSONL session file. Return metadata if relevant."""
    stat = os.stat(path)
    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)

    # Quick filter by modification time
    if mtime < date_from or mtime > date_to:
        return None

    # Read and analyze
    messages = []
    first_ts = None
    last_ts = None
    keyword_hits = {}
    total_chars = 0

    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Extract timestamp
                ts_str = record.get("timestamp")
                if ts_str:
                    try:
                        ts = datetime.fromisoformat(
                            ts_str.replace("Z", "+00:00"))
                        if first_ts is None:
                            first_ts = ts
                        last_ts = ts
                    except ValueError:
                        pass

                # Extract text content
                text = extract_text(record)
                if not text:
                    continue

                total_chars += len(text)
                text_lower = text.lower()

                # Count keyword hits
                for kw in keywords:
                    kw_lower = kw.lower().strip()
                    if kw_lower in text_lower:
                        count = text_lower.count(kw_lower)
                        keyword_hits[kw_lower] = (
                            keyword_hits.get(kw_lower, 0) + count
                        )

                # Collect message summaries
                msg_type = record.get("type", "")
                if msg_type in ("user", "assistant") and len(text) > 10:
                    messages.append({
                        "type": msg_type,
                        "preview": text[:200],
                        "length": len(text),
                    })
    except Exception:
        return None

    if not keyword_hits:
        return None

    total_hits = sum(keyword_hits.values())
    session_id = os.path.basename(path).replace(".jsonl", "")

    # Check for subagent logs
    subagent_dir = os.path.join(
        os.path.dirname(path), session_id, "subagents"
    )
    subagent_files = []
    if os.path.isdir(subagent_dir):
        subagent_files = glob.glob(
            os.path.join(subagent_dir, "*.jsonl")
        )

    covered_by = find_covering_retrospectives(
        first_ts, last_ts, retrospective_coverage or []
    )
    relevance_score = compute_relevance(total_hits, total_chars, len(covered_by))

    return {
        "session_id": session_id,
        "path": path,
        "size_kb": round(stat.st_size / 1024, 1),
        "first_timestamp": first_ts.isoformat() if first_ts else None,
        "last_timestamp": last_ts.isoformat() if last_ts else None,
        "total_chars": total_chars,
        "message_count": len(messages),
        "keyword_hits": keyword_hits,
        "total_hits": total_hits,
        "subagent_count": len(subagent_files),
        "subagent_paths": subagent_files,
        "retrospective_coverage_count": len(covered_by),
        "retrospective_reports": [item["file"] for item in covered_by],
        "relevance_score": relevance_score,
        "score_decay_applied": len(covered_by) > 0,
    }


def extract_text(record):
    """Extract readable text from a log record."""
    # Direct content field (queue operations)
    if record.get("type") == "queue-operation":
        return record.get("content", "")

    # Message content
    msg = record.get("message")
    if not msg:
        return ""

    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(item.get("text", ""))
                elif item.get("type") == "tool_use":
                    inp = item.get("input", {})
                    # Capture tool inputs that contain searchable text
                    for v in inp.values():
                        if isinstance(v, str) and len(v) > 5:
                            parts.append(v)
                elif item.get("type") == "tool_result":
                    sub = item.get("content", "")
                    if isinstance(sub, str):
                        parts.append(sub)
                    elif isinstance(sub, list):
                        for s in sub:
                            if isinstance(s, dict) and s.get("text"):
                                parts.append(s["text"])
        return "\n".join(parts)
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="Scan Claude Code logs by date range and keywords"
    )
    parser.add_argument(
        "--from", dest="date_from", required=True,
        help="Start date (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--to", dest="date_to", required=True,
        help="End date inclusive (YYYY-MM-DD)"
    )
    parser.add_argument(
        "--keywords", required=True,
        help="Comma-separated keywords to search"
    )
    parser.add_argument(
        "--log-dir", default=None,
        help="Log directory path (overrides automatic project-slug resolution)"
    )
    parser.add_argument(
        "--project-dir", default=str(DEFAULT_PROJECT_DIR),
        help="Project directory used to derive the Claude log project slug"
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Include message previews in output"
    )
    parser.add_argument(
        "--top", type=int, default=20,
        help="Return top N sessions by relevance"
    )
    args = parser.parse_args()

    date_from = parse_date(args.date_from)
    # End of day for the to-date
    date_to = parse_date(args.date_to).replace(
        hour=23, minute=59, second=59
    )
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    log_dir = resolve_log_dir(args.project_dir, args.log_dir)
    retrospective_coverage = load_retrospective_coverage()

    log_files = glob.glob(os.path.join(log_dir, "*.jsonl"))
    print(f"Scanning {len(log_files)} session files...", flush=True)
    print(f"Log dir: {log_dir}", flush=True)
    print(f"Date range: {args.date_from} to {args.date_to}", flush=True)
    print(f"Keywords: {keywords}", flush=True)
    print(
        f"Retrospective coverage windows: {len(retrospective_coverage)}",
        flush=True,
    )

    results = []
    for path in sorted(log_files):
        result = scan_session(
            path,
            keywords,
            date_from,
            date_to,
            retrospective_coverage=retrospective_coverage,
        )
        if result:
            results.append(result)

    # Sort by relevance, downweighting sessions already covered by prior retrospectives.
    results.sort(
        key=lambda r: (r["relevance_score"], r["total_hits"], r["total_chars"]),
        reverse=True,
    )
    results = results[:args.top]

    print(f"\nFound {len(results)} relevant sessions:\n")
    for r in results:
        ts = r["first_timestamp"] or "unknown"
        if "T" in ts:
            ts = ts.split("T")[0]
        print(
            f"  {ts}  {r['size_kb']:>7.1f}KB  "
            f"hits={r['total_hits']:>3d}  msgs={r['message_count']:>3d}  "
            f"sub={r['subagent_count']}  {r['session_id'][:12]}..."
        )
        for kw, count in sorted(
            r["keyword_hits"].items(), key=lambda x: -x[1]
        ):
            print(f"    {kw}: {count}")

    # Write full results as JSON
    out_path = os.path.join(log_dir, "_scan_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nFull results written to: {out_path}")


if __name__ == "__main__":
    main()
