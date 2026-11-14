-- ============================================================================
-- AUTO POST WORDPRESS AI — CANONICAL POSTGRESQL SCHEMA
-- PostgreSQL 16+ / 18+ Relational Persistence Engine
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS TABLE (RBAC: 'admin' | 'client')
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  locale VARCHAR(10) NOT NULL DEFAULT 'pt-BR' CHECK (locale IN ('pt-BR', 'es', 'en')),
  department VARCHAR(120) NOT NULL DEFAULT 'General',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- 2. PASSWORD RESETS TABLE (SHA-256 Token Digest Only)
CREATE TABLE IF NOT EXISTS password_resets (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets (token_hash);

-- 3. AUDIT LOGS TABLE (Immutable System Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id VARCHAR(64),
  actor_email VARCHAR(255) NOT NULL,
  actor_role VARCHAR(32) NOT NULL,
  action VARCHAR(120) NOT NULL,
  category VARCHAR(32) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('success', 'warning', 'error')),
  ip_address VARCHAR(64) NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs (category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_email ON audit_logs (actor_email);

-- 4. DAILY TELEMETRY METRICS TABLE (Dashboard Time-Series)
CREATE TABLE IF NOT EXISTS metrics_daily (
  metric_date DATE PRIMARY KEY,
  label VARCHAR(20),
  users_count INTEGER NOT NULL DEFAULT 0,
  logins_count INTEGER NOT NULL DEFAULT 0,
  actions_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. WORDPRESS SITES TABLE
CREATE TABLE IF NOT EXISTS wordpress_sites (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  site_name VARCHAR(255) NOT NULL,
  site_url TEXT NOT NULL,
  api_key VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  last_sync_at TIMESTAMPTZ,
  auto_publish BOOLEAN NOT NULL DEFAULT false,
  default_status VARCHAR(32) NOT NULL DEFAULT 'publish',
  default_category VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_sites_user_id ON wordpress_sites (user_id);
CREATE INDEX IF NOT EXISTS idx_wp_sites_api_key ON wordpress_sites (api_key);

-- 6. WORDPRESS SYNC LOGS TABLE
CREATE TABLE IF NOT EXISTS wordpress_logs (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  site_name VARCHAR(255),
  action VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL,
  message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_logs_site_id ON wordpress_logs (site_id);
CREATE INDEX IF NOT EXISTS idx_wp_logs_timestamp ON wordpress_logs (timestamp DESC);

-- 7. NEWS SOURCES TABLE (Scraper Feeds)
CREATE TABLE IF NOT EXISTS news_sources (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'rss',
  category VARCHAR(120) NOT NULL,
  target_site_id VARCHAR(64),
  active BOOLEAN NOT NULL DEFAULT true,
  auto_rewrite BOOLEAN NOT NULL DEFAULT false,
  auto_publish BOOLEAN NOT NULL DEFAULT false,
  last_scraped_at TIMESTAMPTZ,
  articles_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_sources_user_id ON news_sources (user_id);

-- 8. CAPTURED ARTICLES TABLE
CREATE TABLE IF NOT EXISTS captured_articles (
  id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(64) NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  original_url TEXT NOT NULL UNIQUE,
  original_title TEXT NOT NULL,
  original_content TEXT NOT NULL,
  original_excerpt TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ai_title TEXT,
  ai_content TEXT,
  ai_excerpt TEXT,
  ai_seo_keywords JSONB DEFAULT '[]'::jsonb,
  wp_post_id INTEGER,
  wp_site_id VARCHAR(64),
  wp_permalink TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subtitle TEXT,
  author VARCHAR(255),
  clean_html TEXT,
  clean_text TEXT,
  r2_json_url TEXT,
  media_data JSONB DEFAULT '{}'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_captured_articles_source_id ON captured_articles (source_id);
CREATE INDEX IF NOT EXISTS idx_captured_articles_status ON captured_articles (status);
CREATE INDEX IF NOT EXISTS idx_captured_articles_created_at ON captured_articles (created_at DESC);

-- 9. SOURCES & CAPTURED ITEMS (Daemon Painel AGY & VPS Compatibility)
CREATE TABLE IF NOT EXISTS sources (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  category VARCHAR(128) DEFAULT 'Geral',
  interval_seconds INTEGER DEFAULT 300,
  last_checked_at TIMESTAMPTZ,
  last_status VARCHAR(32) DEFAULT 'pending',
  last_error TEXT,
  etag TEXT,
  last_modified TEXT,
  auto_publish INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active);

CREATE TABLE IF NOT EXISTS captured_items (
  id VARCHAR(128) PRIMARY KEY,
  source_id VARCHAR(64) NOT NULL,
  source_name TEXT,
  category TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  url TEXT NOT NULL,
  summary TEXT,
  clean_content_html TEXT,
  clean_content_text TEXT,
  published_at TEXT,
  published_at_raw TEXT,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(32) DEFAULT 'new',
  r2_json_url TEXT,
  featured_image_url TEXT,
  media_data JSONB,
  budget TEXT,
  metadata_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_items_captured_at ON captured_items(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_status ON captured_items(status);
CREATE INDEX IF NOT EXISTS idx_items_source_id ON captured_items(source_id);

-- 10. SYSTEM SETTINGS TABLE (Branding, White-Label & AI Engine)
CREATE TABLE IF NOT EXISTS system_settings (
  id VARCHAR(64) PRIMARY KEY DEFAULT 'global_config',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

