# Conexão Cloudflare

A KRANO oferece duas conexões oficiais:

- OAuth com PKCE quando a distribuição possui um cliente público;
- autorização guiada universal para qualquer clone do GitHub, usando a página oficial de tokens com conta e permissões já preenchidas.

## Experiência do usuário

1. Acesse **Configurações → Domínios**.
2. Escolha **Conectar KRANO à Cloudflare**.
3. Na tela oficial da Cloudflare, aprove as permissões. Em uma instalação sem OAuth público, crie o token pré-configurado, copie e cole uma única vez.
4. De volta à KRANO, escolha um domínio ativo, informe o subdomínio e selecione o funil.
5. Escolha **Publicar neste endereço**.

DNS, vínculo com o Worker e SSL são configurados pela API da Cloudflare. Nenhum novo deploy é necessário.
Ao acessar a raiz do hostname publicado, o Worker entrega diretamente a primeira página publicada do funil. Os demais slugs publicados do mesmo funil também funcionam no formato `https://hostname/slug`.

## Permissões

O cliente solicita somente:

- `account-settings.read`: identificar a conta autorizada;
- `zone.read`: listar os domínios ativos e localizar a zona correta;
- `zone.write`: importar para a conta um domínio comprado em outro registrador;
- `workers-scripts.write`: associar ou remover domínios do Worker;
- `offline_access`: renovar a conexão sem pedir autorização em cada publicação.

## Armazenamento seguro

- access token e refresh token ficam nos secrets `CLOUDFLARE_OAUTH_ACCESS_TOKEN` e `CLOUDFLARE_OAUTH_REFRESH_TOKEN`;
- o D1 guarda apenas nome da conta, Worker, escopos, datas e estado da conexão;
- o verificador PKCE é criptografado durante o redirecionamento e excluído no callback;
- o callback valida o `state` de uso único diretamente no servidor, mantendo o cookie administrativo em `SameSite=Strict`;
- a interface nunca recebe tokens ou IDs internos da conta;
- **Desconectar** revoga os tokens e remove os dois secrets.

No modo guiado, o token fica exclusivamente no secret `CLOUDFLARE_API_TOKEN`. O D1 guarda apenas metadados não secretos. **Desconectar** remove esse secret da instalação; o token também pode ser revogado a qualquer momento em **Meu perfil → Tokens de API** na Cloudflare.

## Instalações vindas do GitHub

O instalador grava o ID não secreto da conta na variável `CLOUDFLARE_ACCOUNT_ID`. Com isso, a aplicação gera uma URL oficial de template restrita à conta da instalação, com:

- Account Settings Read;
- Workers Scripts Edit;
- Workers Routes Edit;
- Zone Edit.

Antes de aceitar o token, o Worker verifica se ele está ativo, se acessa a conta correta, se encontra o Worker desta instalação e se consegue listar zonas. Depois o próprio token é salvo como secret; ele nunca é devolvido à interface nem persistido no D1.

## Registro do cliente OAuth

OAuth é opcional para clones autohospedados. Distribuições que desejarem a experiência de consentimento sem copiar um token podem criar um cliente OAuth na Cloudflare com:

- Authorization Code;
- autenticação de cliente `none`;
- PKCE `S256`;
- URI de redirecionamento `https://SEU_HOST/api/cloudflare/oauth/callback`;
- URL do cliente no mesmo domínio verificado;
- todos os escopos listados acima, incluindo **Zone Write** para adicionar domínios novos à conta.

O Client ID deve ser salvo no secret `CLOUDFLARE_OAUTH_CLIENT_ID`. Para permitir que qualquer usuário Cloudflare autorize a aplicação, o cliente precisa ser público e o domínio do aplicativo deve ser verificado no painel da Cloudflare.

## Referências oficiais

- [Criar um cliente OAuth](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)
- [Integrar com a Cloudflare](https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/)
- [Tela de autorização](https://developers.cloudflare.com/fundamentals/oauth/authorizing-an-application/)
- [Custom Domains de Workers](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/)
- [Atualização em lote de secrets](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/)
- [URLs de template para tokens](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/)
