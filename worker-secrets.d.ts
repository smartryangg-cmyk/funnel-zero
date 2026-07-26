/**
 * Contrato estável do Worker. O `wrangler types` continua validando a configuração,
 * mas a saída gerada não entra no build porque versões recentes do Wrangler
 * importam o módulo principal dentro do próprio arquivo de tipos.
 */
declare global {
  interface Env {
    MEDIA: R2Bucket;
    DB: D1Database;
    ASSETS: Fetcher;
    APP_NAME: string;
    WORKER_NAME: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    ENVIRONMENT: string;
    FREE_ONLY: string;
    MAX_STORAGE_BYTES: string;
    MAX_FILE_BYTES: string;
    META_GRAPH_VERSION: string;
    SESSION_DAYS: string;
    SESSION_SECRET: string;
    CLOUDFLARE_API_TOKEN?: string;
    CLOUDFLARE_OAUTH_CLIENT_ID?: string;
    CLOUDFLARE_OAUTH_ACCESS_TOKEN?: string;
    CLOUDFLARE_OAUTH_REFRESH_TOKEN?: string;
  }
}

export {};
