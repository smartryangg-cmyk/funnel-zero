ALTER TABLE assets ADD COLUMN player_config_json TEXT NOT NULL DEFAULT
  '{"showControls":true,"showVolume":true,"timelineStyle":"real","allowSeek":true,"resumePlayback":true,"showSpeed":false,"showQuality":false,"autoplayMuted":false,"clickToPause":true,"protectVideo":true,"watermark":"","ctaAtSeconds":0,"qualitySources":[]}'
  CHECK(json_valid(player_config_json));

ALTER TABLE leads ADD COLUMN whatsapp TEXT;
ALTER TABLE leads ADD COLUMN custom_fields_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_fields_json));

CREATE TABLE integration_secrets (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('meta_capi')),
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(offer_id, kind)
);

INSERT OR IGNORE INTO templates(id, name, slug, category, content_json) VALUES
('tpl_sales_red', 'Venda direta · Redline', 'venda-direta-redline', 'sales',
 '{"version":1,"theme":{"background":"#000000","text":"#ffffff","accent":"#ff2438"},"blocks":[{"id":"kicker","type":"paragraph","content":"UMA NOVA FORMA DE TOMAR A PRÓXIMA DECISÃO"},{"id":"headline","type":"heading","content":"Uma página direta, rápida e pronta para vender no mobile"},{"id":"proof","type":"paragraph","content":"Explique o mecanismo, mostre o que a pessoa recebe e use somente provas verificáveis."},{"id":"cta","type":"button","content":{"label":"Conhecer a oferta","href":"#checkout","revealAfterPitch":false}}]}'),
('tpl_quiz_advanced', 'Quiz interativo · Diagnóstico', 'quiz-interativo-diagnostico', 'quiz',
 '{"version":1,"theme":{"background":"#000000","text":"#ffffff","accent":"#ff2438"},"blocks":[{"id":"headline","type":"heading","content":"Descubra o próximo passo mais coerente para você"},{"id":"capture","type":"leadForm","content":{"fields":{"name":true,"email":true,"whatsapp":true},"label":"Começar diagnóstico"}},{"id":"quiz","type":"quiz","content":{"title":"Diagnóstico rápido","transitionMs":450,"showProgress":true,"questions":[{"title":"Qual é seu principal objetivo agora?","options":["Ter uma direção clara","Avançar com mais consistência","Corrigir o que está travando"]},{"title":"O que mais atrapalha sua decisão?","options":["Informação demais","Falta de acompanhamento","Não saber o próximo passo"]}]}}]}'),
('tpl_support', 'Página de suporte', 'pagina-de-suporte', 'support',
 '{"version":1,"theme":{"background":"#000000","text":"#ffffff","accent":"#ff2438"},"blocks":[{"id":"headline","type":"heading","content":"Como podemos ajudar?"},{"id":"body","type":"paragraph","content":"Reúna aqui dúvidas frequentes, canais oficiais e prazos reais de atendimento."},{"id":"form","type":"leadForm","content":{"fields":{"name":true,"email":true,"whatsapp":false},"consent":true,"label":"Enviar solicitação"}}]}'),
('tpl_checkout_demo', 'Checkout demonstrativo', 'checkout-demonstrativo', 'checkout-demo',
 '{"version":1,"theme":{"background":"#000000","text":"#ffffff","accent":"#ff2438"},"blocks":[{"id":"headline","type":"heading","content":"Resumo demonstrativo do pedido"},{"id":"body","type":"paragraph","content":"Este template serve apenas para visualizar a jornada. Conecte Hotmart, PerfectPay ou outro checkout externo para receber pagamentos."},{"id":"cta","type":"button","content":{"label":"Ir para o checkout externo","href":"#checkout","revealAfterPitch":false}}]}');
