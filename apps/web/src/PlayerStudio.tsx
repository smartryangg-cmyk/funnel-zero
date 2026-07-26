import { useEffect, useMemo, useState } from "react";
import type {
  AssetSummary,
  PlayerConfig,
  VideoMetrics
} from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Notice, PageHeader, format, navigate } from "./ui";

export function PlayerStudio() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [config, setConfig] = useState<PlayerConfig | null>(null);
  const [metrics, setMetrics] = useState<VideoMetrics | null>(null);
  const [days, setDays] = useState(7);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadAssets() {
    try {
      const result = await api.assets();
      const videos = result.assets.filter(
        (asset) => asset.mediaType === "video" && asset.uploadStatus === "ready"
      );
      setAssets(videos);
      setSelectedId((current) => current || videos[0]?.id || "");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao carregar vídeos.");
    }
  }
  useEffect(() => { void loadAssets(); }, []);

  const selected = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? null,
    [assets, selectedId]
  );
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

  async function save() {
    if (!selected || !config) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await api.updateAsset(selected.id, { playerConfig: config });
      setAssets((current) => current.map((asset) => asset.id === selected.id ? result.asset : asset));
      setMessage("Configurações do player salvas.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao salvar o player.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Player de vídeo"
        title="VSL, retenção e conversão no mesmo lugar."
        subtitle="Configure o comportamento do player e veja onde a audiência abandona."
        actions={<button className="button primary" onClick={() => navigate("/media-library")}>+ Enviar VSL</button>}
      />
      {message && <Notice tone={message.includes("salvas") ? "success" : "warning"}>{message}</Notice>}
      {!assets.length ? (
        <section className="panel"><Empty icon="▶" title="Envie a primeira VSL" text="O player é configurado por vídeo e pode ser usado em qualquer página." action={<button className="button primary" onClick={() => navigate("/media-library")}>Enviar vídeo</button>} /></section>
      ) : (
        <>
          <section className="studio-selector panel">
            <label className="field"><span>Vídeo em edição</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>
            <div className="period-tabs">
              {[1, 7, 30].map((value) => <button key={value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>{value === 1 ? "Hoje" : `${value} dias`}</button>)}
            </div>
          </section>

          <section className="player-metrics">
            <PlayerMetric label="Reproduções" value={format(metrics?.starts ?? 0)} />
            <PlayerMetric label="Pessoas únicas" value={format(metrics?.uniqueViewers ?? 0)} />
            <PlayerMetric label="Retenção média" value={`${metrics?.averageRetention ?? 0}%`} />
            <PlayerMetric label="Conclusão" value={`${metrics?.completionRate ?? 0}%`} />
            <PlayerMetric label="Cliques no checkout" value={format(metrics?.checkoutClicks ?? 0)} />
          </section>

          <section className="player-studio-layout">
            <article className="panel player-preview-panel">
              <div className="panel-header"><div><span className="eyebrow">PREVIEW REAL</span><h2>{selected?.originalName}</h2></div></div>
              <div className={`studio-video timeline-${config?.timelineStyle ?? "real"}`}>
                {selected?.url && <video
                  src={selected.url}
                  controls={config?.showControls}
                  controlsList={config?.protectVideo ? "nodownload noremoteplayback" : undefined}
                  disablePictureInPicture={config?.protectVideo}
                  muted={config?.autoplayMuted}
                  onContextMenu={config?.protectVideo ? (event) => event.preventDefault() : undefined}
                />}
                {config?.watermark && <span>{config.watermark}</span>}
              </div>
              <p className="security-note">A proteção reduz download casual, hotlink e menu de contexto. Nenhum vídeo reproduzido no navegador pode ser tornado impossível de copiar.</p>

              <div className="retention-chart">
                {(metrics?.retention ?? []).map((point) => (
                  <div key={point.percent}>
                    <span><strong>{point.percent}%</strong><small>{point.rate}% retidos</small></span>
                    <i><b style={{ width: `${Math.min(point.rate, 100)}%` }} /></i>
                  </div>
                ))}
              </div>
            </article>

            {config && <article className="panel player-settings">
              <div className="panel-header"><div><span className="eyebrow">COMPORTAMENTO</span><h2>Configurações da VSL</h2></div></div>
              <Toggle label="Exibir controles" checked={config.showControls} onChange={(value) => setConfig({ ...config, showControls: value })} />
              <Toggle label="Exibir volume" checked={config.showVolume} onChange={(value) => setConfig({ ...config, showVolume: value })} />
              <Toggle label="Permitir avançar" checked={config.allowSeek} onChange={(value) => setConfig({ ...config, allowSeek: value })} />
              <Toggle label="Retomar de onde parou" checked={config.resumePlayback} onChange={(value) => setConfig({ ...config, resumePlayback: value })} />
              <Toggle label="Controle de velocidade" checked={config.showSpeed} onChange={(value) => setConfig({ ...config, showSpeed: value })} />
              <Toggle label="Seletor de qualidade" checked={config.showQuality} onChange={(value) => setConfig({ ...config, showQuality: value })} />
              <Toggle label="Autoplay sem som" checked={config.autoplayMuted} onChange={(value) => setConfig({ ...config, autoplayMuted: value })} />
              <Toggle label="Clique para pausar" checked={config.clickToPause} onChange={(value) => setConfig({ ...config, clickToPause: value })} />
              <Toggle label="Dificultar download e hotlink" checked={config.protectVideo} onChange={(value) => setConfig({ ...config, protectVideo: value })} />

              <label className="field"><span>Linha de reprodução</span><select value={config.timelineStyle} onChange={(event) => setConfig({ ...config, timelineStyle: event.target.value as PlayerConfig["timelineStyle"] })}><option value="real">Real</option><option value="minimal">Minimalista</option><option value="hidden">Oculta</option></select></label>
              <p className="field-help">As opções mostram o progresso real. A KRANO não falsifica a duração do vídeo.</p>
              <label className="field"><span>CTA em segundos</span><input type="number" min={0} value={config.ctaAtSeconds} onChange={(event) => setConfig({ ...config, ctaAtSeconds: Number(event.target.value) || 0 })} /></label>
              <label className="field"><span>Marca d&apos;água</span><input maxLength={40} value={config.watermark} onChange={(event) => setConfig({ ...config, watermark: event.target.value })} placeholder="Ex.: funnelzero.com" /></label>

              <h3>Qualidades alternativas</h3>
              {(["360p", "720p", "1080p"] as const).map((label) => (
                <label className="field" key={label}><span>{label}</span><select value={config.qualitySources.find((item) => item.label === label)?.assetId ?? ""} onChange={(event) => {
                  const remaining = config.qualitySources.filter((item) => item.label !== label);
                  setConfig({
                    ...config,
                    qualitySources: event.target.value
                      ? [...remaining, { label, assetId: event.target.value }]
                      : remaining
                  });
                }}><option value="">Não configurada</option>{assets.filter((asset) => asset.id !== selectedId).map((asset) => <option key={asset.id} value={asset.id}>{asset.originalName}</option>)}</select></label>
              ))}
              <button className="button primary full" disabled={saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar player"}</button>
            </article>}
          </section>
        </>
      )}
    </>
  );
}

function PlayerMetric({ label, value }: { label: string; value: string }) {
  return <article><small>{label}</small><strong>{value}</strong></article>;
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
