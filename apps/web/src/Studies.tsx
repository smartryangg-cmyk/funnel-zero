import { PageHeader } from "./ui";

export function Studies() {
  return (
    <>
      <PageHeader
        eyebrow="Estudos"
        title="Seu acervo de conhecimento terá um lugar próprio."
        subtitle="Módulo reservado para cursos, aulas, materiais e futuras integrações de biblioteca."
      />
      <section className="studies-roadmap panel">
        <span className="roadmap-label">ETAPA POSTERIOR</span>
        <div className="studies-icon">▱</div>
        <h2>Estudos está corretamente separado — sem recurso falso.</h2>
        <p>
          A estrutura já existe no menu, mas a conexão com Google Drive ou outro acervo só será implementada quando a fonte dos cursos for definida.
        </p>
        <div className="roadmap-chips">
          <span>Biblioteca de cursos</span>
          <span>Progresso das aulas</span>
          <span>Busca por conteúdo</span>
          <span>Integração a definir</span>
        </div>
      </section>
    </>
  );
}
