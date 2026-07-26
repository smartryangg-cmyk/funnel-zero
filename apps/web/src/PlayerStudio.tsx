import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AssetSummary,
  PlayerConfig,
  VideoMetrics
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Notice, PageHeader, format, formatBytes, navigate } from "./ui";

type KratubeView = "library" | "editor" | "analytics" | "experiments" | "security";
type EditorModule =
  | "style"
  | "progress"
  | "autoplay"
  | "headlines"
  | "actions"
  | "resume"
  | "playback"
  | "quality";
type PreviewDevice = "desktop" | "mobile";

export function PlayerStudio() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [config, setConfig] = useState<PlayerConfig | null>(null);
  const [metrics, setMetrics] = useState<VideoMetrics | null>(null);
  const [view, setView] = useState<KratubeView>("library");
  const [editorModule, setEditorModule] = useState<EditorModule | null>(null);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [days, setDays] = useState(7);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadAssets() {
    try {
      const result = await api.assets();
      setAssets(result.assets);
      const videos = result.assets.filter((asset) => asset.mediaType === "video" && asset.uploadStatus === "ready");
      setSelectedId((current) => current || videos[0]?.id || "");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar os vídeos.");
    }
  }
  useEffect(() => { void loadAssets(); }, []);

  const videos = useMemo(() => assets.filter((asset) => asset.mediaType === "video" && asset.uploadStatus === "ready"), [assets]);
  const images = useMemo(() => assets.filter((asset) => asset.mediaType === "image" && asset.uploadStatus === "ready"), [assets]);
  const selected = useMemo(() => videos.find((asset) => asset.id === selectedId) ?? null, [videos, selectedId]);

  useEffect(() => {
    if (!selected) {
      setConfig(null);
      setMetrics(null);
      return;
    }
    setConfig(structuredClone(selected.playerConfig));
    api.videoMetrics(selected.id, days)
      .then((result) => setMetrics(result.metrics))
      .catch((caught: unknown) => setMessage(caught instanceof Error ? caught.message : "Falha nas métricas do vídeo."));
  }, [selected, days]);

  async function save(success = "Configurações do KRATUBE salvas.") {
    if (!selected || !config) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await api.updateAsset(selected.id, { playerConfig: config });
      setAssets((current) => current.map((asset) => asset.id === selected.id ? result.asset : asset));
      setMessage(success);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao salvar o player.");
    } finally {
      setSaving(false);
    }
  }

  function openVideo(assetId: string, target: KratubeView) {
    setSelectedId(assetId);
    setView(target);
  }

  return (
    <>
      <PageHeader
        eyebrow="KRATUBE"
        title="Hospedagem, player e conversão em uma estrutura única."
        subtitle="Biblioteca, editor modular, testes, segurança e analytics sem sair da KRANO."
        actions={<button className="button primary" onClick={() => navigate("/media-library")}>+ Enviar vídeo</button>}
      />
      {message && <Notice tone={message.includes("salv") || message.includes("configurad") ? "success" : "warning"}>{message}</Notice>}

      <nav className="kratube-nav" aria-label="Áreas do KRATUBE">
        {([
          ["library", "Meus vídeos"],
          ["editor", "Editar player"],
          ["analytics", "Analytics"],
          ["experiments", "Testes A/B"],
          ["security", "Segurança"]
        ] as const).map(([key, label]) => <button key={key} className={view === key ? "active" : ""} disabled={key !== "library" && !selected} onClick={() => setView(key)}>{label}</button>)}
      </nav>

      {view === "library" && (
        <VideoLibrary videos={videos} metrics={metrics} onOpen={openVideo} />
      )}

      {view !== "library" && selected && config && (
        <>
          {view !== "editor" && (
            <section className="studio-selector panel">
              <label className="field"><span>Vídeo selecionado</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{videos.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>
              {(view === "analytics") && <div className="period-tabs">{[1, 7, 30].map((value) => <button key={value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>{value === 1 ? "Hoje" : `${value} dias`}</button>)}</div>}
            </section>
          )}

          {view === "editor" && (
            <section className="vturb-editor-shell">
              <aside className="panel vturb-config-panel">
                {editorModule ? (
                  <>
                    <button className="vturb-back" onClick={() => setEditorModule(null)}>← Voltar às configurações</button>
                    <div className="vturb-config-scroll">
                      {editorModule === "style" && <StyleEditor config={config} setConfig={setConfig} />}
                      {editorModule === "progress" && <ProgressEditor config={config} setConfig={setConfig} />}
                      {editorModule === "autoplay" && <AutoplayEditor config={config} setConfig={setConfig} />}
                      {editorModule === "headlines" && <HeadlinesEditor config={config} setConfig={setConfig} />}
                      {editorModule === "actions" && <ActionsEditor config={config} setConfig={setConfig} />}
                      {editorModule === "resume" && <ResumeEditor config={config} setConfig={setConfig} />}
                      {editorModule === "playback" && <PlaybackEditor config={config} setConfig={setConfig} />}
                      {editorModule === "quality" && <QualityEditor config={config} setConfig={setConfig} videos={videos.filter((video) => video.id !== selected.id)} />}
                    </div>
                  </>
                ) : (
                  <EditorMenu config={config} onSelect={setEditorModule} />
                )}
                <button className="button primary full vturb-save" disabled={saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar alterações"}</button>
              </aside>

              <div className="vturb-preview-column">
                <header className="panel vturb-preview-toolbar">
                  <label className="vturb-video-select">
                    <span>Vídeo</span>
                    <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{videos.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select>
                  </label>
                  <div className="vturb-preview-actions">
                    <div className="device-switch" aria-label="Dispositivo do preview">
                      <button className={previewDevice === "desktop" ? "active" : ""} aria-label="Visualização para desktop" onClick={() => setPreviewDevice("desktop")}>▣</button>
                      <button className={previewDevice === "mobile" ? "active" : ""} aria-label="Visualização para celular" onClick={() => setPreviewDevice("mobile")}>▯</button>
                    </div>
                    <button className="button secondary compact-button" onClick={() => setView("analytics")}>Analytics</button>
                  </div>
                </header>

                <article className={`panel vturb-preview-stage device-${previewDevice}`}>
                  <div className="vturb-preview-heading">
                    <div><span className="eyebrow">PREVIEW EM TEMPO REAL</span><h2>{selected.originalName}</h2></div>
                    <span className="live-edit-badge">● AO VIVO</span>
                  </div>
                  <div className="vturb-device-frame">
                    <PlayerPreview asset={selected} config={config} images={images} />
                  </div>
                  <p className="security-note">As alterações aparecem imediatamente no preview e só são publicadas ao salvar.</p>
                </article>
              </div>
            </section>
          )}

          {view === "analytics" && <VideoAnalytics metrics={metrics} />}

          {view === "experiments" && (
            <section className="kratube-workspace">
              <article className="panel">
                <span className="eyebrow">THUMBNAILS A/B</span>
                <h2>Teste duas capas com divisão 50/50.</h2>
                <p className="muted">Cada visitante permanece na mesma variante. Os eventos registram a variante para comparação sem declarar vencedor com amostra pequena.</p>
                <label className="field"><span>Thumbnail A</span><select value={config.posterAssetId} onChange={(event) => setConfig({ ...config, posterAssetId: event.target.value })}><option value="">Poster definido na página</option>{images.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>
                <label className="field"><span>Thumbnail B</span><select value={config.posterTestAssetId} onChange={(event) => setConfig({ ...config, posterTestAssetId: event.target.value })}><option value="">Sem teste B</option>{images.filter((asset) => asset.id !== config.posterAssetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>
                <button className="button primary" disabled={saving} onClick={() => void save("Teste de thumbnail configurado.")}>{saving ? "Salvando…" : "Salvar teste"}</button>
              </article>
              <article className="panel experiment-principles">
                <span className="eyebrow">LEITURA PROFISSIONAL</span>
                <h2>O que comparar</h2>
                <div><strong>Play rate</strong><small>Qual capa gera mais início de vídeo.</small></div>
                <div><strong>Retenção</strong><small>Qual variante mantém audiência até o pitch.</small></div>
                <div><strong>Conversão</strong><small>Qual grupo chega ao checkout e à compra.</small></div>
              </article>
            </section>
          )}

          {view === "security" && (
            <section className="kratube-workspace">
              <article className="panel">
                <span className="eyebrow">PROTEÇÃO DE VÍDEO</span>
                <h2>Domínios permitidos</h2>
                <p className="muted">Quando a lista estiver preenchida, o vídeo só executa nesses domínios. Use <code>*.seudominio.com</code> para liberar todos os subdomínios.</p>
                <label className="field"><span>Um domínio por linha</span><textarea rows={8} value={config.allowedDomains.join("\n")} onChange={(event) => setConfig({ ...config, allowedDomains: event.target.value.split(/\r?\n/).map((item) => item.trim().toLowerCase()).filter(Boolean) })} placeholder={"seudominio.com\n*.seudominio.com"} /></label>
                <Toggle label="Bloquear download casual e hotlink" checked={config.protectVideo} onChange={(value) => setConfig({ ...config, protectVideo: value })} />
                <label className="field"><span>Marca d&apos;água</span><input maxLength={40} value={config.watermark} onChange={(event) => setConfig({ ...config, watermark: event.target.value })} placeholder="Ex.: KRANO" /></label>
                <button className="button primary" disabled={saving} onClick={() => void save("Proteção do vídeo configurada.")}>{saving ? "Salvando…" : "Salvar segurança"}</button>
              </article>
              <article className="panel protection-explainer">
                <span className="eyebrow">CAMADAS ATIVAS</span>
                <h2>Proteção honesta</h2>
                <p>Hotlink entre origens é bloqueado no Worker. Menu de contexto, Picture-in-Picture e download casual também são reduzidos.</p>
                <Notice>Nenhum vídeo reproduzido no navegador pode ser tornado impossível de copiar. A KRANO dificulta clonagem casual sem prometer proteção absoluta.</Notice>
              </article>
            </section>
          )}
        </>
      )}
    </>
  );
}

function VideoLibrary({
  videos,
  metrics,
  onOpen
}: {
  videos: AssetSummary[];
  metrics: VideoMetrics | null;
  onOpen: (id: string, target: KratubeView) => void;
}) {
  if (!videos.length) return <section className="panel"><Empty icon="▶" title="Envie o primeiro vídeo" text="O upload fica no R2 da sua conta e o player pode ser usado em qualquer página publicada." action={<button className="button primary" onClick={() => navigate("/media-library")}>Enviar vídeo</button>} /></section>;
  return (
    <section className="panel kratube-library">
      <div className="panel-header"><div><span className="eyebrow">BIBLIOTECA</span><h2>Meus vídeos</h2></div><span className="muted">{videos.length} arquivo(s)</span></div>
      <div className="video-library-table">
        {videos.map((video) => (
          <article key={video.id}>
            <button className="video-thumb" onClick={() => onOpen(video.id, "editor")}><span>▶</span></button>
            <div><strong>{video.originalName}</strong><small>{formatBytes(video.byteSize)} · enviado em {new Date(video.createdAt.endsWith("Z") ? video.createdAt : `${video.createdAt}Z`).toLocaleDateString("pt-BR")}</small></div>
            <span><small>Plays</small><strong>{metrics?.assetId === video.id ? format(metrics.starts) : "—"}</strong></span>
            <div className="video-actions"><button onClick={() => onOpen(video.id, "analytics")}>Analytics</button><button className="button secondary" onClick={() => onOpen(video.id, "editor")}>Editar</button></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlayerPreview({ asset, config, images }: { asset: AssetSummary; config: PlayerConfig; images: AssetSummary[] }) {
  const poster = images.find((image) => image.id === config.posterAssetId)?.url;
  return (
    <div className={`studio-video advanced timeline-${config.timelineStyle}`} style={{ background: config.backgroundColor, borderRadius: config.borderRadius, borderColor: config.primaryColor }}>
      {config.headlineText && <strong className="preview-headline">{config.headlineText}</strong>}
      {asset.url && <video src={asset.url} poster={poster ?? undefined} controls={config.showControls} loop={config.loop} controlsList={config.protectVideo ? "nodownload noremoteplayback" : undefined} disablePictureInPicture={config.protectVideo} muted={config.autoplayMuted} onContextMenu={config.protectVideo ? (event) => event.preventDefault() : undefined} />}
      {config.showBigPlay && <button className="preview-play" style={{ background: config.primaryColor }}>▶</button>}
      {config.watermark && <span className="preview-watermark">{config.watermark}</span>}
      {config.miniHookText && <span className="preview-mini-hook">{config.miniHookText}</span>}
      {config.ctaUrl && <a className={`preview-player-cta ${config.ctaPulse ? "pulse" : ""}`} style={{ background: config.primaryColor }} href={config.ctaUrl} onClick={(event) => event.preventDefault()}>{config.ctaText}</a>}
      {config.smartProgress && <i className="preview-smart-progress" style={{ height: config.smartProgressHeight }}><b style={{ width: "38%", background: config.primaryColor }} /></i>}
    </div>
  );
}

function EditorMenu({ config, onSelect }: { config: PlayerConfig; onSelect: (module: EditorModule) => void }) {
  const items: Array<{ key: EditorModule; icon: string; label: string; description: string; status: string }> = [
    { key: "style", icon: "✦", label: "Estilo", description: "Cores, cantos e controles", status: "Editar" },
    { key: "progress", icon: "◴", label: "Progresso inteligente", description: "Barra de progresso honesta", status: config.smartProgress ? "On" : "Off" },
    { key: "autoplay", icon: "◉", label: "Autoplay inteligente", description: "Início sem som e mensagem", status: config.autoplayMuted ? "On" : "Off" },
    { key: "headlines", icon: "T", label: "Headlines e ganchos", description: "Textos sincronizados com a VSL", status: config.headlineText || config.miniHookText ? "On" : "Off" },
    { key: "actions", icon: "↗", label: "Botões de ação", description: "CTA por tempo e destino", status: config.ctaUrl ? "On" : "Off" },
    { key: "resume", icon: "▣", label: "Continuar assistindo", description: "Retomar de onde o lead parou", status: config.resumePlayback ? "On" : "Off" },
    { key: "playback", icon: "▶", label: "Opções de reprodução", description: "Linha, velocidade e navegação", status: "Abrir" },
    { key: "quality", icon: "HD", label: "Qualidade do vídeo", description: "Fontes 360p, 720p e 1080p", status: config.showQuality ? "On" : "Off" }
  ];
  return (
    <div className="vturb-menu">
      <header>
        <span className="eyebrow">KRATUBE PLAYER</span>
        <h2>Configurações do vídeo</h2>
        <p>Escolha um módulo para personalizar.</p>
      </header>
      <div className="vturb-module-list">
        {items.map((item) => (
          <button key={item.key} onClick={() => onSelect(item.key)}>
            <span className="vturb-module-icon" aria-hidden="true">{item.icon}</span>
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
            <b className={item.status === "On" ? "online" : ""}>{item.status}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function StyleEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Estilos" eyebrow="APARÊNCIA">
    <div className="color-grid">
      <label className="field"><span>Cor principal</span><input type="color" value={config.primaryColor} onChange={(event) => setConfig({ ...config, primaryColor: event.target.value })} /></label>
      <label className="field"><span>Fundo do player</span><input type="color" value={config.backgroundColor} onChange={(event) => setConfig({ ...config, backgroundColor: event.target.value })} /></label>
    </div>
    <NumberField label="Cantos arredondados" value={config.borderRadius} min={0} max={40} suffix="px" onChange={(value) => setConfig({ ...config, borderRadius: value })} />
    <div className="editor-divider" />
    <h3>Controles</h3>
    <Toggle label="Botão de play grande" checked={config.showBigPlay} onChange={(value) => setConfig({ ...config, showBigPlay: value })} />
    <Toggle label="Controles do player" checked={config.showControls} onChange={(value) => setConfig({ ...config, showControls: value })} />
    <Toggle label="Volume" checked={config.showVolume} onChange={(value) => setConfig({ ...config, showVolume: value })} />
    <Toggle label="Tempo do vídeo" checked={config.showTime} onChange={(value) => setConfig({ ...config, showTime: value })} />
    <Toggle label="Tela cheia" checked={config.showFullscreen} onChange={(value) => setConfig({ ...config, showFullscreen: value })} />
    <Toggle label="Controle de velocidade" checked={config.showSpeed} onChange={(value) => setConfig({ ...config, showSpeed: value })} />
  </EditorSection>;
}

function ProgressEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Progresso inteligente" eyebrow="CONVERSÃO">
    <Toggle label="Ativar progresso inteligente" checked={config.smartProgress} onChange={(value) => setConfig({ ...config, smartProgress: value })} />
    <p className="editor-help">A barra usa a cor principal do player e representa progresso real.</p>
    {config.smartProgress && <NumberField label="Altura da barra" value={config.smartProgressHeight} min={2} max={16} suffix="px" onChange={(value) => setConfig({ ...config, smartProgressHeight: value })} />}
  </EditorSection>;
}

function AutoplayEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Autoplay inteligente" eyebrow="INÍCIO">
    <Toggle label="Iniciar automaticamente sem som" checked={config.autoplayMuted} onChange={(value) => setConfig({ ...config, autoplayMuted: value })} />
    <p className="editor-help">O visitante ativa o áudio com um clique, respeitando as regras do navegador.</p>
    {config.autoplayMuted && <label className="field"><span>Mensagem para ativar o som</span><input value={config.autoplayMessage} onChange={(event) => setConfig({ ...config, autoplayMessage: event.target.value })} /></label>}
  </EditorSection>;
}

function HeadlinesEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Headlines e mini-ganchos" eyebrow="MENSAGENS">
    <label className="field"><span>Headline sobre o vídeo</span><input value={config.headlineText} onChange={(event) => setConfig({ ...config, headlineText: event.target.value })} placeholder="Texto opcional" /></label>
    <TimeRange label="Exibição da headline" start={config.headlineStartSeconds} end={config.headlineEndSeconds} onChange={(start, end) => setConfig({ ...config, headlineStartSeconds: start, headlineEndSeconds: end })} />
    <div className="editor-divider" />
    <label className="field"><span>Mini-gancho</span><input value={config.miniHookText} onChange={(event) => setConfig({ ...config, miniHookText: event.target.value })} placeholder="Ex.: Em instantes você verá…" /></label>
    <TimeRange label="Exibição do mini-gancho" start={config.miniHookStartSeconds} end={config.miniHookEndSeconds} onChange={(start, end) => setConfig({ ...config, miniHookStartSeconds: start, miniHookEndSeconds: end })} />
  </EditorSection>;
}

function ActionsEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Botões de ação" eyebrow="CTA">
    <label className="field"><span>Texto do botão</span><input value={config.ctaText} onChange={(event) => setConfig({ ...config, ctaText: event.target.value })} /></label>
    <label className="field"><span>URL HTTPS do CTA</span><input type="url" value={config.ctaUrl} onChange={(event) => setConfig({ ...config, ctaUrl: event.target.value })} placeholder="https://checkout…" /></label>
    <TimeRange label="Exibição do CTA" start={config.ctaAtSeconds} end={config.ctaEndSeconds} onChange={(start, end) => setConfig({ ...config, ctaAtSeconds: start, ctaEndSeconds: end })} />
    <Toggle label="Abrir em nova aba" checked={config.ctaNewTab} onChange={(value) => setConfig({ ...config, ctaNewTab: value })} />
    <Toggle label="Animação pulsante" checked={config.ctaPulse} onChange={(value) => setConfig({ ...config, ctaPulse: value })} />
  </EditorSection>;
}

function ResumeEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Continuar assistindo" eyebrow="RETENÇÃO">
    <Toggle label="Retomar de onde parou" checked={config.resumePlayback} onChange={(value) => setConfig({ ...config, resumePlayback: value })} />
    {config.resumePlayback && <>
      <label className="field"><span>Mensagem de retorno</span><input value={config.resumeMessage} onChange={(event) => setConfig({ ...config, resumeMessage: event.target.value })} /></label>
      <div className="two-fields"><label className="field"><span>Botão continuar</span><input value={config.resumeContinueLabel} onChange={(event) => setConfig({ ...config, resumeContinueLabel: event.target.value })} /></label><label className="field"><span>Botão reiniciar</span><input value={config.resumeRestartLabel} onChange={(event) => setConfig({ ...config, resumeRestartLabel: event.target.value })} /></label></div>
    </>}
  </EditorSection>;
}

function PlaybackEditor({ config, setConfig }: EditorProps) {
  return <EditorSection title="Opções de reprodução" eyebrow="REPRODUÇÃO">
    <label className="field"><span>Linha de reprodução</span><select value={config.timelineStyle} onChange={(event) => setConfig({ ...config, timelineStyle: event.target.value as PlayerConfig["timelineStyle"] })}><option value="real">Real</option><option value="minimal">Minimalista</option><option value="hidden">Oculta</option></select></label>
    <Toggle label="Permitir avançar" checked={config.allowSeek} onChange={(value) => setConfig({ ...config, allowSeek: value })} />
    <Toggle label="Clique no vídeo para pausar" checked={config.clickToPause} onChange={(value) => setConfig({ ...config, clickToPause: value })} />
    <Toggle label="Recomeçar após o fim" checked={config.loop} onChange={(value) => setConfig({ ...config, loop: value })} />
    <label className="field"><span>Velocidade inicial</span><select value={config.playbackRate} onChange={(event) => setConfig({ ...config, playbackRate: Number(event.target.value) })}><option value={0.75}>0,75x</option><option value={1}>1x</option><option value={1.1}>1,1x</option><option value={1.2}>1,2x</option><option value={1.5}>1,5x</option></select></label>
    <div className="two-fields">
      <label className="field"><span>Voltar</span><select value={config.rewindSeconds} onChange={(event) => setConfig({ ...config, rewindSeconds: Number(event.target.value) as 0 | 5 | 10 })}><option value={0}>Oculto</option><option value={5}>5 segundos</option><option value={10}>10 segundos</option></select></label>
      <label className="field"><span>Avançar</span><select value={config.forwardSeconds} onChange={(event) => setConfig({ ...config, forwardSeconds: Number(event.target.value) as 0 | 5 | 10 })}><option value={0}>Oculto</option><option value={5}>5 segundos</option><option value={10}>10 segundos</option></select></label>
    </div>
  </EditorSection>;
}

function QualityEditor({ config, setConfig, videos }: EditorProps & { videos: AssetSummary[] }) {
  return <EditorSection title="Qualidade do vídeo" eyebrow="FONTES">
    <Toggle label="Mostrar seletor de qualidade" checked={config.showQuality} onChange={(value) => setConfig({ ...config, showQuality: value })} />
    <p className="editor-help">Associe versões já enviadas à biblioteca. O player mantém a principal como automática.</p>
    {(["360p", "720p", "1080p"] as const).map((label) => (
      <label className="field" key={label}><span>{label}</span><select value={config.qualitySources.find((item) => item.label === label)?.assetId ?? ""} onChange={(event) => {
        const remaining = config.qualitySources.filter((item) => item.label !== label);
        setConfig({ ...config, qualitySources: event.target.value ? [...remaining, { label, assetId: event.target.value }] : remaining });
      }}><option value="">Não configurada</option>{videos.map((video) => <option key={video.id} value={video.id}>{video.originalName}</option>)}</select></label>
    ))}
  </EditorSection>;
}

function VideoAnalytics({ metrics }: { metrics: VideoMetrics | null }) {
  if (!metrics) return <div className="panel skeleton tall" />;
  const funnel = [
    ["Plays", metrics.starts],
    ["Pitch", metrics.pitchReached],
    ["Checkout", metrics.checkoutClicks],
    ["Conclusões", metrics.completions]
  ] as const;
  return <>
    <section className="player-metrics expanded">
      <PlayerMetric label="Reproduções" value={format(metrics.starts)} />
      <PlayerMetric label="Pessoas únicas" value={format(metrics.uniqueViewers)} />
      <PlayerMetric label="Retenção média" value={`${metrics.averageRetention}%`} />
      <PlayerMetric label="Engajamento até 50%" value={`${metrics.engagementRate}%`} />
      <PlayerMetric label="Chegaram ao pitch" value={format(metrics.pitchReached)} />
      <PlayerMetric label="Cliques no checkout" value={format(metrics.checkoutClicks)} />
    </section>
    <section className="kratube-analytics-grid">
      <article className="panel">
        <div className="panel-header"><div><span className="eyebrow">RETENÇÃO GERAL</span><h2>Curva por quartil</h2></div><strong>{metrics.completionRate}% concluiu</strong></div>
        <div className="retention-chart">{metrics.retention.map((point) => <div key={point.percent}><span><strong>{point.percent}%</strong><small>{point.rate}% retidos</small></span><i><b style={{ width: `${Math.min(point.rate, 100)}%` }} /></i></div>)}</div>
      </article>
      <article className="panel video-funnel-panel">
        <div className="panel-header"><div><span className="eyebrow">FUNIL DO VÍDEO</span><h2>Da reprodução à ação</h2></div></div>
        <div className="video-funnel">{funnel.map(([label, value], index) => <div key={label}><span>{index + 1}</span><strong>{label}</strong><b>{format(value)}</b><small>{index ? `${funnel[index - 1][1] ? Math.round(value / funnel[index - 1][1] * 10_000) / 100 : 0}%` : "100%"}</small></div>)}</div>
      </article>
      <Breakdown title="Dispositivos" rows={metrics.devices} />
      <Breakdown title="Navegadores" rows={metrics.browsers} />
      <Breakdown title="Origem do tráfego" rows={metrics.sources} />
    </section>
  </>;
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return <article className="panel breakdown-panel"><div className="panel-header"><div><span className="eyebrow">ANÁLISE</span><h2>{title}</h2></div></div>{rows.length ? rows.map((row) => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${total ? row.value / total * 100 : 0}%` }} /></i><strong>{format(row.value)}</strong></div>) : <Empty icon="◎" title="Aguardando dados" text="Novos plays serão classificados automaticamente." />}</article>;
}

interface EditorProps {
  config: PlayerConfig;
  setConfig: (config: PlayerConfig) => void;
}

function EditorSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="editor-section"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{children}</div>;
}

function TimeRange({ label, start, end, onChange }: { label: string; start: number; end: number; onChange: (start: number, end: number) => void }) {
  return <div className="time-range"><span>{label}</span><label>Início<input type="number" min={0} value={start} onChange={(event) => onChange(Number(event.target.value) || 0, end)} /></label><label>Término<input type="number" min={0} value={end} onChange={(event) => onChange(start, Number(event.target.value) || 0)} placeholder="0 = até o fim" /></label></div>;
}

function NumberField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="range-field"><span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><strong>{value}{suffix}</strong></label>;
}

function PlayerMetric({ label, value }: { label: string; value: string }) {
  return <article><small>{label}</small><strong>{value}</strong></article>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
