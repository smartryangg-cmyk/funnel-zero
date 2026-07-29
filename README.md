# KRANO

> **Teste ofertas, não ferramentas.**

KRANO é uma plataforma open source e autohospedada para construir e analisar funis de vendas usando Cloudflare Workers, Workers Static Assets, D1 e R2. Cada instalação pertence à conta Cloudflare da própria pessoa.

Este repositório contém o **MVP operacional completo**: instalação idempotente, painel administrativo, ofertas, mapa visual de funil, editor/publicação de páginas, biblioteca R2, player VSL, tracking, A/B, integrações e operação segura.

## Estado atual

- Worker TypeScript com React/Vite servido por Workers Static Assets;
- banco D1 com migrations versionadas;
- bucket R2 Standard privado;
- onboarding por URL temporária de uso único;
- senha PBKDF2-SHA-256 com salt exclusivo;
- sessão opaca em cookie `HttpOnly`, `Secure` e `SameSite=Strict`;
- rate limiting básico de login;
- dashboard responsivo em português;
- ofertas e funis com mapa horizontal em React Flow;
- editor em blocos com drag-and-drop, autosave, undo/redo, preview e versões;
- páginas públicas em `/o/:oferta/:pagina`;
- upload multipart para R2, biblioteca e entrega HTTP Range;
- player próprio de VSL com play, pausa, quartis, retenção, pitch e CTA;
- tracking primário em lote, leads e conversões por webhook;
- testes A/B com atribuição persistente e aviso de amostra;
- Meta Pixel e GA4 por IDs validados;
- conexão oficial com perfil Meta, contas de anúncio, campanhas e insights;
- checkout externo com UTMs e identificador anônimo;
- conexão guiada à Cloudflare por OAuth oficial com PKCE ou autorização oficial pré-preenchida;
- publicação de domínios próprios com DNS e SSL automáticos;
- modo `FREE_ONLY=true`;
- limpeza agendada de sessões, tentativas e métricas antigas;
- instalador local idempotente;
- backup, restauração e desinstalação segura;
- testes unitários e Playwright;
- licença MIT.

## Instalação para leigos

Único pré-requisito: uma conta gratuita da Cloudflare. Não é necessário instalar
Git, Node.js, Wrangler ou Docker.

**Windows 64 bits**

1. Baixe a versão mais recente em [`KRANO-Installer-Windows-x64.exe`](https://github.com/smartryangg-cmyk/funnel-zero/releases/latest/download/KRANO-Installer-Windows-x64.exe).
2. Dê dois cliques para abrir o **KRANO Desktop**.
3. Crie um perfil e autorize a conta na página oficial da Cloudflare.
4. Clique em **Nova estrutura**. O app prepara Worker, D1 e R2 e abre o cadastro inicial.
5. No painel, abra **Meta Ads** e conecte o perfil que administra seus anúncios.

O KRANO Desktop permanece aberto como central local. Nas próximas execuções ele
lista todas as estruturas e oferece **abrir, atualizar, recuperar e remover**,
além de perfis OAuth separados para múltiplas contas Cloudflare.

O menu **Cofre local** permite salvar voluntariamente o login e a senha do painel.
No Windows, os dados são criptografados com DPAPI e só podem ser desbloqueados
pela mesma conta do Windows. Senhas da Cloudflare e da Meta continuam fora do app,
pois essas integrações usam autorização OAuth.

O arquivo correto tem aproximadamente **9,2 MB**. Se o download tiver apenas
alguns KB, ele é uma página HTML do GitHub e não deve ser executado. Os hashes
oficiais estão em [`installers/SHA256SUMS.txt`](./installers/SHA256SUMS.txt).

Cada atualização também fica preservada em [GitHub Releases](https://github.com/smartryangg-cmyk/funnel-zero/releases), com a versão no nome do app, por exemplo `KRANO-Desktop-v0.4.8-Windows-x64.exe`. Os arquivos sem versão no nome são apenas atalhos para a versão mais recente.

**Linux 64 bits**

1. Baixe a versão mais recente em [`krano-installer-linux-x64`](https://github.com/smartryangg-cmyk/funnel-zero/releases/latest/download/krano-installer-linux-x64).
2. Execute:

```bash
chmod +x krano-installer-linux-x64
./krano-installer-linux-x64
```

Os binários baixam o código deste repositório, preparam uma versão portátil do
Node.js quando necessário, verificam seu SHA-256 e iniciam o instalador guiado.
Como o projeto é open source e os binários ainda não usam certificado comercial
de assinatura, o Windows pode exibir o aviso padrão do SmartScreen.
Cada execução também grava um log local com tokens temporários removidos em
`KRANO/.funnel-zero/installer.log`. Releases versionadas publicam os dois
executáveis e `SHA256SUMS.txt` como assets verificáveis no GitHub.

Para desenvolvimento ou sistemas diferentes, os instaladores antigos continuam
disponíveis: `INSTALAR-KRANO.cmd`, `install.sh` e `node install.mjs`.

O instalador:

1. verifica Node e Wrangler;
2. abre a autorização oficial da Cloudflare e seleciona a conta quando necessário;
3. cria ou reutiliza recursos com prefixo `krano`;
4. cria D1 e R2 Standard;
5. atualiza bindings;
6. aplica migrations;
7. executa tipos, testes, build e `wrangler deploy --dry-run`;
8. publica o Worker;
9. grava `SESSION_SECRET` como secret remoto;
10. gera uma URL administrativa de uso único;
11. salva apenas dados não secretos em `.funnel-zero/installation.json`.

Se o proprietário perder a senha, execute dentro da pasta instalada:

```bash
node packages/cli/bin/funnel-zero.mjs recover
```

O comando confirma a conta Cloudflare, aplica as migrations pendentes e abre
`/reset-password?token=...`. O link fica apenas no terminal e em
`.funnel-zero/recovery-url.txt`, expira em 30 minutos e funciona uma única vez.
Nenhum serviço de e-mail ou token fictício é usado nesse modo de emergência.

Executar o instalador novamente reutiliza os recursos do mesmo nome. Ele não exclui nem altera recursos sem o prefixo e o manifesto da instalação.

### CLI local

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
installer/              fonte dos binários Windows e Linux
installers/             executáveis prontos
packages/
  cli/                  instalador local
  shared/               schemas compartilhados
migrations/             schema D1
scripts/                operação e recuperação
tests/                  unitários e Playwright
```

Workers Static Assets usa `run_worker_first` apenas para `/api/*` e rotas privadas. Isso reduz invocações dinâmicas e mantém o frontend econômico.

## Modelo de segurança

- nenhum segredo fica no Git;
- o secret de sessão é enviado ao Wrangler por entrada padrão;
- credenciais OAuth ou token guiado da Cloudflare ficam somente nos secrets do Worker;
- o fluxo de conexão usa Authorization Code com PKCE S256 e estado de uso único;
- tokens de configuração e sessão são armazenados apenas como hash/HMAC;
- o token inicial expira em duas horas e é invalidado no primeiro uso;
- mutações exigem mesma origem;
- cookies administrativos não ficam em `localStorage`;
- login é limitado por identidade pseudonimizada;
- falhas de login são limpas após autenticação válida e respostas de bloqueio
  informam o tempo de espera;
- recuperação local usa token aleatório armazenado somente como hash, invalida
  todas as sessões e mantém um único proprietário ativo;
- mutações respeitam os papéis proprietário, administrador, editor e analista;
- queries usam statements preparados;
- respostas privadas usam `Cache-Control: no-store`;
- páginas privadas passam pelo Worker antes dos assets;
- CSP, `nosniff`, `frame-ancestors` e políticas de navegador são aplicados.

Consulte [SECURITY.md](./SECURITY.md) antes de operar publicamente.

## Conexão com a Cloudflare e domínios

No painel, o administrador escolhe **Conectar KRANO à Cloudflare**. Quando um cliente OAuth público está configurado, a tela oficial da Cloudflare mostra o aplicativo, a conta e as permissões solicitadas. Em qualquer clone instalado pelo GitHub, o fluxo guiado abre a tela oficial de criação de token com conta e permissões já preenchidas; o usuário apenas cria, copia e cola o código uma vez.

Depois da autorização, a navegação fica deliberadamente separada:

- **Domínios** contém apenas os domínios-base e zonas DNS, como `seudominio.com`;
- **Subdomínios** contém os endereços publicados, como `oferta.seudominio.com`.

Em Subdomínios, o usuário escolhe um domínio-base ativo, digita somente o nome,
seleciona um funil realmente publicado e confirma. A API oficial da Cloudflare
cria o vínculo, configura o DNS e acompanha o SSL sem exigir Account ID, Zone ID
ou novo deploy.

## KRATUBE e dashboards

O KRATUBE organiza a hospedagem de vídeo em cinco áreas: biblioteca, editor do
player, analytics, testes A/B e segurança. O player oferece estilo, controles,
progresso real, autoplay sem som, retomada, headline, mini-gancho, CTA programado,
thumbnails A/B, domínios permitidos, marca d'água e métricas de retenção, pitch,
dispositivo, navegador e origem.

O Dashboard separa Resumo, Funil, UTMs, Eventos e Relatórios. A KRANO calcula os
dados a partir dos próprios eventos e deixa gastos/lucro como “Conectar” enquanto
não houver uma conta de anúncios integrada, evitando exibir ROAS fictício.

## Meta Ads

A área **Meta Ads** usa o fluxo OAuth oficial para conectar um perfil e consultar
contas de anúncio, campanhas e insights de investimento, impressões, alcance,
cliques, CTR, CPC, CPM e compras atribuídas. Tokens de usuário são criptografados
antes de serem armazenados no D1.

Por ser uma instalação open source independente, o proprietário configura seu
próprio aplicativo Meta com `META_APP_ID` e `META_APP_SECRET`. As permissões
`ads_read`, `ads_management` e `business_management` podem exigir verificação da
empresa e análise do aplicativo pela Meta. O passo a passo completo está em
[`docs/META-ADS.md`](./docs/META-ADS.md).

Credenciais nunca são gravadas no D1: ficam como secrets do próprio Worker da instalação. O token guiado recebe somente Account Settings Read, Workers Scripts Edit, Workers Routes Edit e Zone Edit, restritos à conta instalada. Consulte [docs/CLOUDFLARE-OAUTH.md](./docs/CLOUDFLARE-OAUTH.md).

## FREE_ONLY

`FREE_ONLY=true` é o padrão. A aplicação:

- usa R2 Standard;
- não habilita Stream, Workers Paid ou serviços de IA;
- monitora o armazenamento conhecido;
- configura alertas internos em 70%, 85% e 95%;
- limita arquivos a 500 MB;
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

## Oferta demonstrativa

A migration cria **Plano Próxima Série — Demonstração**, um funil publicado, duas páginas, duas variantes e checkout externo de teste. Todo o conteúdo é explicitamente fictício e não contém depoimentos, escassez ou promessa de resultado. Consulte [docs/DEMO-OFFER.md](./docs/DEMO-OFFER.md) e [docs/VSL-DEMO.md](./docs/VSL-DEMO.md).

## Limitações conhecidas

- backup automático dos objetos R2 exige ferramenta S3 externa;
- o domínio `workers.dev` funciona imediatamente; instalações sem cliente OAuth usam a autorização guiada por token oficial pré-preenchido;
- upload multipart depende dos limites de corpo e CPU do plano Cloudflare em uso;
- métricas e testes A/B são indicativos, não um motor estatístico de decisão;
- não há processamento de pagamento.

## Licença

[MIT](./LICENSE)
