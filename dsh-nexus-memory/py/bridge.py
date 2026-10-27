#!/usr/bin/env python3
"""Read-only Nexus memory bridge for the dsh-nexus-memory plugin.

One JSON object in on stdin, one JSON object out on stdout, always exit 0 so the
Node half receives structured errors instead of guessing from a signal.

Database locations are supplied by the Host on every call (``dbPath``); nothing
here hardcodes a machine-specific path. The bridge deliberately does not open
``nexus.MemoryStore``: that constructor runs the schema script, sets WAL, and
``retriever.retrieve()`` bumps ``access_count`` on every hit, which would mutate
a production memory database on every automatic injection. Queries here go
through a ``mode=ro`` SQLite handle and a keyword scoring fold that mirrors the
skill's formula at 30% weight (the mock embedder only contributes noise, so the
vector term is 0).

Commands: probe, create, stats, search, inject, feedback, remember.
"""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

# Mirrors nexus.retriever.RetrieverConfig with the vector weight folded away,
# plus a feedback term folded in from feedback_log (nexus ranks with it too).
KEYWORD_WEIGHT = 0.3
IMPORTANCE_WEIGHT = 0.2
RECENCY_WEIGHT = 0.1
FEEDBACK_WEIGHT = 0.15
RECENCY_DECAY = 0.05
MAX_FTS_ROWS = 40
DEDUP_LIMIT = 25
DEDUP_JACCARD = 0.9

ACTION_ALIASES = {
    "accepted": "accepted",
    "useful": "accepted",
    "ignored": "ignored",
    "not-useful": "ignored",
    "corrected": "corrected",
    "deleted": "deleted",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path(payload: dict) -> str:
    """Resolve the database path from the payload, falling back to env overrides."""
    given = str(payload.get("dbPath") or "").strip()
    if given:
        return given
    name = str(payload.get("db") or "primary").strip().lower()
    env = os.environ.get("NEXUS_CODE_DB" if name == "code" else "NEXUS_PRIMARY_DB")
    if env and env.strip():
        return env.strip()
    raise ValueError("未配置记忆数据库路径")


def _open_ro(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _tables(conn: sqlite3.Connection) -> set:
    return {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }


def _keywords(query: str) -> list:
    """Same sanitizing as MemoryStore.search_by_keywords."""
    cleaned = []
    for raw in (query or "").split():
        token = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", raw)
        if token:
            cleaned.append(token)
    return cleaned


def _recency(record: sqlite3.Row) -> float:
    stamp = record["last_accessed_at"] or record["created_at"] or ""
    if not stamp:
        return 0.0
    try:
        parsed = datetime.fromisoformat(stamp)
    except (TypeError, ValueError):
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    days = (datetime.now(timezone.utc) - parsed).total_seconds() / 86400.0
    return math.exp(-RECENCY_DECAY * max(days, 0.0))


def _text(value: object) -> str:
    """SQLite text may carry undecodable bytes as lone surrogates; make it valid UTF-8."""
    raw = "" if value is None else str(value)
    return raw.encode("utf-8", "replace").decode("utf-8")


def _shape(record: sqlite3.Row, keyword_score: float) -> dict:
    score = (
        KEYWORD_WEIGHT * keyword_score
        + IMPORTANCE_WEIGHT * float(record["importance"] or 0.0)
        + RECENCY_WEIGHT * _recency(record)
    )
    return {
        "id": _text(record["id"]),
        "type": _text(record["type"]),
        "score": round(score, 6),
        "content": _text(record["content"]),
        "summary": _text(record["summary"]),
        "status": _text(record["status"]),
        "importance": round(float(record["importance"] or 0.0), 4),
        "project": _text(record["project"]),
    }


_FEEDBACK_SIGN = {"accepted": 1.0, "ignored": -1.0, "corrected": -1.0, "deleted": -1.0}


def _feedback_map(conn: sqlite3.Connection, ids: list) -> dict:
    """Average signed feedback per memory id, smoothed into [-1, 1]."""
    if not ids:
        return {}
    try:
        if "feedback_log" not in _tables(conn):
            return {}
        placeholders = ",".join(["?"] * len(ids))
        rows = conn.execute(
            f"SELECT memory_id, action FROM feedback_log WHERE memory_id IN ({placeholders})",
            ids,
        ).fetchall()
    except sqlite3.Error:
        return {}
    sums: dict = {}
    counts: dict = {}
    for row in rows:
        memory_id = row["memory_id"]
        sign = _FEEDBACK_SIGN.get(str(row["action"] or "").strip().lower())
        if sign is None:
            continue
        sums[memory_id] = sums.get(memory_id, 0.0) + sign
        counts[memory_id] = counts.get(memory_id, 0) + 1
    return {
        memory_id: max(-1.0, min(1.0, sums[memory_id] / counts[memory_id]))
        for memory_id in sums
    }


def _apply_feedback(conn: sqlite3.Connection, results: list) -> None:
    """Fold stored feedback into an already scored result list."""
    values = _feedback_map(conn, [item["id"] for item in results])
    for item in results:
        value = values.get(item["id"], 0.0)
        if value:
            item["score"] = round(item["score"] + FEEDBACK_WEIGHT * value, 6)
            item["feedback"] = round(value, 4)


_MARKDOWN_NOISE = re.compile(r"[#*_>`~\[\]()【】「」《》\"'“”‘’。，、；：！？…—\-]+")


def _normalize_text(text: object) -> str:
    value = _MARKDOWN_NOISE.sub(" ", str(text or "").lower())
    value = re.sub(r"\s+", " ", value).strip()
    return value.strip(" .,;:!?，。；：！？-")


def _bigrams(text: str) -> set:
    compact = re.sub(r"\s+", "", text)
    if len(compact) < 2:
        return {compact} if compact else set()
    return {compact[index : index + 2] for index in range(len(compact) - 1)}


def _jaccard(left: set, right: set) -> float:
    if not left or not right:
        return 0.0
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def _dedup_candidates(conn: sqlite3.Connection, project: str, tokens: list) -> list:
    """Existing rows worth comparing against, limited to the same project."""
    if not tokens:
        return []
    try:
        rows = conn.execute(
            "SELECT m.id, m.content, m.summary, m.type FROM memories_fts f "
            "JOIN memories m ON m.id = (SELECT id FROM memories WHERE rowid = f.rowid) "
            "WHERE memories_fts MATCH ? AND m.status IN ('stable','candidate') "
            + ("AND m.project = ? " if project else "")
            + "LIMIT ?",
            [(" OR ".join(tokens)), *([project] if project else []), DEDUP_LIMIT],
        ).fetchall()
        if rows:
            return list(rows)
    except sqlite3.Error:
        pass
    needles = [token for token in tokens if len(token) >= 2][:5]
    if not needles:
        return []
    params: list = []
    clauses = []
    for needle in needles:
        clauses.append("content LIKE ? OR summary LIKE ?")
        params.extend([f"%{needle}%", f"%{needle}%"])
    if project:
        params.append(project)
    params.append(DEDUP_LIMIT)
    try:
        return list(
            conn.execute(
                "SELECT id, content, summary, type FROM memories "
                "WHERE status IN ('stable','candidate') AND (" + " OR ".join(clauses) + ")"
                + (" AND project = ?" if project else "")
                + " LIMIT ?",
                params,
            ).fetchall()
        )
    except sqlite3.Error:
        return []


def _duplicate_of(
    conn: sqlite3.Connection,
    project: str,
    content: str,
    summary: str,
    memory_type: str,
    pending: list,
) -> dict:
    """Return the first existing or same-batch memory this candidate duplicates."""
    normalized = _normalize_text(content)
    if not normalized:
        return {}
    bigrams = _bigrams(normalized)
    normalized_summary = _normalize_text(summary)
    compared = list(pending)
    pending_ids = {item["id"] for item in pending}
    for row in _dedup_candidates(conn, project, _keywords(normalized)[:8]):
        row_id = _text(row["id"])
        if row_id in pending_ids:
            continue
        row_normalized = _normalize_text(row["content"])
        compared.append(
            {
                "id": row_id,
                "normalized": row_normalized,
                "bigrams": _bigrams(row_normalized),
                "summary": _normalize_text(row["summary"]),
                "type": str(row["type"] or ""),
            }
        )
    for candidate in compared:
        if candidate["normalized"] == normalized:
            return {"existingId": candidate["id"], "similarity": 1.0}
        similarity = _jaccard(bigrams, candidate["bigrams"])
        if similarity >= DEDUP_JACCARD:
            return {"existingId": candidate["id"], "similarity": round(similarity, 4)}
        if normalized_summary and normalized_summary == candidate["summary"] and candidate["type"] == memory_type:
            return {"existingId": candidate["id"], "similarity": 1.0}
    return {}


def _fts_search(
    conn: sqlite3.Connection, project: str, tokens: list, limit: int
) -> list:
    if not tokens:
        return []
    match = " OR ".join(tokens)
    sql = (
        "SELECT m.*, rank FROM memories_fts f "
        "JOIN memories m ON m.id = (SELECT id FROM memories WHERE rowid = f.rowid) "
        "WHERE memories_fts MATCH ? AND m.status IN ('stable','candidate')"
    )
    params = [match]
    if project:
        sql += " AND m.project = ?"
        params.append(project)
    sql += " ORDER BY rank LIMIT ?"
    params.append(MAX_FTS_ROWS)
    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.Error:
        return []
    if not rows:
        return []
    scores = [abs(float(row["rank"] or 0.0)) for row in rows]
    peak = max(scores) or 1.0
    return [_shape(row, min(score / peak, 1.0)) for row, score in zip(rows, scores)]


def _like_search(
    conn: sqlite3.Connection, project: str, tokens: list, limit: int
) -> list:
    """Fallback for phrases the unicode61 tokenizer cannot split (CJK runs)."""
    needles = [token for token in tokens if len(token) >= 2][:5]
    if not needles:
        return []
    clauses = " OR ".join("content LIKE ? OR summary LIKE ?" for _ in needles)
    params = []
    for needle in needles:
        params.extend([f"%{needle}%", f"%{needle}%"])
    sql = (
        "SELECT * FROM memories WHERE status IN ('stable','candidate') "
        f"AND ({clauses})"
    )
    if project:
        sql += " AND project = ?"
        params.append(project)
    sql += " ORDER BY importance DESC, updated_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    return [_shape(row, 0.5) for row in rows]


def search(conn: sqlite3.Connection, project: str, query: str, top_k: int) -> list:
    limit = max(1, min(int(top_k or 5), 20))
    tokens = _keywords(query)
    results = _fts_search(conn, project, tokens, max(limit, 10))
    if not results:
        results = _like_search(conn, project, tokens, max(limit, 10))
    _apply_feedback(conn, results)
    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:limit]


def cmd_probe(payload: dict) -> dict:
    path = str(payload.get("path") or "").strip()
    if not path:
        return {"ok": False, "error": "path 不能为空"}
    result = {"ok": True, "path": path, "exists": os.path.exists(path), "valid": False}
    if not result["exists"]:
        return result
    try:
        conn = _open_ro(path)
        try:
            if "memories" not in _tables(conn):
                result["error"] = "不是 Nexus 记忆库（缺少 memories 表）"
                return result
            total = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            result["valid"] = True
            result["total"] = int(total)
        finally:
            conn.close()
    except Exception as error:  # noqa: BLE001 - structured error on the wire
        result["error"] = f"{type(error).__name__}: {error}"
    return result


def cmd_create(payload: dict) -> dict:
    db_path = str(payload.get("dbPath") or "").strip()
    schema_path = str(payload.get("schemaPath") or "").strip()
    if not db_path or not schema_path:
        return {"ok": False, "error": "dbPath 与 schemaPath 不能为空"}
    if os.path.exists(db_path):
        return {"ok": False, "error": "已存在", "path": db_path}
    try:
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(schema_path, "r", encoding="utf-8") as handle:
            script = handle.read()
        conn = sqlite3.connect(db_path)
        try:
            conn.executescript(script)
            conn.commit()
        finally:
            conn.close()
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"{type(error).__name__}: {error}", "path": db_path}
    return {"ok": True, "path": db_path, "total": 0}


def cmd_search(payload: dict) -> dict:
    path = _db_path(payload)
    project = (payload.get("project") or "").strip()
    query = (payload.get("query") or "").strip()
    if not query:
        return {"ok": False, "error": "query 不能为空"}
    with _open_ro(path) as conn:
        return {"ok": True, "results": search(conn, project, query, payload.get("topK", 5))}


def cmd_stats(payload: dict) -> dict:
    path = _db_path(payload)
    with _open_ro(path) as conn:
        total = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        by_type = {
            row["type"]: row["n"]
            for row in conn.execute(
                "SELECT type, COUNT(*) AS n FROM memories GROUP BY type ORDER BY n DESC"
            )
        }
        by_status = {
            row["status"]: row["n"]
            for row in conn.execute(
                "SELECT status, COUNT(*) AS n FROM memories GROUP BY status ORDER BY n DESC"
            )
        }
        projects = [
            {"name": row["project"], "count": row["n"]}
            for row in conn.execute(
                "SELECT project, COUNT(*) AS n FROM memories GROUP BY project ORDER BY n DESC LIMIT 10"
            )
        ]
    return {
        "ok": True,
        "db": payload.get("db", "primary"),
        "total": int(total),
        "byType": by_type,
        "byStatus": by_status,
        "projects": projects,
    }


_JUNK = re.compile(r"^(?:Source:|\[(?:codex|claude|mimo)\])|Messages:\s*\d+")


def cmd_inject(payload: dict) -> dict:
    path = _db_path(payload)
    project = (payload.get("project") or "").strip()
    query = (payload.get("query") or "").strip()
    if not query:
        return {"ok": True, "text": "", "count": 0}
    budget = max(120, int(payload.get("maxTokens", 500))) * 4
    top_k = max(1, min(int(payload.get("topK", 5)), 4))
    with _open_ro(path) as conn:
        results = search(conn, project, query, top_k)
        if not results and project and payload.get("fallbackGlobal"):
            results = search(conn, "", query, top_k)
    lines = []
    used = 0
    for item in results:
        if float(item.get("score") or 0.0) < 0.30:
            continue
        summary = (item["summary"] or "").strip()
        content = summary if len(summary) >= 12 else (item["content"] or "").strip()
        content = re.sub(r"\s+", " ", content)
        # Keep automatic injection to reusable facts: drop conversation dumps
        # and fragments too short to carry meaning.
        if len(content) < 40 or _JUNK.search(content):
            continue
        if len(content) > 400:
            content = content[:400] + "…"
        line = f"[memory] {item['type']}: {content}"
        if used + len(line) > budget:
            break
        lines.append(line)
        used += len(line) + 1
    return {"ok": True, "text": "\n".join(lines), "count": len(lines)}


def cmd_feedback(payload: dict) -> dict:
    path = _db_path(payload)
    memory_id = (payload.get("id") or "").strip()
    action = ACTION_ALIASES.get((payload.get("action") or "").strip())
    if not memory_id:
        return {"ok": False, "error": "id 不能为空"}
    if action is None:
        return {"ok": False, "error": f"未知的反馈动作：{payload.get('action')!r}"}
    if not os.path.exists(path):
        return {"ok": False, "error": "记忆库尚未初始化"}
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        if "feedback_log" not in _tables(conn):
            return {"ok": False, "error": "该库没有 feedback_log 表，暂不支持反馈"}
        row = conn.execute(
            "SELECT id, importance, access_count FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        if row is None:
            return {"ok": False, "error": "记忆不存在（未写入任何内容）"}
        conn.execute(
            "INSERT INTO feedback_log (id, memory_id, action, task_context, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (f"fb_{uuid.uuid4().hex[:20]}", memory_id, action, "dsh-nexus-memory", _now_iso()),
        )
        if action == "accepted":
            conn.execute(
                "UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?,"
                " updated_at = ? WHERE id = ?",
                (_now_iso(), _now_iso(), memory_id),
            )
        elif action == "ignored":
            importance = max(float(row["importance"] or 0.0) - 0.1, 0.0)
            conn.execute(
                "UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?",
                (importance, _now_iso(), memory_id),
            )
        elif action == "deleted":
            conn.execute(
                "UPDATE memories SET status = 'deprecated', updated_at = ? WHERE id = ?",
                (_now_iso(), memory_id),
            )
        conn.commit()
        return {"ok": True, "id": memory_id, "action": action}
    finally:
        conn.close()


def cmd_remember(payload: dict) -> dict:
    """Insert extracted memory candidates into a compatible Nexus database."""
    path = _db_path(payload)
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        return {"ok": False, "error": "items 不能为空"}
    if not os.path.exists(path):
        return {"ok": False, "error": "记忆库尚未初始化"}
    project = (payload.get("project") or "").strip() or "conversations"
    session_id = (payload.get("sessionId") or "").strip()
    allowed = {"fact", "decision", "preference", "rule", "todo"}
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        if "memories" not in _tables(conn):
            return {"ok": False, "error": "不是 Nexus 记忆库（缺少 memories 表）"}
        columns = {row[1] for row in conn.execute("PRAGMA table_info(memories)")}
        inserted: list = []
        skipped: list = []
        pending: list = []
        now = _now_iso()
        for raw in items:
            if not isinstance(raw, dict):
                skipped.append({"reason": "条目不是对象"})
                continue
            content = str(raw.get("content") or "").strip()
            if not content:
                skipped.append({"reason": "content 为空"})
                continue
            memory_type = str(raw.get("type") or "fact").strip().lower()
            if memory_type not in allowed:
                memory_type = "fact"
            try:
                importance = float(raw.get("importance"))
            except (TypeError, ValueError):
                importance = 0.5
            importance = max(0.0, min(1.0, importance))
            summary = str(raw.get("summary") or "").strip() or content[:120]
            topic = str(raw.get("topic") or "").strip() or content[:24]
            tags = raw.get("tags")
            if isinstance(tags, (list, dict)):
                tags_text = json.dumps(tags, ensure_ascii=False)
            elif tags:
                tags_text = str(tags)
            else:
                tags_text = "[]"
            memory_id = "mem_" + uuid.uuid4().hex[:32]
            duplicate = _duplicate_of(conn, project, content, summary, memory_type, pending)
            if duplicate:
                skipped.append(
                    {
                        "reason": "已有相似记忆",
                        "existingId": duplicate.get("existingId", ""),
                        "similarity": duplicate.get("similarity", 1.0),
                        "content": content[:60],
                    }
                )
                continue
            values = {
                "id": memory_id,
                "project": project,
                "session_id": session_id,
                "topic": topic,
                "type": memory_type,
                "content": content[:4000],
                "summary": summary[:400],
                "importance": importance,
                "status": "stable",
                "confidence": 0.7,
                "source_kind": "extract",
                "source_level": "session",
                "source_type": "conversation",
                "source_ref": session_id,
                "tags": tags_text,
                "created_at": now,
                "updated_at": now,
                "access_count": 0,
                "last_accessed_at": None,
            }
            usable = {key: value for key, value in values.items() if key in columns}
            missing_required = [
                row[1]
                for row in conn.execute("PRAGMA table_info(memories)")
                if row[3] == 1 and row[4] is None and row[1] not in usable
            ]
            if missing_required:
                return {
                    "ok": False,
                    "error": "记忆库缺少必要列：" + ", ".join(missing_required),
                }
            placeholders = ", ".join(["?"] * len(usable))
            statement = f"INSERT INTO memories ({', '.join(usable)}) VALUES ({placeholders})"
            try:
                conn.execute(statement, tuple(usable.values()))
            except Exception as error:  # noqa: BLE001 - per-row reporting
                skipped.append({"reason": f"{type(error).__name__}: {error}", "content": content[:60]})
                continue
            inserted.append({"id": memory_id, "content": content[:80]})
            normalized_content = _normalize_text(content)
            pending.append(
                {
                    "id": memory_id,
                    "normalized": normalized_content,
                    "bigrams": _bigrams(normalized_content),
                    "summary": _normalize_text(summary),
                    "type": memory_type,
                }
            )
        conn.commit()
        return {"ok": True, "inserted": inserted, "skipped": skipped, "project": project}
    finally:
        conn.close()


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as error:
        print(json.dumps({"ok": False, "error": f"无效 JSON：{error}"}, ensure_ascii=False))
        return
    command = payload.get("cmd")
    handlers = {
        "probe": cmd_probe,
        "create": cmd_create,
        "search": cmd_search,
        "stats": cmd_stats,
        "inject": cmd_inject,
        "feedback": cmd_feedback,
        "remember": cmd_remember,
    }
    handler = handlers.get(command)
    if handler is None:
        print(json.dumps({"ok": False, "error": f"未知命令：{command!r}"}, ensure_ascii=False))
        return
    try:
        result = handler(payload)
    except FileNotFoundError as error:
        result = {"ok": False, "error": "记忆库尚未初始化", "missing": True, "detail": str(error)}
    except Exception as error:  # noqa: BLE001 - the wire contract carries the message
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
    text = json.dumps(result, ensure_ascii=False)
    sys.stdout.write(text.encode("utf-8", "replace").decode("utf-8"))


if __name__ == "__main__":
    main()
