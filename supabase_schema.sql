-- CineLearn — Supabase スキーマ
-- Supabase ダッシュボード > SQL Editor で実行してください
-- https://app.supabase.com

-- ── profiles ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT        PRIMARY KEY,          -- cl_profiles の id ('p_xxxx')
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT        NOT NULL,
  color       TEXT        NOT NULL,
  settings    JSONB       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profiles" ON profiles FOR ALL USING (auth.uid() = user_id);

-- ── history ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS history (
  id           TEXT        PRIMARY KEY,          -- cl_history の id
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  drama        JSONB       NOT NULL,
  season       INTEGER     NOT NULL,
  episode      INTEGER     NOT NULL,
  level        TEXT,
  target_level TEXT,
  words        JSONB       NOT NULL DEFAULT '[]',
  quiz         JSONB       NOT NULL DEFAULT '[]',
  quiz_score   INTEGER,
  quiz_date    TEXT,
  date         TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own history" ON history FOR ALL USING (auth.uid() = user_id);

-- ── srs_data ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS srs_data (
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  word         TEXT        NOT NULL,
  interval     INTEGER     NOT NULL DEFAULT 1,
  repetitions  INTEGER     NOT NULL DEFAULT 0,
  ease_factor  DECIMAL(4,2) NOT NULL DEFAULT 2.5,
  due_date     TEXT,
  last_review  TEXT,
  skipped      BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, word)
);
ALTER TABLE srs_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own srs" ON srs_data FOR ALL USING (auth.uid() = user_id);

-- ── my_words ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS my_words (
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  word         TEXT        NOT NULL,
  sentence     TEXT,
  phonetic     TEXT,
  pos          TEXT,
  definition   TEXT,
  saved_at     TEXT,
  source       TEXT,
  drama_title  TEXT,
  season       INTEGER,
  episode      INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, word)
);
ALTER TABLE my_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own words" ON my_words FOR ALL USING (auth.uid() = user_id);
