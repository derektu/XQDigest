CREATE TABLE IF NOT EXISTS content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  item_id TEXT UNIQUE NOT NULL,
  title TEXT,
  url TEXT,
  author TEXT,
  published_date DATETIME,
  fetched_date DATETIME NOT NULL,
  markdown_file_path TEXT NOT NULL,
  summary TEXT,
  tags TEXT,
  status TEXT DEFAULT 'new',
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  check_interval INTEGER DEFAULT 3600,
  max_items INTEGER DEFAULT 10,
  lookback_days INTEGER DEFAULT 7,
  prompt TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  last_check DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  api_key TEXT,
  base_url TEXT,
  model TEXT NOT NULL,
  system_prompt TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_items_source_id ON content_items(source_id);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_items_published_date ON content_items(published_date);
CREATE INDEX IF NOT EXISTS idx_content_items_source_type ON content_items(source_type);

CREATE TABLE IF NOT EXISTS failed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  item_id TEXT UNIQUE NOT NULL,
  title TEXT,
  url TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_failed_items_item_id ON failed_items(item_id);
