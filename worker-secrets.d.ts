/**
 * Secrets não fazem parte do wrangler.jsonc e, por isso, não são emitidos por
 * `wrangler types`. Esta declaração complementa apenas os secrets provisionados
 * pelo instalador; bindings e vars continuam sendo gerados pelo Wrangler.
 */
interface Env {
  SESSION_SECRET: string;
  CLOUDFLARE_API_TOKEN?: string;
}
