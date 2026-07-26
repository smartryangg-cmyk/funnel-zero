UPDATE page_drafts
SET content_json = json_set(
  content_json,
  '$.blocks[3].content.src',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
)
WHERE page_id = 'demo_page_vsl';

UPDATE page_versions
SET content_json = json_set(
  content_json,
  '$.blocks[3].content.src',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
)
WHERE id IN ('demo_page_vsl_version_1', 'demo_page_vsl_version_2');
