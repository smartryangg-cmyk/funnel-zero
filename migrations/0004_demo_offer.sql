INSERT OR IGNORE INTO offers(
  id, name, slug, status, checkout_url, pixel_config_json
) VALUES (
  'demo_offer_proxima_serie',
  'Plano Próxima Série — Demonstração',
  'plano-proxima-serie-demo',
  'active',
  'https://example.com/checkout-demonstracao',
  '{}'
);

INSERT OR IGNORE INTO funnels(
  id, offer_id, name, slug, status, graph_version, graph_json, published_at
) VALUES (
  'demo_funnel_proxima_serie',
  'demo_offer_proxima_serie',
  'Funil demonstrativo · Próxima Série',
  'funil-proxima-serie-demo',
  'published',
  1,
  '{"version":1,"nodes":[{"id":"demo_node_vsl","type":"vsl","label":"VSL demonstrativa","position":{"x":80,"y":130},"config":{"pageId":"demo_page_vsl"}},{"id":"demo_node_checkout","type":"checkout","label":"Checkout externo de teste","position":{"x":390,"y":130},"config":{"url":"https://example.com/checkout-demonstracao"}},{"id":"demo_node_thanks","type":"page","label":"Página de obrigado","position":{"x":700,"y":130},"config":{"pageId":"demo_page_thanks"}}],"edges":[{"id":"demo_edge_1","source":"demo_node_vsl","target":"demo_node_checkout","label":"CTA"},{"id":"demo_edge_2","source":"demo_node_checkout","target":"demo_node_thanks","label":"Retorno"}]}',
  datetime('now')
);

INSERT OR IGNORE INTO funnel_nodes(id, funnel_id, node_type, label, position_x, position_y, config_json) VALUES
  ('demo_node_vsl', 'demo_funnel_proxima_serie', 'vsl', 'VSL demonstrativa', 80, 130, '{"pageId":"demo_page_vsl"}'),
  ('demo_node_checkout', 'demo_funnel_proxima_serie', 'checkout', 'Checkout externo de teste', 390, 130, '{"url":"https://example.com/checkout-demonstracao"}'),
  ('demo_node_thanks', 'demo_funnel_proxima_serie', 'page', 'Página de obrigado', 700, 130, '{"pageId":"demo_page_thanks"}');

INSERT OR IGNORE INTO funnel_edges(id, funnel_id, source_node_id, target_node_id, label) VALUES
  ('demo_edge_1', 'demo_funnel_proxima_serie', 'demo_node_vsl', 'demo_node_checkout', 'CTA'),
  ('demo_edge_2', 'demo_funnel_proxima_serie', 'demo_node_checkout', 'demo_node_thanks', 'Retorno');

INSERT OR IGNORE INTO pages(
  id, funnel_id, offer_id, name, slug, page_type, status,
  published_version_id, published_at
) VALUES (
  'demo_page_vsl',
  'demo_funnel_proxima_serie',
  'demo_offer_proxima_serie',
  'VSL · Plano Próxima Série',
  'vsl',
  'vsl',
  'published',
  'demo_page_vsl_version_1',
  datetime('now')
);

INSERT OR IGNORE INTO page_drafts(page_id, content_json, revision) VALUES (
  'demo_page_vsl',
  '{"version":1,"theme":{"background":"#070b16","text":"#f8fafc","accent":"#8b5cf6"},"settings":{"title":"Plano Próxima Série — Demonstração","description":"Uma oferta fictícia criada para testar o Funnel Zero de ponta a ponta.","pitchAtSeconds":12},"blocks":[{"id":"demo_notice","type":"paragraph","content":"DEMONSTRAÇÃO FICTÍCIA • SEM OFERTA COMERCIAL"},{"id":"demo_headline","type":"heading","content":"Seu treino não precisa de mais exercícios. Precisa de uma próxima decisão clara."},{"id":"demo_sub","type":"paragraph","content":"Conheça uma forma ilustrativa de organizar progressão, execução e o próximo treino sem trocar tudo toda semana."},{"id":"demo_video","type":"video","content":{"assetId":"","src":"","poster":"","ctaAtSeconds":12}},{"id":"demo_mechanism_title","type":"heading","content":"O Mapa de Progressão Visível"},{"id":"demo_mechanism","type":"paragraph","content":"Nesta demonstração, o mecanismo transforma anotações soltas em três decisões: o que manter, o que ajustar e o que observar na próxima sessão."},{"id":"demo_offer","type":"paragraph","content":"Exemplo de oferta: guia digital + planilha de acompanhamento por R$ 47. Valor meramente demonstrativo; nenhum produto está sendo comercializado nesta página."},{"id":"demo_cta","type":"button","content":{"label":"Abrir checkout demonstrativo","href":"#checkout","revealAfterPitch":true}},{"id":"demo_disclaimer","type":"paragraph","content":"Sem promessa de resultado físico. A página existe apenas para validar publicação, mídia, eventos e checkout externo."}]}',
  1
);

INSERT OR IGNORE INTO page_versions(
  id, page_id, version_number, content_json
) VALUES (
  'demo_page_vsl_version_1',
  'demo_page_vsl',
  1,
  '{"version":1,"theme":{"background":"#070b16","text":"#f8fafc","accent":"#8b5cf6"},"settings":{"title":"Plano Próxima Série — Demonstração","description":"Uma oferta fictícia criada para testar o Funnel Zero de ponta a ponta.","pitchAtSeconds":12},"blocks":[{"id":"demo_notice","type":"paragraph","content":"DEMONSTRAÇÃO FICTÍCIA • SEM OFERTA COMERCIAL"},{"id":"demo_headline","type":"heading","content":"Seu treino não precisa de mais exercícios. Precisa de uma próxima decisão clara."},{"id":"demo_sub","type":"paragraph","content":"Conheça uma forma ilustrativa de organizar progressão, execução e o próximo treino sem trocar tudo toda semana."},{"id":"demo_video","type":"video","content":{"assetId":"","src":"","poster":"","ctaAtSeconds":12}},{"id":"demo_mechanism_title","type":"heading","content":"O Mapa de Progressão Visível"},{"id":"demo_mechanism","type":"paragraph","content":"Nesta demonstração, o mecanismo transforma anotações soltas em três decisões: o que manter, o que ajustar e o que observar na próxima sessão."},{"id":"demo_offer","type":"paragraph","content":"Exemplo de oferta: guia digital + planilha de acompanhamento por R$ 47. Valor meramente demonstrativo; nenhum produto está sendo comercializado nesta página."},{"id":"demo_cta","type":"button","content":{"label":"Abrir checkout demonstrativo","href":"#checkout","revealAfterPitch":true}},{"id":"demo_disclaimer","type":"paragraph","content":"Sem promessa de resultado físico. A página existe apenas para validar publicação, mídia, eventos e checkout externo."}]}'
);

INSERT OR IGNORE INTO page_versions(
  id, page_id, version_number, content_json
) VALUES (
  'demo_page_vsl_version_2',
  'demo_page_vsl',
  2,
  '{"version":1,"theme":{"background":"#07131b","text":"#f0fdfa","accent":"#14b8a6"},"settings":{"title":"Plano Próxima Série — Variação B","description":"Variação fictícia para teste A/B indicativo.","pitchAtSeconds":12},"blocks":[{"id":"demo_notice_b","type":"paragraph","content":"VARIAÇÃO B • DEMONSTRAÇÃO FICTÍCIA"},{"id":"demo_headline_b","type":"heading","content":"Você já treina. Agora precisa enxergar qual é a próxima decisão."},{"id":"demo_sub_b","type":"paragraph","content":"Uma alternativa ilustrativa para organizar progressão sem colecionar planilhas complicadas."},{"id":"demo_video_b","type":"video","content":{"assetId":"","src":"","poster":"","ctaAtSeconds":12}},{"id":"demo_mechanism_b","type":"paragraph","content":"O Mapa de Progressão Visível separa o que manter, o que ajustar e o que observar na próxima sessão."},{"id":"demo_offer_b","type":"paragraph","content":"Exemplo fictício: guia digital + planilha por R$ 47. Não existe venda real associada a esta demonstração."},{"id":"demo_cta_b","type":"button","content":{"label":"Ver destino demonstrativo","href":"#checkout","revealAfterPitch":true}}]}'
);

INSERT OR IGNORE INTO pages(
  id, funnel_id, offer_id, name, slug, page_type, status,
  published_version_id, published_at
) VALUES (
  'demo_page_thanks',
  'demo_funnel_proxima_serie',
  'demo_offer_proxima_serie',
  'Obrigado · Demonstração',
  'obrigado',
  'thank-you',
  'published',
  'demo_page_thanks_version_1',
  datetime('now')
);

INSERT OR IGNORE INTO page_drafts(page_id, content_json, revision) VALUES (
  'demo_page_thanks',
  '{"version":1,"theme":{"background":"#07131b","text":"#effdf8","accent":"#14b8a6"},"blocks":[{"id":"thanks_title","type":"heading","content":"Teste concluído."},{"id":"thanks_body","type":"paragraph","content":"Esta é a página de obrigado demonstrativa do Funnel Zero."},{"id":"thanks_back","type":"button","content":{"label":"Voltar à VSL","href":"/o/plano-proxima-serie-demo/vsl"}}]}',
  1
);

INSERT OR IGNORE INTO page_versions(id, page_id, version_number, content_json) VALUES (
  'demo_page_thanks_version_1',
  'demo_page_thanks',
  1,
  '{"version":1,"theme":{"background":"#07131b","text":"#effdf8","accent":"#14b8a6"},"blocks":[{"id":"thanks_title","type":"heading","content":"Teste concluído."},{"id":"thanks_body","type":"paragraph","content":"Esta é a página de obrigado demonstrativa do Funnel Zero."},{"id":"thanks_back","type":"button","content":{"label":"Voltar à VSL","href":"/o/plano-proxima-serie-demo/vsl"}}]}'
);

INSERT OR IGNORE INTO checkout_integrations(
  id, offer_id, name, checkout_url, parameter_map_json
) VALUES (
  'demo_checkout',
  'demo_offer_proxima_serie',
  'Checkout demonstrativo',
  'https://example.com/checkout-demonstracao',
  '{"anonymousId":"fz_aid","source":"utm_source","campaign":"utm_campaign"}'
);

INSERT OR IGNORE INTO experiments(
  id, funnel_id, name, status
) VALUES (
  'demo_experiment',
  'demo_funnel_proxima_serie',
  'Headline da VSL · Demonstração',
  'paused'
);

INSERT OR IGNORE INTO experiment_variants(
  id, experiment_id, name, weight, page_version_id
) VALUES
  ('demo_variant_a', 'demo_experiment', 'Variante A · Direção clara', 5000, 'demo_page_vsl_version_1'),
  ('demo_variant_b', 'demo_experiment', 'Variante B · Próxima decisão', 5000, 'demo_page_vsl_version_2');
