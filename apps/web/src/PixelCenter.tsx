import { useEffect, useMemo, useState } from "react";
import type { IntegrationSettings } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Notice, PageHeader } from "./ui";

export function PixelCenter() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [offerId, setOfferId] = useState("");
  const [mode, setMode] = useState<"pixel" | "capi" | "ga4">("pixel");
  const [form, setForm] = useState({
    metaCode: "",
    metaPixelId: "",
    ga4Code: "",
    ga4Id: "",
    capiEnabled: false,
    capiToken: "",
    testEventCode: "",
    hasCapiToken: false
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.integrations()
      .then((result) => {
        setSettings(result);
        setOfferId(result.offers[0]?.id ?? "");
      })
      .catch((caught: unknown) => setMessage(caught instanceof Error ? caught.message : "Falha ao carregar integrações."));
  }, []);

  const selected = useMemo(
    () => settings?.offers.find((offer) => offer.id === offerId) ?? null,
    [settings, offerId]
  );
  useEffect(() => {
    const config = selected?.pixelConfig ?? {};
    setForm({
      metaCode: "",
      metaPixelId: typeof config.metaPixelId === "string" ? config.metaPixelId : "",
      ga4Code: "",
      ga4Id: typeof config.ga4Id === "string" ? config.ga4Id : "",
      capiEnabled: config.capiEnabled === true,
      capiToken: "",
      testEventCode: typeof config.testEventCode === "string" ? config.testEventCode : "",
      hasCapiToken: config.hasCapiToken === true
    });
    setMessage("");
  }, [selected]);

  async function save() {
    if (!offerId) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await api.savePixels(offerId, {
        metaPixelId: form.metaPixelId,
        metaCode: form.metaCode,
        ga4Id: form.ga4Id,
        ga4Code: form.ga4Code,
        capiEnabled: form.capiEnabled,
        capiToken: form.capiToken || undefined,
        testEventCode: form.testEventCode
      });
      setForm((current) => ({
        ...current,
        metaPixelId: current.metaPixelId || extractPixelId(current.metaCode),
        ga4Id: current.ga4Id || extractGa4Id(current.ga4Code),
        ga4Code: "",
        capiToken: "",
        hasCapiToken: result.diagnostics.tokenAvailable,
        capiEnabled: result.diagnostics.capiEnabled
      }));
      setMessage(
        result.diagnostics.detectedGa4FromCode
          ? "GA4 detectado no código, instalado nas páginas e conectado aos eventos do funil."
          : result.diagnostics.detectedFromCode
            ? "Pixel detectado no código e configurado automaticamente."
            : "Integração salva."
      );
      const refreshed = await api.integrations();
      setSettings(refreshed);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Falha ao configurar o rastreamento.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!offerId) return;
    setMessage("Enviando evento de teste…");
    try {
      const result = await api.testMeta(offerId);
      setMessage(`${result.message} ${result.received} evento(s) aceito(s).`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "A Meta recusou o teste.");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Central de rastreamento"
        title="Meta e GA4 sem configuração técnica."
        subtitle="Cole o código uma vez. A KRANO identifica a conta, instala a tag e conecta os eventos de cada oferta."
      />
      {message && <Notice tone={/salva|detectado|aceito/.test(message) ? "success" : "warning"}>{message}</Notice>}
      <section className="tracking-layout">
        <article className="panel tracking-form">
          <label className="field"><span>Oferta</span><select value={offerId} onChange={(event) => setOfferId(event.target.value)}><option value="">Escolha uma oferta</option>{settings?.offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label>
          <div className="tracking-tabs">
            <button className={mode === "pixel" ? "active" : ""} onClick={() => setMode("pixel")}>Meta Pixel</button>
            <button className={mode === "capi" ? "active" : ""} onClick={() => setMode("capi")}>Meta CAPI</button>
            <button className={mode === "ga4" ? "active" : ""} onClick={() => setMode("ga4")}>Google GA4</button>
          </div>

          {mode === "pixel" ? (
            <>
              <label className="field"><span>Cole o código completo da Meta</span><textarea rows={11} value={form.metaCode} onChange={(event) => setForm({ ...form, metaCode: event.target.value })} placeholder={"<!-- Meta Pixel Code -->\n<script>...fbq('init', '123456789')...</script>"} /></label>
              <div className="or-divider"><span>ou informe manualmente</span></div>
              <label className="field"><span>ID do Meta Pixel</span><input inputMode="numeric" value={form.metaPixelId} onChange={(event) => setForm({ ...form, metaPixelId: event.target.value.replace(/\D/g, "") })} placeholder="123456789012345" /></label>
              <p className="field-help">O código colado não é executado no painel. Apenas o ID válido é extraído e instalado de forma segura nas páginas publicadas.</p>
            </>
          ) : mode === "capi" ? (
            <>
              <div className="capi-status">
                <span className={form.hasCapiToken ? "online" : ""} />
                <div><strong>{form.hasCapiToken ? "Token armazenado com criptografia" : "Token ainda não configurado"}</strong><small>O token nunca volta para o navegador depois de salvo.</small></div>
              </div>
              <label className="toggle-row"><span>Ativar API de Conversões</span><input type="checkbox" checked={form.capiEnabled} onChange={(event) => setForm({ ...form, capiEnabled: event.target.checked })} /></label>
              <label className="field"><span>Token de acesso</span><input type="password" autoComplete="new-password" value={form.capiToken} onChange={(event) => setForm({ ...form, capiToken: event.target.value })} placeholder={form.hasCapiToken ? "Deixe vazio para manter o token atual" : "Cole o token gerado na Meta"} /></label>
              <label className="field"><span>Código de evento de teste (opcional)</span><input value={form.testEventCode} onChange={(event) => setForm({ ...form, testEventCode: event.target.value })} placeholder="TEST12345" /></label>
            </>
          ) : (
            <>
              <div className="ga4-connection-card">
                <span className={form.ga4Id ? "online" : ""}>G</span>
                <div><strong>{form.ga4Id ? `GA4 conectado: ${form.ga4Id}` : "Conecte o Google Analytics"}</strong><small>{form.ga4Id ? "A tag será incluída automaticamente em todas as páginas desta oferta." : "Não precisa editar código, cabeçalho ou Google Tag Manager."}</small></div>
              </div>
              <a className="button secondary full" href="https://analytics.google.com/analytics/web/#/a" target="_blank" rel="noreferrer">Abrir minha conta Google Analytics ↗</a>
              <label className="field"><span>Cole o código completo da tag do Google</span><textarea rows={10} value={form.ga4Code} onChange={(event) => setForm({ ...form, ga4Code: event.target.value })} placeholder={"<!-- Google tag (gtag.js) -->\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX\"></script>\n<script>gtag('config', 'G-XXXXXXXXXX');</script>"} /></label>
              <div className="or-divider"><span>ou cole somente o identificador</span></div>
              <label className="field"><span>ID de medição</span><input value={form.ga4Id} onChange={(event) => setForm({ ...form, ga4Id: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} placeholder="G-XXXXXXXXXX" /></label>
              <div className="ga4-events"><strong>Eventos automáticos</strong><span>page_view</span><span>vsl_start</span><span>generate_lead</span><span>begin_checkout</span><span>purchase</span></div>
              <p className="field-help">A KRANO extrai apenas o ID `G-...`, gera a tag segura e traduz os eventos do funil para os nomes recomendados pelo GA4.</p>
            </>
          )}

          <div className="form-actions">
            {mode === "capi" && <button className="button secondary" disabled={!form.hasCapiToken && !form.capiToken} onClick={() => void test()}>Testar conexão</button>}
            <button className="button primary" disabled={!offerId || saving} onClick={() => void save()}>{saving ? "Configurando…" : mode === "ga4" ? "Configurar GA4 automaticamente" : "Salvar configuração"}</button>
          </div>
        </article>

        <aside className="panel tracking-guide">
          <span className="eyebrow">PASSO A PASSO</span>
          <h2>{mode === "pixel" ? "Meta Pixel em menos de um minuto" : mode === "capi" ? "CAPI sem quebrar a cabeça" : "GA4 guiado para iniciantes"}</h2>
          {mode === "pixel" ? (
            <ol>
              <Guide number="1" title="Abra a Meta" text="Copie o código completo do Pixel no Gerenciador de Eventos." />
              <Guide number="2" title="Cole acima" text="A KRANO encontra o ID e instala em todas as páginas da oferta." />
              <Guide number="3" title="Publique" text="PageView, Lead, checkout e compra são enviados com a oferta correta." />
            </ol>
          ) : mode === "capi" ? (
            <ol>
              <Guide number="1" title="Gere o token" text="Na Meta, abra Configurações do Pixel e escolha API de Conversões." />
              <Guide number="2" title="Cole uma única vez" text="O token é cifrado no servidor e não fica exposto no construtor." />
              <Guide number="3" title="Teste por aqui" text="Use o código de teste da Meta e confirme sem sair da KRANO." />
            </ol>
          ) : (
            <ol>
              <Guide number="1" title="Abra o Google Analytics" text="Crie ou escolha uma propriedade e abra Fluxos de dados → Web." />
              <Guide number="2" title="Copie e cole" text="Pode colar o código inteiro ou apenas o ID que começa com G-." />
              <Guide number="3" title="Pronto" text="A KRANO instala a tag e envia visita, lead, checkout e compra em todas as páginas da oferta." />
            </ol>
          )}
          <div className="privacy-card"><strong>Eventos cobertos</strong><p>Visita, início da VSL, conclusão do quiz, lead, clique no checkout e compra confirmada por webhook.</p></div>
        </aside>
      </section>
    </>
  );
}

function Guide({ number, title, text }: { number: string; title: string; text: string }) {
  return <li><span>{number}</span><div><strong>{title}</strong><small>{text}</small></div></li>;
}

function extractPixelId(code: string) {
  return code.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/i)?.[1] ?? "";
}

function extractGa4Id(code: string) {
  return code.match(/(?:gtag\s*\(\s*['"]config['"]\s*,\s*['"]|[?&]id=)(G-[A-Z0-9]{6,15})/i)?.[1]?.toUpperCase() ?? "";
}
