# Política de segurança

## Relato responsável

Não abra vulnerabilidades com detalhes exploráveis em issues públicas. Envie um relato privado ao mantenedor da sua distribuição com:

- versão do Funnel Zero;
- impacto;
- passos mínimos de reprodução;
- arquivos ou rotas afetados;
- sugestão de correção, se houver.

Não inclua senhas, cookies, tokens, dados pessoais ou dumps reais.

## Modelo de ameaça

O Marco 1 considera:

- tentativa de assumir a configuração inicial;
- brute force de login;
- roubo de sessão;
- CSRF e XSS;
- SQL injection;
- cache indevido de páginas privadas;
- exposição de secrets;
- exclusão acidental de recursos;
- abuso de armazenamento;
- vazamento de dados em logs.

## Controles implementados

- token inicial aleatório, armazenado como SHA-256, expiração curta e uso único;
- PBKDF2-SHA-256 com salt único e iterações registradas por usuário;
- cookie `__Host-` com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`;
- tokens de sessão armazenados como HMAC;
- checagem de `Origin` em mutações;
- statements D1 preparados;
- limite de payload JSON;
- rate limit de login em D1;
- CSP e cabeçalhos defensivos;
- `Cache-Control: no-store` nas APIs;
- secrets somente via Wrangler;
- operações de remoção restritas ao manifesto local;
- logs estruturados sem corpo de requisição.

## Revisões obrigatórias antes dos próximos marcos

Upload, HTML personalizado, webhooks e gestão de domínios ampliam a superfície de ataque. Antes de habilitá-los:

- validar assinatura de arquivo e caminhos R2;
- sanitizar HTML com allowlist;
- separar scripts autorizados do conteúdo;
- proteger multipart contra abuso e concorrência;
- usar HMAC, nonce e janela temporal em webhooks;
- impedir SSRF;
- testar permissões mínimas da API Cloudflare;
- garantir que variantes não vazem pelo cache.

## Atualizações

Atualize dependências de forma controlada, execute todos os testes e faça `wrangler deploy --dry-run` antes de publicar. Não use `npm audit fix --force` sem revisar mudanças incompatíveis.
