UPDATE page_drafts
SET content_json = json_set(
  content_json,
  '$.settings.pitchAtSeconds',
  2,
  '$.blocks[3].content.ctaAtSeconds',
  2
)
WHERE page_id = 'demo_page_vsl';

UPDATE page_versions
SET content_json = json_set(
  content_json,
  '$.settings.pitchAtSeconds',
  2,
  '$.blocks[3].content.ctaAtSeconds',
  2
)
WHERE id IN ('demo_page_vsl_version_1', 'demo_page_vsl_version_2');
