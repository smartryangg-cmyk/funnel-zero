import type { PageBlock, PageDocument } from "../../../packages/shared/src/schemas";
import { randomId, randomToken } from "./crypto";
import { escapeHtml, safeColor, safeJson } from "./platform";

interface PublicPageRow {
  page_id: string;
  page_name: string;
  page_slug: string;
  page_type: string;
  funnel_id: string | null;
  offer_id: string;
  offer_name: string;
  offer_slug: string;
  checkout_url: string | null;
  pixel_config_json: string;
  content_json: string;
}

interface VariantRow {
  experiment_id: string;
  id: string;
  name: string;
  weight: number;
  content_json: string | null;
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=") || null;
  }
  return null;
}

function hashNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeUrl(value: unknown, fallback = "#"): string {
  if (typeof value !== "string" || !value) return fallback;
  if (value.startsWith("#") || value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function safeAssetUrl(value: unknown): string {
  const path = safeUrl(value, "");
  return path.startsWith("/media/") ? path : "";
}

function contentRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeFormatting(value: unknown): string {
  let html = escapeHtml(typeof value === "string" ? value : "");
  const tags = ["strong", "b", "em", "i", "u", "br", "p", "ul", "ol", "li", "blockquote"];
  for (const tag of tags) {
    const open = new RegExp(`&lt;${tag}&gt;`, "gi");
    const close = new RegExp(`&lt;\\/${tag}&gt;`, "gi");
    html = html.replace(open, `<${tag}>`).replace(close, `</${tag}>`);
  }
  return html;
}

function renderBlock(
  block: PageBlock,
  page: PublicPageRow,
  pitchAtSeconds: number
): string {
  const content = contentRecord(block.content);
  switch (block.type) {
    case "heading":
      return `<h1 class="fz-heading">${escapeHtml(block.content)}</h1>`;
    case "paragraph":
      return `<div class="fz-copy">${safeFormatting(block.content)}</div>`;
    case "image": {
      const assetId = typeof content.assetId === "string" ? content.assetId : "";
      const src = safeAssetUrl(content.src ?? (assetId ? `/media/${assetId}` : ""));
      if (!src) return "";
      return `<figure class="fz-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(content.alt)}" loading="lazy"></figure>`;
    }
    case "video": {
      const assetId = typeof content.assetId === "string" ? content.assetId : "";
      const src = safeAssetUrl(content.src ?? (assetId ? `/media/${assetId}` : ""));
      if (!src) {
        return `<div class="fz-video-placeholder"><strong>VSL ainda não conectada</strong><span>Escolha um vídeo na biblioteca do Funnel Zero.</span></div>`;
      }
      const poster = safeAssetUrl(content.poster);
      const pitch = Math.max(0, Number(content.ctaAtSeconds ?? pitchAtSeconds) || 0);
      return `<section class="fz-player" data-fz-player data-pitch="${pitch}">
        <video preload="metadata" playsinline ${poster ? `poster="${escapeHtml(poster)}"` : ""}>
          <source src="${escapeHtml(src)}" type="video/mp4">
        </video>
        <button class="fz-big-play" type="button" aria-label="Reproduzir vídeo">▶</button>
        <div class="fz-controls">
          <button type="button" data-action="toggle" aria-label="Reproduzir ou pausar">▶</button>
          <input type="range" data-action="seek" min="0" max="1000" value="0" aria-label="Progresso">
          <span data-time>0:00 / 0:00</span>
          <input type="range" data-action="volume" min="0" max="1" step="0.05" value="1" aria-label="Volume">
        </div>
      </section>`;
    }
    case "button": {
      const configured = safeUrl(content.href, "#");
      const href =
        configured === "#checkout" && page.checkout_url ? safeUrl(page.checkout_url) : configured;
      const delayed = content.revealAfterPitch === true ? " fz-delayed-cta" : "";
      return `<div class="fz-cta-wrap${delayed}"><a class="fz-cta" data-checkout="${href !== "#" ? "true" : "false"}" href="${escapeHtml(href)}">${escapeHtml(content.label ?? "Continuar")}</a></div>`;
    }
    case "spacer":
      return `<div class="fz-spacer" aria-hidden="true"></div>`;
    case "divider":
      return `<hr class="fz-divider">`;
    case "leadForm":
      return `<form class="fz-lead-form" data-lead-form>
        <label>Nome<input name="name" autocomplete="name" maxlength="120"></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
        <label class="fz-consent"><input name="consent" type="checkbox" required> Aceito receber o conteúdo solicitado.</label>
        <button class="fz-cta" type="submit">${escapeHtml(content.label ?? "Quero receber")}</button>
        <output aria-live="polite"></output>
      </form>`;
    case "quiz": {
      const questions = Array.isArray(content.questions) ? content.questions.slice(0, 10) : [];
      if (!questions.length) return `<div class="fz-quiz"><strong>Quiz demonstrativo</strong><p>Adicione perguntas no editor.</p></div>`;
      return `<div class="fz-quiz" data-quiz>${questions
        .map((question, index) => {
          const item = contentRecord(question);
          const options = Array.isArray(item.options) ? item.options.slice(0, 8) : [];
          return `<section ${index ? "hidden" : ""} data-question="${index}">
            <strong>${escapeHtml(item.title ?? `Pergunta ${index + 1}`)}</strong>
            ${options.map((option) => `<button type="button">${escapeHtml(option)}</button>`).join("")}
          </section>`;
        })
        .join("")}<output></output></div>`;
    }
    case "html":
      return `<div class="fz-custom-html">${safeFormatting(block.content)}</div>`;
    default:
      return "";
  }
}

function analyticsBootstrap(pixels: Record<string, unknown>, nonce: string): string {
  const metaPixelId =
    typeof pixels.metaPixelId === "string" && /^\d{6,20}$/.test(pixels.metaPixelId)
      ? pixels.metaPixelId
      : null;
  const ga4Id =
    typeof pixels.ga4Id === "string" && /^G-[A-Z0-9]{6,15}$/.test(pixels.ga4Id)
      ? pixels.ga4Id
      : null;
  const blocks: string[] = [];
  if (metaPixelId) {
    blocks.push(`<script nonce="${nonce}">!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');</script>`);
  }
  if (ga4Id) {
    blocks.push(`<script nonce="${nonce}" async src="https://www.googletagmanager.com/gtag/js?id=${ga4Id}"></script>
<script nonce="${nonce}">window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:true});</script>`);
  }
  return blocks.join("\n");
}

function trackingScript(meta: Record<string, unknown>, nonce: string): string {
  const serialized = JSON.stringify(meta).replaceAll("<", "\\u003c");
  return `<script nonce="${nonce}">
(() => {
  const meta = ${serialized};
  const aid = meta.anonymousId;
  const queue = [];
  const sent = new Set();
  const utm = Object.fromEntries([...new URLSearchParams(location.search)]
    .filter(([key]) => key.startsWith('utm_')).slice(0, 10));
  const emit = (type, properties = {}, once = '') => {
    const key = once || type + ':' + JSON.stringify(properties);
    if (once && sent.has(key)) return;
    if (once) sent.add(key);
    queue.push({
      id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(),
      anonymousId: aid, offerId: meta.offerId, funnelId: meta.funnelId,
      pageId: meta.pageId, variantId: meta.variantId, source: utm.utm_source || null,
      campaign: utm.utm_campaign || null, utm, properties
    });
    if (queue.length >= 10) flush();
  };
  const flush = () => {
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue.splice(0, 30) });
    if (!navigator.sendBeacon('/api/public/events', new Blob([body], {type:'application/json'}))) {
      fetch('/api/public/events', {method:'POST', headers:{'Content-Type':'application/json'},
        body, keepalive:true, credentials:'same-origin'}).catch(() => {});
    }
  };
  emit('page_view', {path: location.pathname}, 'page_view');
  setInterval(flush, 5000);
  addEventListener('pagehide', flush);

  document.querySelectorAll('[data-fz-player]').forEach((root) => {
    const video = root.querySelector('video');
    const big = root.querySelector('.fz-big-play');
    const toggle = root.querySelector('[data-action="toggle"]');
    const seek = root.querySelector('[data-action="seek"]');
    const volume = root.querySelector('[data-action="volume"]');
    const time = root.querySelector('[data-time]');
    const pitch = Number(root.dataset.pitch || 0);
    let lastProgressBucket = 0;
    const format = (seconds) => Number.isFinite(seconds) ? Math.floor(seconds / 60) + ':' +
      String(Math.floor(seconds % 60)).padStart(2, '0') : '0:00';
    const playToggle = () => video.paused ? video.play() : video.pause();
    big.addEventListener('click', playToggle);
    toggle.addEventListener('click', playToggle);
    volume.addEventListener('input', () => { video.volume = Number(volume.value); });
    seek.addEventListener('input', () => {
      if (video.duration) video.currentTime = Number(seek.value) / 1000 * video.duration;
    });
    video.addEventListener('play', () => {
      big.hidden = true; toggle.textContent = 'Ⅱ'; emit('vsl_start', {}, 'vsl_start');
    });
    video.addEventListener('pause', () => {
      toggle.textContent = '▶'; if (!video.ended) emit('vsl_pause', {second:Math.round(video.currentTime)});
    });
    video.addEventListener('timeupdate', () => {
      const ratio = video.duration ? video.currentTime / video.duration : 0;
      seek.value = String(Math.round(ratio * 1000));
      time.textContent = format(video.currentTime) + ' / ' + format(video.duration);
      if (ratio >= .25) emit('vsl_25', {}, 'vsl_25');
      if (ratio >= .50) emit('vsl_50', {}, 'vsl_50');
      if (ratio >= .75) emit('vsl_75', {}, 'vsl_75');
      const bucket = Math.floor(ratio * 10) * 10;
      if (bucket > lastProgressBucket && bucket < 100) {
        lastProgressBucket = bucket;
        emit('vsl_progress', {percent:bucket, second:Math.round(video.currentTime)}, 'vsl_progress:' + bucket);
      }
      if (pitch > 0 && video.currentTime >= pitch) {
        emit('vsl_pitch', {second:pitch}, 'vsl_pitch');
        document.querySelectorAll('.fz-delayed-cta').forEach((item) => item.classList.add('visible'));
      }
    });
    video.addEventListener('ended', () => emit('vsl_complete', {}, 'vsl_complete'));
  });

  document.querySelectorAll('[data-checkout="true"]').forEach((link) => {
    link.addEventListener('click', () => {
      emit('checkout_click', {href:link.href}, 'checkout_click:' + link.href);
      flush();
      try {
        const target = new URL(link.href);
        target.searchParams.set('fz_aid', aid);
        Object.entries(utm).forEach(([key, value]) => target.searchParams.set(key, value));
        link.href = target.toString();
      } catch {}
    });
  });

  document.querySelectorAll('[data-lead-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const output = form.querySelector('output');
      const response = await fetch('/api/public/leads', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:data.get('name'), email:data.get('email'),
          consent:data.get('consent') === 'on', anonymousId:aid, offerId:meta.offerId,
          funnelId:meta.funnelId, pageId:meta.pageId})
      });
      output.textContent = response.ok ? 'Recebido. Obrigado!' : 'Não foi possível enviar.';
      if (response.ok) { emit('lead_submit', {}, 'lead_submit'); form.reset(); }
    });
  });

  document.querySelectorAll('[data-quiz]').forEach((quiz) => {
    const questions = [...quiz.querySelectorAll('[data-question]')];
    questions.forEach((section, index) => section.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        section.hidden = true;
        if (questions[index + 1]) questions[index + 1].hidden = false;
        else quiz.querySelector('output').textContent = 'Respostas registradas. Continue para a próxima etapa.';
      });
    }));
  });
})();
</script>`;
}

async function readPublicPage(
  env: Env,
  offerSlug: string,
  pageSlug: string | null
): Promise<PublicPageRow | null> {
  const select = `SELECT p.id AS page_id, p.name AS page_name, p.slug AS page_slug,
    p.page_type, p.funnel_id, o.id AS offer_id, o.name AS offer_name, o.slug AS offer_slug,
    o.checkout_url, o.pixel_config_json, v.content_json
    FROM pages p
    JOIN offers o ON o.id = p.offer_id
    JOIN page_versions v ON v.id = p.published_version_id
    LEFT JOIN funnels f ON f.id = p.funnel_id
    WHERE o.slug = ? AND o.status = 'active' AND p.status = 'published'
      AND (f.id IS NULL OR f.status = 'published')`;
  if (pageSlug) {
    return env.DB.prepare(`${select} AND p.slug = ? LIMIT 1`).bind(offerSlug, pageSlug).first<PublicPageRow>();
  }
  return env.DB.prepare(
    `${select} ORDER BY CASE p.page_type WHEN 'vsl' THEN 0 WHEN 'sales' THEN 1 ELSE 2 END, p.created_at LIMIT 1`
  ).bind(offerSlug).first<PublicPageRow>();
}

async function chooseVariant(
  env: Env,
  page: PublicPageRow,
  anonymousId: string,
  request: Request
): Promise<{ id: string | null; content: PageDocument; cookie: string | null }> {
  const base = safeJson<PageDocument>(page.content_json, {
    version: 1,
    theme: { background: "#070b16", text: "#f5f7fb", accent: "#8b5cf6" },
    blocks: []
  });
  if (!page.funnel_id) return { id: null, content: base, cookie: null };
  const rows = await env.DB.prepare(
    `SELECT e.id AS experiment_id, v.id, v.name, v.weight, pv.content_json
     FROM experiments e JOIN experiment_variants v ON v.experiment_id = e.id
     LEFT JOIN page_versions pv ON pv.id = v.page_version_id
     WHERE e.funnel_id = ? AND e.status = 'running' AND v.status = 'active'
     ORDER BY v.created_at`
  ).bind(page.funnel_id).all<VariantRow>();
  if (!rows.results.length) return { id: null, content: base, cookie: null };
  const experimentId = rows.results[0].experiment_id;
  const cookieName = `fz_exp_${experimentId.slice(0, 12)}`;
  const existing = cookieValue(request, cookieName);
  const existingVariant = rows.results.find((row) => row.id === existing);
  if (existingVariant) {
    return {
      id: existingVariant.id,
      content: safeJson<PageDocument>(existingVariant.content_json, base),
      cookie: null
    };
  }
  const total = rows.results.reduce((sum, row) => sum + Math.max(0, row.weight), 0) || 1;
  let point = hashNumber(`${anonymousId}:${experimentId}`) % total;
  let selected = rows.results[0];
  for (const row of rows.results) {
    point -= Math.max(0, row.weight);
    if (point < 0) {
      selected = row;
      break;
    }
  }
  return {
    id: selected.id,
    content: safeJson<PageDocument>(selected.content_json, base),
    cookie: `${cookieName}=${selected.id}; Path=/; Secure; SameSite=Lax; Max-Age=2592000`
  };
}

export async function servePublicPage(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);
  const offerSlug = decodeURIComponent(parts[1] ?? "");
  const pageSlug = parts[2] ? decodeURIComponent(parts[2]) : null;
  const page = await readPublicPage(env, offerSlug, pageSlug);
  if (!page) {
    return new Response(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title>
       <body><main><h1>Página não encontrada</h1><p>Revise o endereço publicado.</p></main></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  const existingAid = cookieValue(request, "fz_aid");
  const anonymousId =
    existingAid && /^[a-zA-Z0-9_-]{8,100}$/.test(existingAid) ? existingAid : randomId();
  const variant = await chooseVariant(env, page, anonymousId, request);
  const content = variant.content;
  const theme = content.theme ?? {};
  const background = safeColor(theme.background, "#070b16");
  const text = safeColor(theme.text, "#f5f7fb");
  const accent = safeColor(theme.accent, "#8b5cf6");
  const pitchAtSeconds = Math.max(0, Number(content.settings?.pitchAtSeconds ?? 0) || 0);
  const nonce = randomToken(18);
  const pixels = safeJson<Record<string, unknown>>(page.pixel_config_json, {});
  const title = content.settings?.title ?? page.page_name;
  const description =
    content.settings?.description ?? `${page.offer_name} — página publicada no Funnel Zero.`;
  const blocks = content.blocks.map((block) => renderBlock(block, page, pitchAtSeconds)).join("\n");
  const meta = {
    anonymousId,
    offerId: page.offer_id,
    funnelId: page.funnel_id,
    pageId: page.page_id,
    variantId: variant.id
  };
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <style nonce="${nonce}">
    :root{--bg:${background};--text:${text};--accent:${accent};color-scheme:dark}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 42%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.6}
    .fz-page{width:min(920px,calc(100% - 32px));margin:auto;padding:72px 0 96px}.fz-page>*{margin:0 auto 28px}
    .fz-heading{font-size:clamp(2rem,6vw,4.5rem);line-height:1.02;text-align:center;letter-spacing:-.045em;max-width:880px}
    .fz-copy{font-size:clamp(1rem,2.2vw,1.25rem);max-width:720px;text-align:center;color:color-mix(in srgb,var(--text) 78%,transparent)}
    .fz-copy p{margin:0 0 1em}.fz-image img{display:block;max-width:100%;border-radius:20px;margin:auto}
    .fz-player,.fz-video-placeholder{position:relative;max-width:860px;aspect-ratio:16/9;border-radius:22px;overflow:hidden;background:#02040a;border:1px solid color-mix(in srgb,var(--text) 16%,transparent);box-shadow:0 30px 80px #0008}
    .fz-player video{width:100%;height:100%;display:block}.fz-big-play{position:absolute;inset:50% auto auto 50%;translate:-50% -50%;width:78px;height:78px;border:0;border-radius:50%;background:var(--accent);color:white;font-size:28px;cursor:pointer}
    .fz-controls{position:absolute;inset:auto 0 0;display:flex;gap:12px;align-items:center;padding:14px;background:linear-gradient(transparent,#000d)}
    .fz-controls button{border:0;background:transparent;color:white;font-size:20px}.fz-controls input[data-action=seek]{flex:1}.fz-controls input[data-action=volume]{width:80px}.fz-controls span{font-size:12px;white-space:nowrap}
    .fz-video-placeholder{display:grid;place-content:center;text-align:center;color:#94a3b8}.fz-video-placeholder strong{color:white;font-size:24px}.fz-video-placeholder span{display:block}
    .fz-cta-wrap{text-align:center}.fz-cta{display:inline-flex;justify-content:center;align-items:center;border:0;border-radius:14px;padding:17px 28px;background:var(--accent);color:white;text-decoration:none;font-weight:800;font-size:18px;cursor:pointer;box-shadow:0 16px 44px color-mix(in srgb,var(--accent) 35%,transparent)}
    .fz-delayed-cta{display:none}.fz-delayed-cta.visible{display:block}.fz-spacer{height:44px}.fz-divider{border:0;border-top:1px solid color-mix(in srgb,var(--text) 18%,transparent);max-width:720px}
    .fz-lead-form,.fz-quiz{max-width:580px;padding:28px;border:1px solid color-mix(in srgb,var(--text) 16%,transparent);border-radius:20px;background:color-mix(in srgb,var(--text) 5%,transparent)}
    .fz-lead-form label{display:grid;gap:7px;margin:0 0 14px}.fz-lead-form input{padding:13px;border-radius:10px;border:1px solid #ffffff2b;background:#0004;color:var(--text)}.fz-consent{display:flex!important;grid-template-columns:auto 1fr!important}.fz-lead-form output{display:block;margin-top:12px}
    .fz-quiz section{display:grid;gap:10px}.fz-quiz button{padding:13px;border:1px solid #ffffff25;border-radius:12px;background:#ffffff0a;color:var(--text);cursor:pointer}.fz-quiz output{display:block}
    [hidden]{display:none!important}.fz-custom-html{max-width:720px;margin-inline:auto}
    @media(max-width:640px){.fz-page{padding-top:48px}.fz-controls input[data-action=volume],.fz-controls span{display:none}.fz-player{border-radius:14px}}
  </style>
  ${analyticsBootstrap(pixels, nonce)}
</head>
<body>
  <main class="fz-page">${blocks}</main>
  ${trackingScript(meta, nonce)}
</body>
</html>`;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://connect.facebook.net https://www.googletagmanager.com; style-src 'self' 'nonce-${nonce}'; img-src 'self' data: https://www.facebook.com; media-src 'self'; connect-src 'self' https://www.facebook.com https://www.google-analytics.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self' https:`
  });
  if (!existingAid) {
    headers.append("Set-Cookie", `fz_aid=${anonymousId}; Path=/; Secure; SameSite=Lax; Max-Age=31536000`);
  }
  if (variant.cookie) headers.append("Set-Cookie", variant.cookie);
  return new Response(html, { headers });
}
