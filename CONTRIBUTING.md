# Contribuindo

Obrigado por contribuir com o Funnel Zero.

## Fluxo

1. abra uma issue descrevendo o problema ou proposta;
2. crie uma branch pequena e focada;
3. não misture refatoração ampla com correção funcional;
4. adicione ou atualize testes;
5. execute:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run deploy:dry
```

6. descreva riscos de segurança, migração e compatibilidade.

## Regras

- não inclua IDs de conta, secrets, tokens ou URLs privadas;
- mantenha `FREE_ONLY=true` como padrão;
- não habilite produtos pagos automaticamente;
- use TypeScript estrito e statements preparados;
- trate conteúdo externo como não confiável;
- preserve compatibilidade com Node 20+ e Wrangler 4;
- mudanças em migrations devem ser aditivas sempre que possível;
- a interface padrão permanece em português brasileiro.

## Commits

Prefira commits pequenos, por exemplo:

```text
feat(auth): add one-time setup flow
fix(d1): reduce dashboard row reads
docs(backup): explain R2 object copy
```
