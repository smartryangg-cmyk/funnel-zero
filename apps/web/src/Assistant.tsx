import { useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "./ui";

const suggestions = [
  "Clone esta página: https://...",
  "Publique meu site e conecte o domínio",
  "Configure o player do meu vídeo",
  "Encontre e corrija um problema"
];

export function Assistant() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [text, setText] = useState(params.get("prompt") === "clone" ? suggestions[0] : "");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

  function send(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setMessages((current) => [...current, { role: "user", text: value }, {
      role: "assistant",
      text: "Abra esta conversa pelo KRANO Desktop para eu executar a tarefa com acesso controlado aos arquivos e à Cloudflare."
    }]);
    setText("");
  }

  return <>
    <PageHeader eyebrow="Assistente" title="Assistente geral" subtitle="Peça em linguagem simples." />
    <section className="panel v5-assistant">
      <div className="v5-assistant-head"><span className="assistant-orb">✦</span><div><strong>Assistente KRANO</strong><small>Executa ações com sua aprovação</small></div><span className="status-pill status-active">Disponível no Desktop</span></div>
      <div className="v5-chat">
        {!messages.length ? <div className="v5-chat-empty"><strong>Como posso ajudar?</strong><div>{suggestions.map((suggestion) => <button key={suggestion} onClick={() => setText(suggestion)}>{suggestion}</button>)}</div></div> :
          messages.map((message, index) => <div key={index} className={`v5-message ${message.role}`}>{message.text}</div>)}
      </div>
      <form className="v5-composer" onSubmit={send}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva o que você quer fazer…" rows={2} /><button className="button primary" aria-label="Enviar">Enviar</button></form>
    </section>
  </>;
}
