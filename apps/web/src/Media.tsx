import { useEffect, useRef, useState } from "react";
import type { AssetSummary } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, Notice, PageHeader, StatusPill, formatBytes } from "./ui";

interface UploadState {
  name: string;
  progress: number;
  status: "hashing" | "uploading" | "completing" | "done" | "error";
  message?: string;
}

export function MediaLibrary({ mediaEnabled }: { mediaEnabled: boolean }) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const assetsResult = await api.assets();
      setAssets(assetsResult.assets);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar biblioteca.");
    }
  }
  useEffect(() => {
    if (mediaEnabled) void load();
  }, [mediaEnabled]);

  async function uploadFile(file: File) {
    let assetId = "";
    try {
      setError("");
      setUpload({ name: file.name, progress: 0, status: "hashing" });
      let sha256: string | undefined;
      if (file.size <= 32 * 1024 * 1024) {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      const init = await api.initiateUpload({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        offerId: null,
        sha256
      });
      assetId = init.assetId;
      const totalParts = Math.ceil(file.size / init.partSize);
      for (let index = 0; index < totalParts; index += 1) {
        const part = index + 1;
        const chunk = file.slice(index * init.partSize, Math.min(file.size, (index + 1) * init.partSize));
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await api.uploadPart(assetId, part, chunk);
            lastError = null;
            break;
          } catch (caught) {
            lastError = caught;
          }
        }
        if (lastError) {
          throw lastError instanceof Error ? lastError : new Error("Falha ao enviar uma parte.");
        }
        setUpload({ name: file.name, progress: Math.round((part / totalParts) * 95), status: "uploading" });
      }
      setUpload({ name: file.name, progress: 98, status: "completing" });
      await api.completeUpload(assetId);
      setUpload({ name: file.name, progress: 100, status: "done" });
      await load();
      window.setTimeout(() => setUpload(null), 2500);
    } catch (caught) {
      setUpload({ name: file.name, progress: 0, status: "error", message: caught instanceof Error ? caught.message : "Falha no upload." });
      if (assetId) await api.deleteAsset(assetId).catch(() => undefined);
    }
  }

  async function rename(asset: AssetSummary) {
    const name = prompt("Novo nome:", asset.originalName);
    if (!name || name === asset.originalName) return;
    await api.renameAsset(asset.id, name);
    await load();
  }
  async function remove(asset: AssetSummary) {
    if (!confirm(`Excluir "${asset.originalName}" do R2? Páginas que usam este arquivo deixarão de exibi-lo.`)) return;
    await api.deleteAsset(asset.id);
    await load();
  }
  const used = assets.filter((asset) => asset.uploadStatus === "ready").reduce((total, asset) => total + asset.byteSize, 0);
  if (!mediaEnabled) {
    return (
      <>
        <PageHeader
          eyebrow="Vídeos"
          title="Ative a hospedagem de vídeo"
          subtitle="Sites funcionam sem o R2. Ative somente se quiser enviar vídeos."
        />
        <section className="panel">
          <Empty
            icon="▶"
            title="Ative somente quando precisar hospedar VSLs"
            text="Abra o KRANO Desktop, localize esta estrutura e clique em “Ativar vídeos”. A Cloudflare poderá solicitar a ativação do R2 e uma forma de pagamento, embora exista franquia gratuita."
          />
        </section>
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="Vídeos"
        title="Enviar vídeo"
        subtitle="MP4 ou WebM, direto para sua conta Cloudflare."
        actions={<><button className="button primary" onClick={() => input.current?.click()}>+ Escolher arquivo</button><input ref={input} hidden type="file" accept="video/mp4,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.currentTarget.value = ""; }} /></>}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <section className="panel storage-strip">
        <div><strong>{formatBytes(used)}</strong><span>registrados no catálogo</span></div>
        <div className="storage-progress"><i style={{ width: `${Math.min(100, used / (10 * 1024 ** 3) * 100)}%` }} /></div>
        <small>Proteção local: 10 GB · arquivo: até 500 MB</small>
      </section>
      {upload && <section className={`upload-card ${upload.status}`}><div><strong>{upload.name}</strong><span>{upload.status === "hashing" ? "Verificando…" : upload.status === "completing" ? "Finalizando no R2…" : upload.status === "done" ? "Upload concluído" : upload.status === "error" ? upload.message : `Enviando ${upload.progress}%`}</span></div><div className="upload-progress"><i style={{ width: `${upload.progress}%` }} /></div></section>}
      {assets.length === 0 ? (
        <section className="panel"><Empty icon="▶" title="Envie a VSL de teste" text="MP4 e WebM entram no player próprio; imagens também podem ser usadas no editor." action={<button className="button primary" onClick={() => input.current?.click()}>Escolher arquivo</button>} /></section>
      ) : (
        <section className="media-grid">
          {assets.map((asset) => (
            <article className="media-card" key={asset.id}>
              <div className="media-preview">
                {asset.mediaType === "video" && asset.url ? <video src={asset.url} controls preload="metadata" /> : asset.mediaType === "image" && asset.url ? <img src={asset.url} alt="" loading="lazy" /> : <span>PDF</span>}
              </div>
              <div className="media-meta"><div><strong>{asset.originalName}</strong><StatusPill status={asset.uploadStatus} /></div><p>{asset.mimeType} · {formatBytes(asset.byteSize)}</p></div>
              <div className="media-actions"><button onClick={() => void rename(asset)}>Renomear</button><button className="danger-text" onClick={() => void remove(asset)}>Excluir</button></div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
