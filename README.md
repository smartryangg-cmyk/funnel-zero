# Funnel Zero

> **Teste ofertas, não ferramentas.**

Funnel Zero é uma plataforma open source e autohospedada para construir e analisar funis de vendas usando Cloudflare Workers, Workers Static Assets, D1 e R2. Cada instalação pertence à conta Cloudflare da própria pessoa.

Este repositório está no **Marco 1 — Fundação funcional**: instalação idempotente, infraestrutura gratuita, onboarding administrativo, autenticação, dashboard inicial, schema completo e deploy executável. Os construtores de funis e páginas entram nos marcos seguintes sobre essa base.

## Estado atual

- Worker TypeScript com React/Vite servido por Workers Static Assets;
- banco D1 com migrations versionadas;
- bucket R2 Standard privado;
- onboarding por URL temporária de uso único;
- senha PBKDF2-SHA-256 com salt exclusivo;
- sessão opaca em cookie `HttpOnly`, `Secure` e `SameSite=Strict`;
- rate limiting básico de login;
- dashboard responsivo em português;
- modo `FREE_ONLY=true`;
- limpeza agendada de sessões, tentativas e métricas antigas;
- instalador local idempotente;
- backup, restauração e desinstalação segura;
- testes unitários e Playwright;
- licença MIT.

## Instalação

Pré-requisitos:

- Node.js 20 ou superior;
- conta Cloudflare;
- autenticação local do Wrangler (`npx wrangler login`);
- plano gratuito é suficiente para o Marco 1.

```bash
git clone <repositorio>
cd funnel-zero
npm install
npm run setup
```

O instalador:

1. verifica Node, Wrangler e autenticação;
2. seleciona a conta quando necessário;
3. cria ou reutiliza recursos com prefixo `funnel-zero`;
4. cria D1 e R2 Standard;
5. atualiza bindings;
6. aplica migrations;
7. executa tipos, testes, build e `wrangler deploy --dry-run`;
8. publica o Worker;
9. grava `SESSION_SECRET` como secret remoto;
10. gera uma URL administrativa de uso único;
11. salva apenas dados não secretos em `.funnel-zero/installation.json`.

Executar o instalador novamente reutiliza os recursos do mesmo nome. Ele não exclui nem altera recursos sem o prefixo e o manifesto da instalação.

### Futuro `npx funnel-zero`

O pacote CLI está em `packages/cli` e já pode ser testado localmente:

```bash
node packages/cli/bin/funnel-zero.mjs setup
```

O pacote **não foi publicado no npm**.

## Desenvolvimento

```powershell
npm.cmd install
npm.cmd run cf:types
npm.cmd run db:migrate:local
npm.cmd run build
npm.cmd run dev:worker
```

O Worker local fica em `http://localhost:8787`. Para trabalhar somente na interface com proxy para o Worker:

```powershell
npm.cmd run dev
```

## Comandos

| Comando | Função |
|---|---|
| `npm run setup` | instala ou repara a infraestrutura |
| `npm run typecheck` | verifica TypeScript |
| `npm run lint` | executa regras de qualidade e promises |
| `npm test` | executa Vitest |
| `npm run test:e2e` | executa Playwright |
| `npm run build` | compila a aplicação |
| `npm run deploy:dry` | valida o deploy sem publicar |
| `npm run deploy:dev` | publica o Worker |
| `npm run backup` | exporta D1 e manifesto local |
| `npm run restore -- <pasta>` | restaura um backup com confirmação |
| `npm run uninstall` | remove somente recursos confirmados no manifesto |

## Arquitetura

```text
Navegador
  ├─ Workers Static Assets → React/Vite
  └─ /api/* → Worker TypeScript
       ├─ D1 → usuários, sessões, funis, páginas e métricas
       ├─ R2 → biblioteca de mídia privada
       └─ Cron → retenção e limpeza
```

```text
apps/
  web/                  interface React
  worker/               API e autenticação
packages/
  cli/                  instalador local
  shared/               schemas compartilhados
  editor/               reservado ao Marco 2
  player/               reservado ao Marco 3
migrations/             schema D1
scripts/                operação e recuperação
templates/              recursos futuros do editor
tests/                  unitários e Playwright
```

Workers Static Assets usa `run_worker_first` apenas para `/api/*` e rotas privadas. Isso reduz invocações dinâmicas e mantém o frontend econômico.

## Modelo de segurança

- nenhum segredo fica no Git;
- o secret de sessão é enviado ao Wrangler por entrada padrão;
- tokens de configuração e sessão são armazenados apenas como hash/HMAC;
- o token inicial expira em duas horas e é invalidado no primeiro uso;
- mutações exigem mesma origem;
- cookies administrativos não ficam em `localStorage`;
- login é limitado por identidade pseudonimizada;
- queries usam statements preparados;
- respostas privadas usam `Cache-Control: no-store`;
- páginas privadas passam pelo Worker antes dos assets;
- CSP, `nosniff`, `frame-ancestors` e políticas de navegador são aplicados.

Consulte [SECURITY.md](./SECURITY.md) antes de operar publicamente.

## FREE_ONLY

`FREE_ONLY=true` é o padrão. A aplicação:

- usa R2 Standard;
- não habilita Stream, Workers Paid ou serviços de IA;
- monitora o armazenamento conhecido;
- configura alertas internos em 70%, 85% e 95%;
- limita arquivos a 500 MB no Marco 1;
- mantém uma política inicial de 90 dias para eventos;
- não promete hard cap de cobrança da Cloudflare.

Limites mudam. Consulte sempre as páginas oficiais:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)

Na consulta de julho de 2026, Workers Free informava 100 mil requisições dinâmicas/dia; D1 Free, 5 milhões de linhas lidas/dia, 100 mil escritas/dia e 5 GB; R2 oferecia franquia mensal própria. Verifique novamente antes de uso intenso.

## Backup e restauração

```bash
npm run backup
npm run restore -- "backups/AAAA-MM-DD..."
```

O backup local inclui exportação SQL do D1, migrations, manifesto e configuração não secreta. Segredos nunca são incluídos. Os objetos do R2 devem ser copiados com ferramenta compatível com a API S3 do R2; as credenciais devem ser configuradas fora do repositório.

## Desinstalação

```bash
npm run uninstall
```

O comando mostra os nomes exatos, recomenda backup, exige confirmação textual e permite preservar D1 e R2. Sem `.funnel-zero/installation.json`, ele se recusa a remover qualquer coisa.

## Roadmap

- **Marco 1:** fundação, login, onboarding e dashboard — implementado;
- **Marco 2:** oferta, mapa horizontal, editor em blocos e publicação;
- **Marco 3:** upload multipart, player VSL e retenção;
- **Marco 4:** A/B, domínios, pixels, webhooks e operação completa;
- **Marco 5:** auditoria final, CI expandida e releases.

## Limitações conhecidas do Marco 1

- o construtor visual ainda não está habilitado;
- o R2 está pronto e monitorado, mas o upload multipart entra no Marco 3;
- backup automático dos objetos R2 exige ferramenta S3 externa;
- domínios personalizados não são modificados pelo instalador;
- não há processamento de pagamento.

## Licença

[MIT](./LICENSE)
