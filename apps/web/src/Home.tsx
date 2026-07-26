import { useEffect, useState } from "react";
import type { OfferSummary, PageSummary, SessionUser } from "../../../packages/shared/src/schemas";
import { api } from "./api";
import { Empty, PageHeader, StatusPill, firstName, navigate } from "./ui";

export function Home({ user }: { user: SessionUser }) {
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([api.offers(), api.pages()])
      .then(([offerResult, pageResult]) => {
        setOffers(offerResult.offers);
        setPages(pageResult.pages);
      })
      .catch(() => {
        setOffers([]);
        setPages([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const livePages = pages.filter((page) => page.isLive);
  return (
    <>
      <PageHeader
        eyebrow="Início"
        title={`Bem-vindo, ${firstName(user.name)}.`}
        subtitle="Sua operação de vendas começa pela oferta e termina com uma publicação realmente verificada."
        actions={<button className="button primary" onClick={() => navigate("/studio?new=1")}>+ Criar oferta</button>}
      />
      <section className="welcome-hero">
        <div>
          <span className="eyebrow">CENTRAL DE OPERAÇÃO</span>
          <h2>Construa, publique e acompanhe sem sair da KRANO.</h2>
          <p>Oferta, funil, páginas, vídeo, rastreamento e checkout organizados no mesmo fluxo de trabalho.</p>
          <div className="welcome-actions"><button className="button primary" onClick={() => navigate("/studio")}>Abrir minhas ofertas</button><button className="button secondary" onClick={() => navigate("/dashboard")}>Ver métricas</button></div>
        </div>
        <div className="welcome-score">
          <small>OPERAÇÃO ATUAL</small>
          <strong>{livePages.length}</strong>
          <span>página(s) no ar</span>
          <i>{offers.length} oferta(s)</i>
        </div>
      </section>
      <section className="workspace-steps">
        <QuickStep number="01" title="Oferta e funil" text="Crie a estratégia e organize as etapas." action="Abrir central" href="/studio" />
        <QuickStep number="02" title="Páginas e VSL" text="Construa cada página dentro da oferta." action="Editar páginas" href="/studio" />
        <QuickStep number="03" title="Meta, GA4 e checkout" text="Conecte a medição e o destino da venda." action="Configurar" href="/studio" />
        <QuickStep number="04" title="Publicar e medir" text="Valide a rota pública e acompanhe vazamentos." action="Ver dashboard" href="/dashboard" />
      </section>
      <section className="panel recent-work">
        <div className="panel-header"><div><span className="eyebrow">CONTINUE DE ONDE PAROU</span><h2>Ofertas recentes</h2></div><button className="button ghost" onClick={() => navigate("/studio")}>Ver todas →</button></div>
        {loading ? <div className="skeleton tall" /> : offers.length ? (
          <div className="recent-offers">{offers.slice(0, 4).map((offer) => <button key={offer.id} onClick={() => navigate(`/studio?offer=${offer.id}`)}><span>◫</span><div><strong>{offer.name}</strong><small>{offer.funnelCount} funis · {offer.pageCount} páginas</small></div><StatusPill status={offer.status} /></button>)}</div>
        ) : <Empty icon="◫" title="Sua primeira oferta começa aqui" text="A KRANO organizará todas as ferramentas dentro dela." action={<button className="button primary" onClick={() => navigate("/studio?new=1")}>Criar oferta</button>} />}
      </section>
    </>
  );
}

function QuickStep({ number, title, text, action, href }: { number: string; title: string; text: string; action: string; href: string }) {
  return <article><span>{number}</span><h3>{title}</h3><p>{text}</p><button onClick={() => navigate(href)}>{action} →</button></article>;
}
