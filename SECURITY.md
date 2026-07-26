# Política de segurança

## Relato responsável

Não abra vulnerabilidades com detalhes exploráveis em issues públicas. Envie um relato privado ao mantenedor da sua distribuição com:

- versão da KRANO;
- impacto;
- passos mínimos de reprodução;
- arquivos ou rotas afetados;
- sugestão de correção, se houver.

Não inclua senhas, cookies, tokens, dados pessoais ou dumps reais.

## Modelo de ameaça

O MVP considera:

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
- secrets somente via Wrangler ou pela API oficial de atualização de secrets do próprio Worker;
- operações de remoção restritas ao manifesto local;
- logs estruturados sem corpo de requisição.

## Controles das funções avançadas

- mídia aceita allowlist de MIME, tamanho máximo, chaves geradas e hotlink de outra origem bloqueado;
- multipart usa upload IDs privados, partes numeradas e limpeza de uploads abandonados;
- HTML personalizado passa por allowlist restritiva e não executa scripts;
- páginas públicas recebem CSP com nonce e não são armazenadas em cache durante atribuição A/B;
- webhooks usam secret mostrado uma vez, hash SHA-256, comparação constante e chave de replay;
- checkout aceita apenas HTTP/HTTPS e nunca é buscado pelo Worker;
- a conexão Cloudflare usa OAuth Authorization Code com PKCE S256, state aleatório, expiração curta e uso único;
- o verificador PKCE permanece criptografado no D1 apenas enquanto a autorização está em andamento e é removido ao concluir;
- o callback OAuth é a única etapa pública do fluxo e só prossegue com `state` aleatório, íntegro, não utilizado e não expirado;
- access token e refresh token da Cloudflare ficam exclusivamente em secrets do Worker, nunca no D1 ou no navegador;
- a publicação de domínios usa a API oficial e descobre conta e zona automaticamente com permissões mínimas;
- a desconexão revoga os tokens na Cloudflare, apaga os secrets do Worker e preserva apenas metadados de auditoria;
- logs não armazenam payloads, tokens, IP completo ou senha.

## Atualizações

Atualize dependências de forma controlada, execute todos os testes e faça `wrangler deploy --dry-run` antes de publicar. Não use `npm audit fix --force` sem revisar mudanças incompatíveis.
