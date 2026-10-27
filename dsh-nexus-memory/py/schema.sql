CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    session_id TEXT,
    topic TEXT,
    type TEXT NOT NULL CHECK(type IN ('fact','decision','preference','rule','todo')),
    content TEXT NOT NULL,
    summary TEXT,
    importance REAL NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','stable','deprecated')),
    confidence REAL NOT NULL DEFAULT 0.5,
    source_kind TEXT,
    source_level TEXT,
    source_type TEXT,
    source_ref TEXT,
    tags TEXT,
    embedding BLOB,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(topic);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
CREATE INDEX IF NOT EXISTS idx_memories_source_level ON memories(source_level);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    summary,
    tags,
    content=memories,
    content_rowid=rowid
);

CREATE TABLE IF NOT EXISTS feedback_log (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('accepted','ignored','corrected','deleted')),
    task_context TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES memories(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_memory_id ON feedback_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_feedback_action ON feedback_log(action);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, summary, tags)
    VALUES (new.rowid, new.content, COALESCE(new.summary, ''), COALESCE(new.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
    VALUES ('delete', old.rowid, old.content, COALESCE(old.summary, ''), COALESCE(old.tags, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, summary, tags)
    VALUES ('delete', old.rowid, old.content, COALESCE(old.summary, ''), COALESCE(old.tags, ''));
    INSERT INTO memories_fts(rowid, content, summary, tags)
    VALUES (new.rowid, new.content, COALESCE(new.summary, ''), COALESCE(new.tags, ''));
END;
