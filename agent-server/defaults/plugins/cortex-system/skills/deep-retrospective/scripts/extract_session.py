#!/usr/bin/env python3
# input: Claude Code session JSONL path plus optional keywords/max-lines CLI args
# output: filtered readable conversation text printed to stdout
# pos: provides single-session extraction for deep-retrospective, converting JSONL logs into readable snippets for analysis
# >>> If I am updated, be sure to update my header comment and the CORTEX.md in the same folder <<<
"""
Extract readable conversation from a Claude Code session log.

Usage:
  python extract_session.py <session_path> [--keywords "video,render"] [--max-lines 500]

Output: Filtered, readable conversation text to stdout.
"""

import os
import json
import argparse
import textwrap


def extract_text(record):
    """Extract readable text from a log record."""
    msg = record.get("message")
    if not msg:
        content = record.get("content", "")
        if content and record.get("type") == "queue-operation":
            return f"[queue:{record.get('operation','')}] {content}"
        return ""

    content = msg.get("content", "")
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for item in content:
            if not isinstance(item, dict):
                continue
            t = item.get("type", "")
            if t == "text":
                parts.append(item.get("text", ""))
            elif t == "tool_use":
                name = item.get("name", "unknown")
                inp = item.get("input", {})
                # Summarize tool calls
                summary_parts = []
                for k, v in inp.items():
                    if isinstance(v, str):
                        if len(v) > 200:
                            v = v[:200] + "..."
                        summary_parts.append(f"{k}={v}")
                parts.append(
                    f"[tool:{name}] {'; '.join(summary_parts)}"
                )
            elif t == "tool_result":
                sub = item.get("content", "")
                if isinstance(sub, str) and len(sub) > 0:
                    if len(sub) > 500:
                        sub = sub[:500] + "..."
                    parts.append(f"[result] {sub}")
                elif isinstance(sub, list):
                    for s in sub:
                        if isinstance(s, dict) and s.get("text"):
                            text = s["text"]
                            if len(text) > 500:
                                text = text[:500] + "..."
                            parts.append(f"[result] {text}")
        return "\n".join(parts)
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="Extract readable conversation from a session log"
    )
    parser.add_argument("session_path", help="Path to .jsonl file")
    parser.add_argument(
        "--keywords",
        help="Only show messages containing these keywords (comma-separated)"
    )
    parser.add_argument(
        "--max-lines", type=int, default=0,
        help="Max output lines (0=unlimited)"
    )
    parser.add_argument(
        "--context", type=int, default=2,
        help="Messages of context around keyword matches"
    )
    args = parser.parse_args()

    keywords = None
    if args.keywords:
        keywords = [
            k.strip().lower() for k in args.keywords.split(",")
            if k.strip()
        ]

    # Parse all messages
    messages = []
    with open(args.session_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg_type = record.get("type", "")
            if msg_type not in ("user", "assistant"):
                continue

            text = extract_text(record)
            if not text or len(text.strip()) < 5:
                continue

            ts = record.get("timestamp", "")
            if "T" in ts:
                ts = ts.split("T")[1][:8]

            messages.append({
                "type": msg_type,
                "time": ts,
                "text": text,
            })

    # Filter by keywords if specified
    if keywords:
        matched_indices = set()
        for i, msg in enumerate(messages):
            text_lower = msg["text"].lower()
            if any(kw in text_lower for kw in keywords):
                # Add context window
                for j in range(
                    max(0, i - args.context),
                    min(len(messages), i + args.context + 1)
                ):
                    matched_indices.add(j)
        messages = [
            messages[i] for i in sorted(matched_indices)
        ]

    # Output
    line_count = 0
    for msg in messages:
        role = "USER" if msg["type"] == "user" else "ASST"
        header = f"--- [{msg['time']}] {role} ---"
        print(header)
        line_count += 1

        text = msg["text"]
        if args.max_lines and line_count + text.count("\n") > args.max_lines:
            remaining = args.max_lines - line_count
            lines = text.split("\n")[:remaining]
            print("\n".join(lines))
            print(f"\n... (truncated, {len(messages)} messages total)")
            break

        print(text)
        line_count += text.count("\n") + 1
        print()

    print(f"\n=== {len(messages)} messages extracted ===")


if __name__ == "__main__":
    main()
