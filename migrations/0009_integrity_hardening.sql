CREATE TABLE tracking_unique_visitors (
  bucket_date TEXT NOT NULL,
  offer_id TEXT NOT NULL DEFAULT '',
  funnel_id TEXT NOT NULL DEFAULT '',
  variant_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(
    bucket_date,
    offer_id,
    funnel_id,
    variant_id,
    event_type,
    anonymous_id
  )
);

CREATE INDEX idx_tracking_unique_visitors_created
  ON tracking_unique_visitors(created_at);

CREATE TABLE public_rate_limits (
  scope TEXT NOT NULL CHECK(scope IN ('events', 'leads')),
  identity_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(scope, identity_hash, window_start)
);

CREATE INDEX idx_public_rate_limits_updated
  ON public_rate_limits(updated_at);

INSERT OR IGNORE INTO tracking_unique_visitors(
  bucket_date,
  offer_id,
  funnel_id,
  variant_id,
  event_type,
  anonymous_id
)
SELECT
  date(occurred_at),
  COALESCE(offer_id, ''),
  COALESCE(funnel_id, ''),
  COALESCE(variant_id, ''),
  event_type,
  anonymous_id
FROM tracking_events
WHERE anonymous_id IS NOT NULL
  AND anonymous_id <> ''
  AND date(occurred_at) IS NOT NULL;

DELETE FROM tracking_aggregates;

INSERT INTO tracking_aggregates(
  bucket_date,
  offer_id,
  funnel_id,
  variant_id,
  event_type,
  event_count,
  unique_count,
  value_sum,
  updated_at
)
SELECT
  date(occurred_at),
  COALESCE(offer_id, ''),
  COALESCE(funnel_id, ''),
  COALESCE(variant_id, ''),
  event_type,
  COUNT(*),
  COUNT(DISTINCT NULLIF(anonymous_id, '')),
  SUM(COALESCE(CAST(json_extract(properties_json, '$.value') AS REAL), 0)),
  datetime('now')
FROM tracking_events
WHERE date(occurred_at) IS NOT NULL
GROUP BY
  date(occurred_at),
  COALESCE(offer_id, ''),
  COALESCE(funnel_id, ''),
  COALESCE(variant_id, ''),
  event_type;

DROP TRIGGER IF EXISTS tracking_events_after_insert_aggregate;

CREATE TRIGGER tracking_events_after_insert_aggregate
AFTER INSERT ON tracking_events
BEGIN
  INSERT INTO tracking_aggregates(
    bucket_date,
    offer_id,
    funnel_id,
    variant_id,
    event_type,
    event_count,
    unique_count,
    value_sum,
    updated_at
  )
  VALUES (
    COALESCE(date(NEW.occurred_at), date('now')),
    COALESCE(NEW.offer_id, ''),
    COALESCE(NEW.funnel_id, ''),
    COALESCE(NEW.variant_id, ''),
    NEW.event_type,
    1,
    CASE
      WHEN NEW.anonymous_id IS NULL OR NEW.anonymous_id = '' THEN 0
      WHEN EXISTS (
        SELECT 1
        FROM tracking_unique_visitors
        WHERE bucket_date = COALESCE(date(NEW.occurred_at), date('now'))
          AND offer_id = COALESCE(NEW.offer_id, '')
          AND funnel_id = COALESCE(NEW.funnel_id, '')
          AND variant_id = COALESCE(NEW.variant_id, '')
          AND event_type = NEW.event_type
          AND anonymous_id = NEW.anonymous_id
      ) THEN 0
      ELSE 1
    END,
    COALESCE(CAST(json_extract(NEW.properties_json, '$.value') AS REAL), 0),
    datetime('now')
  )
  ON CONFLICT(bucket_date, offer_id, funnel_id, variant_id, event_type)
  DO UPDATE SET
    event_count = event_count + 1,
    unique_count = unique_count + excluded.unique_count,
    value_sum = value_sum + excluded.value_sum,
    updated_at = datetime('now');

  INSERT OR IGNORE INTO tracking_unique_visitors(
    bucket_date,
    offer_id,
    funnel_id,
    variant_id,
    event_type,
    anonymous_id
  )
  SELECT
    COALESCE(date(NEW.occurred_at), date('now')),
    COALESCE(NEW.offer_id, ''),
    COALESCE(NEW.funnel_id, ''),
    COALESCE(NEW.variant_id, ''),
    NEW.event_type,
    NEW.anonymous_id
  WHERE NEW.anonymous_id IS NOT NULL
    AND NEW.anonymous_id <> '';
END;
