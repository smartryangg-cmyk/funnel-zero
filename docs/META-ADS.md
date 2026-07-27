# Meta Ads na KRANO

A integração conecta o painel à Meta por OAuth e Marketing API. Ela não solicita
nem armazena a senha do Facebook.

## Configuração única

1. Crie ou selecione um aplicativo em Meta for Developers.
2. Adicione o produto de login do Facebook e habilite a Marketing API.
3. Abra **Meta Ads** na KRANO e copie a URL exibida em
   **URL de redirecionamento OAuth válida**.
4. Cadastre essa URL exatamente como aparece nas configurações OAuth do aplicativo.
5. Grave as credenciais como secrets do Worker:

```powershell
npx.cmd wrangler secret put META_APP_ID
npx.cmd wrangler secret put META_APP_SECRET
```

6. Publique novamente o Worker e clique em **Conectar Facebook**.

Nunca coloque o segredo do aplicativo no `wrangler.jsonc`, no GitHub ou no
frontend. A KRANO usa `SESSION_SECRET` para criptografar o token do usuário antes
de gravá-lo no D1.

## Permissões

- `ads_read`: contas, campanhas e insights;
- `ads_management`: alterações operacionais que forem habilitadas no painel;
- `business_management`: ativos ligados ao negócio;
- `public_profile`: nome e identificador do perfil conectado.

Durante desenvolvimento, somente perfis com função no aplicativo costumam ter
acesso. Para usuários externos, a Meta pode exigir modo Live, verificação da
empresa e análise das permissões.

## Segurança operacional

A tela consulta campanhas e métricas e permite pausar ou reativar uma campanha.
Essas alterações mostram o objeto afetado, exigem confirmação explícita, validam
que a campanha pertence à conta selecionada e registram a ação no log de auditoria.
Controles futuros de orçamento ou publicação devem manter o mesmo contrato.
