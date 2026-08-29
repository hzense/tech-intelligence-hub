CREATE TYPE radar_domain AS ENUM ('artificial_intelligence', 'infrastructure', 'security', 'robotics');

-- Expand first so databases that already contain the 0000 schema can be
-- backfilled before the new contract becomes mandatory.
ALTER TABLE sources ADD COLUMN allowed_hosts text[];
ALTER TABLE signals ADD COLUMN source_url text;
ALTER TABLE radar_snapshots ADD COLUMN domain radar_domain;
ALTER TABLE radar_snapshots ADD COLUMN reasoning text;

-- ALTER TABLE already holds write-blocking locks on the three changed tables;
-- lock the Topic join as well so evidence eligibility cannot change mid-audit.
LOCK TABLE signal_topics IN SHARE ROW EXCLUSIVE MODE;

UPDATE sources AS source
SET allowed_hosts = backfill.allowed_hosts
FROM (
  VALUES
    ('source-arxiv', ARRAY['arxiv.org']::text[]),
    ('source-openai', ARRAY['openai.com']::text[]),
    ('source-anthropic', ARRAY['anthropic.com']::text[]),
    ('source-meta', ARRAY['meta.com']::text[]),
    ('source-google', ARRAY['google.com', 'blog.google']::text[]),
    ('source-nvidia', ARRAY['nvidia.com']::text[]),
    ('source-apple', ARRAY['apple.com']::text[]),
    ('source-figure', ARRAY['figure.ai', 'prnewswire.com']::text[]),
    ('source-boston-dynamics', ARRAY['bostondynamics.com']::text[])
) AS backfill(id, allowed_hosts)
WHERE source.id = backfill.id;

UPDATE signals AS signal
SET source_url = backfill.source_url
FROM (
  VALUES
    ('signal-20170612-transformer', 'https://arxiv.org/abs/1706.03762'),
    ('signal-20221130-chatgpt', 'https://openai.com/index/chatgpt/'),
    ('signal-20230314-gpt4', 'https://openai.com/index/gpt-4-research/'),
    ('signal-20240418-llama3', 'https://ai.meta.com/blog/meta-llama-3/'),
    ('signal-20240513-gpt4o', 'https://openai.com/index/hello-gpt-4o/'),
    ('signal-20240318-blackwell', 'https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing'),
    ('signal-20240610-apple-intelligence', 'https://www.apple.com/newsroom/2024/06/introducing-apple-intelligence-for-iphone-ipad-and-mac/'),
    ('signal-20240620-claude35', 'https://www.anthropic.com/news/claude-3-5-sonnet'),
    ('signal-20240229-figure-openai', 'https://www.prnewswire.com/news-releases/figure-raises-675m-at-2-6b-valuation-and-signs-collaboration-agreement-with-openai-302074897.html'),
    ('signal-20240417-electric-atlas', 'https://bostondynamics.com/blog/electric-new-era-for-atlas/'),
    ('signal-20241125-mcp', 'https://www.anthropic.com/news/model-context-protocol')
) AS backfill(id, source_url)
WHERE signal.id = backfill.id;

-- The stable Signal ID predates the source-date correction and intentionally
-- remains unchanged after publication.
UPDATE signals
SET occurred_at = '2024-06-21T00:00:00Z'
WHERE id = 'signal-20240620-claude35';

UPDATE radar_snapshots AS snapshot
SET
  domain = backfill.domain::radar_domain,
  attention = backfill.attention,
  trend = backfill.trend_value::trend,
  maturity = backfill.maturity_value::maturity,
  strategic_value = backfill.strategic_value_value::strategic_value,
  confidence = backfill.confidence::double precision,
  reasoning = backfill.reasoning
FROM (
  VALUES
    (
      'radar-20260827-foundation-models',
      'artificial_intelligence',
      95,
      'growth',
      'growth',
      'critical',
      0.82,
      '示例评分依据 Transformer、ChatGPT 与多条 2023–2024 官方模型发布信号，反映基础模型能力和生态持续演进。证据未覆盖 2025–2026 新进展，因此置信度按历史样例下调。'
    ),
    (
      'radar-20260827-ai-infrastructure',
      'infrastructure',
      94,
      'growth',
      'growth',
      'critical',
      0.55,
      'Blackwell 平台发布直接体现 AI 计算基础设施继续升级。当前 Seed 只有一条 2024 年官方产品信号，能支持方向判断但不足以代表完整市场，因此置信度较低。'
    ),
    (
      'radar-20260827-ai-agents',
      'artificial_intelligence',
      92,
      'rapid_growth',
      'emerging',
      'critical',
      0.72,
      '系统级智能、计算机交互、具身合作与 MCP 工具协议共同表明 Agent 正从对话走向执行。证据覆盖多个一手来源，但仍停留在 2024 年样例，因此置信度保持中等。'
    ),
    (
      'radar-20260827-ai-security',
      'security',
      55,
      'growth',
      'emerging',
      'medium',
      0.4,
      'MCP 扩大助手对工具和数据源的访问面，使权限与边界治理更值得关注；但这是一条跨专题协议信号，不是直接安全事件或控制证据，因此关注度、趋势与战略价值均收敛为中等判断，并保留低置信度。'
    ),
    (
      'radar-20260827-humanoid-robotics',
      'robotics',
      82,
      'growth',
      'early',
      'high',
      0.62,
      'Figure 与 OpenAI 的合作以及全电 Atlas 发布，分别体现智能能力整合和机器人平台迭代。两条 2024 年一手信号能支撑早期趋势判断，但样本有限且未覆盖后续商业化进展。'
    )
) AS backfill(
  id,
  domain,
  attention,
  trend_value,
  maturity_value,
  strategic_value_value,
  confidence,
  reasoning
)
WHERE snapshot.id = backfill.id;

-- Stop with the unresolved IDs instead of inventing provenance for legacy
-- rows that are not part of the reviewed seed catalog.
DO $$
DECLARE
  unresolved_ids text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO unresolved_ids
  FROM sources
  WHERE allowed_hosts IS NULL OR cardinality(allowed_hosts) = 0;

  IF unresolved_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Radar evidence migration requires an allowed_hosts backfill for every source; unresolved source IDs: %', unresolved_ids;
  END IF;
END $$;

DO $$
DECLARE
  unresolved_ids text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO unresolved_ids
  FROM signals
  WHERE source_url IS NULL OR btrim(source_url) = '' OR source_url !~ '^https://';

  IF unresolved_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Radar evidence migration requires an exact source_url backfill for every signal; unresolved signal IDs: %', unresolved_ids;
  END IF;
END $$;

DO $$
DECLARE
  unresolved_ids text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO unresolved_ids
  FROM radar_snapshots
  WHERE domain IS NULL OR reasoning IS NULL OR btrim(reasoning) = '';

  IF unresolved_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Radar evidence migration requires domain and reasoning backfills for every Radar snapshot; unresolved snapshot IDs: %', unresolved_ids;
  END IF;
END $$;

ALTER TABLE sources ALTER COLUMN allowed_hosts SET NOT NULL;
ALTER TABLE sources
  ADD CONSTRAINT sources_allowed_hosts_ck CHECK (cardinality(allowed_hosts) > 0);

ALTER TABLE signals ALTER COLUMN source_url SET NOT NULL;
ALTER TABLE signals
  ADD CONSTRAINT signals_source_url_https_ck CHECK (source_url ~ '^https://');

ALTER TABLE radar_snapshots ALTER COLUMN domain SET NOT NULL;
ALTER TABLE radar_snapshots ALTER COLUMN reasoning SET NOT NULL;
ALTER TABLE radar_snapshots
  ADD CONSTRAINT radar_reasoning_ck CHECK (length(btrim(reasoning)) > 0);

CREATE TABLE radar_snapshot_signals (
  snapshot_id text NOT NULL REFERENCES radar_snapshots(id) ON DELETE CASCADE,
  signal_id text NOT NULL REFERENCES signals(id),
  position integer NOT NULL,
  PRIMARY KEY (snapshot_id, signal_id),
  CONSTRAINT radar_snapshot_signal_position_ck CHECK (position >= 0)
);

CREATE UNIQUE INDEX radar_snapshot_signal_position_uq
  ON radar_snapshot_signals(snapshot_id, position);
CREATE INDEX radar_snapshot_signals_signal_idx
  ON radar_snapshot_signals(signal_id);

CREATE TEMP TABLE expected_radar_snapshot_signals (
  snapshot_id text NOT NULL,
  signal_id text NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (snapshot_id, signal_id)
) ON COMMIT DROP;

INSERT INTO expected_radar_snapshot_signals (snapshot_id, signal_id, position)
VALUES
    ('radar-20260827-foundation-models', 'signal-20170612-transformer', 0),
    ('radar-20260827-foundation-models', 'signal-20221130-chatgpt', 1),
    ('radar-20260827-foundation-models', 'signal-20230314-gpt4', 2),
    ('radar-20260827-foundation-models', 'signal-20240418-llama3', 3),
    ('radar-20260827-foundation-models', 'signal-20240513-gpt4o', 4),
    ('radar-20260827-foundation-models', 'signal-20240620-claude35', 5),
    ('radar-20260827-ai-infrastructure', 'signal-20240318-blackwell', 0),
    ('radar-20260827-ai-agents', 'signal-20240610-apple-intelligence', 0),
    ('radar-20260827-ai-agents', 'signal-20240620-claude35', 1),
    ('radar-20260827-ai-agents', 'signal-20240229-figure-openai', 2),
    ('radar-20260827-ai-agents', 'signal-20241125-mcp', 3),
    ('radar-20260827-ai-security', 'signal-20241125-mcp', 0),
    ('radar-20260827-humanoid-robotics', 'signal-20240229-figure-openai', 0),
    ('radar-20260827-humanoid-robotics', 'signal-20240417-electric-atlas', 1);

INSERT INTO radar_snapshot_signals (snapshot_id, signal_id, position)
SELECT evidence.snapshot_id, evidence.signal_id, evidence.position
FROM expected_radar_snapshot_signals AS evidence
JOIN radar_snapshots AS snapshot ON snapshot.id = evidence.snapshot_id
JOIN signals AS signal ON signal.id = evidence.signal_id;

DO $$
DECLARE
  missing_evidence text;
BEGIN
  SELECT string_agg(
    expected.snapshot_id || ' -> ' || expected.signal_id,
    ', '
    ORDER BY expected.snapshot_id, expected.position
  )
  INTO missing_evidence
  FROM expected_radar_snapshot_signals AS expected
  JOIN radar_snapshots AS snapshot ON snapshot.id = expected.snapshot_id
  LEFT JOIN radar_snapshot_signals AS persisted
    ON persisted.snapshot_id = expected.snapshot_id
    AND persisted.signal_id = expected.signal_id
    AND persisted.position = expected.position
  WHERE persisted.snapshot_id IS NULL;

  IF missing_evidence IS NOT NULL THEN
    RAISE EXCEPTION 'Radar evidence migration could not persist every expected evidence edge: %', missing_evidence;
  END IF;
END $$;

DO $$
DECLARE
  invalid_snapshot_ids text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO invalid_snapshot_ids
  FROM radar_snapshots AS snapshot
  WHERE NOT EXISTS (
    SELECT 1
    FROM radar_snapshot_signals AS evidence
    WHERE evidence.snapshot_id = snapshot.id
  );

  IF invalid_snapshot_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Radar evidence migration requires at least one persisted evidence signal per snapshot; unresolved snapshot IDs: %', invalid_snapshot_ids;
  END IF;
END $$;

DO $$
DECLARE
  invalid_snapshot_ids text;
BEGIN
  SELECT string_agg(DISTINCT snapshot.id, ', ' ORDER BY snapshot.id)
  INTO invalid_snapshot_ids
  FROM radar_snapshot_signals AS evidence
  JOIN radar_snapshots AS snapshot ON snapshot.id = evidence.snapshot_id
  JOIN signals AS signal ON signal.id = evidence.signal_id
  WHERE signal.status NOT IN ('reviewed', 'accepted')
    OR (signal.occurred_at AT TIME ZONE 'UTC')::date > snapshot.snapshot_date
    OR (signal.captured_at AT TIME ZONE 'UTC')::date > snapshot.snapshot_date
    OR NOT EXISTS (
      SELECT 1
      FROM signal_topics
      WHERE signal_topics.signal_id = signal.id
        AND signal_topics.topic_id = snapshot.topic_id
    );

  IF invalid_snapshot_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Radar evidence migration found ineligible, cross-topic, or future evidence for snapshot IDs: %', invalid_snapshot_ids;
  END IF;
END $$;
