import type {
  PageBlock,
  PageDocument,
  PlayerConfig
} from "../../../packages/shared/src/schemas";
import { DEFAULT_PLAYER_CONFIG, normalizePlayerConfig } from "./assets";
import { randomId, randomToken } from "./crypto";
import { escapeHtml, safeColor, safeJson } from "./platform";
import { signPublicTrackingContext } from "./tracking";

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

interface PlayerProfileRow {
  id: string;
  player_config_json: string;
}

const DEMO_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

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
  return path.startsWith("/media/") || path === DEMO_VIDEO_URL ? path : "";
}

function contentRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function blockStyle(settings: Record<string, unknown>): { className: string; style: string } {
  const declarations: string[] = [];
  const align = typeof settings.align === "string" && ["left", "center", "right"].includes(settings.align)
    ? settings.align
    : null;
  if (align) declarations.push(`text-align:${align}`);
  declarations.push(`max-width:${clampNumber(settings.maxWidth, 240, 1200, 920)}px`);
  declarations.push(`margin-bottom:${clampNumber(settings.marginBottom, 0, 160, 28)}px`);
  const padding = clampNumber(settings.padding, 0, 120, 0);
  const radius = clampNumber(settings.radius, 0, 100, 0);
  if (padding) declarations.push(`padding:${padding}px`);
  if (radius) declarations.push(`border-radius:${radius}px`);
  const fontSize = clampNumber(settings.fontSize, 0, 120, 0);
  const fontWeight = clampNumber(settings.fontWeight, 0, 900, 0);
  if (fontSize) declarations.push(`font-size:${fontSize}px`);
  if (fontWeight) declarations.push(`font-weight:${fontWeight}`);
  if (typeof settings.textColor === "string" && settings.textColor) {
    declarations.push(`color:${safeColor(settings.textColor, "inherit")}`);
  }
  if (settings.transparentBackground === false) {
    declarations.push(`background:${safeColor(settings.background, "#000000")}`);
  }
  const shadows: Record<string, string> = {
    soft: "0 12px 35px #00000055",
    strong: "0 22px 65px #000000aa",
    glow: "0 0 45px color-mix(in srgb,var(--accent) 45%,transparent)"
  };
  if (typeof settings.shadow === "string" && shadows[settings.shadow]) {
    declarations.push(`box-shadow:${shadows[settings.shadow]}`);
  }
  const classes = [
    "fz-block",
    settings.hiddenMobile === true ? "fz-hide-mobile" : "",
    settings.hiddenDesktop === true ? "fz-hide-desktop" : ""
  ].filter(Boolean).join(" ");
  return { className: classes, style: declarations.join(";") };
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

function renderBlockContent(
  block: PageBlock,
  page: PublicPageRow,
  pitchAtSeconds: number,
  playerProfiles: Map<string, PlayerConfig>
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
        return `<div class="fz-video-placeholder"><strong>VSL ainda não conectada</strong><span>Escolha um vídeo na biblioteca da KRANO.</span></div>`;
      }
      const profile = playerProfiles.get(assetId) ?? DEFAULT_PLAYER_CONFIG;
      const poster = safeAssetUrl(
        content.poster ?? (profile.posterAssetId ? `/media/${profile.posterAssetId}` : "")
      );
      const pitch = Math.max(
        0,
        Number(content.ctaAtSeconds ?? profile.ctaAtSeconds ?? pitchAtSeconds) || 0
      );
      const qualitySources = profile.qualitySources
        .filter((item) => item.assetId !== assetId)
        .map((item) => ({ label: item.label, src: `/media/${item.assetId}` }));
      const playerData = escapeHtml(JSON.stringify({
        ...profile,
        qualitySources,
        assetId
      }));
      const controlsClass =
        profile.timelineStyle === "hidden"
          ? " timeline-hidden"
          : profile.timelineStyle === "minimal"
            ? " timeline-minimal"
            : "";
      const playerStyle = `--fz-player-accent:${profile.primaryColor};--fz-player-bg:${profile.backgroundColor};--fz-player-radius:${profile.borderRadius}px;--fz-progress-height:${profile.smartProgressHeight}px`;
      return `<section class="fz-player${controlsClass}" style="${escapeHtml(playerStyle)}" data-fz-player data-pitch="${pitch}" data-profile="${playerData}" data-asset-id="${escapeHtml(assetId)}">
        ${profile.headlineText ? `<strong class="fz-player-headline" data-timed="headline">${escapeHtml(profile.headlineText)}</strong>` : ""}
        <video preload="metadata" playsinline ${profile.loop ? "loop" : ""} ${profile.autoplayMuted ? "autoplay muted" : ""} ${profile.protectVideo ? `controlslist="nodownload noremoteplayback" disablepictureinpicture` : ""} ${poster ? `poster="${escapeHtml(poster)}"` : ""}>
          <source src="${escapeHtml(src)}" type="video/mp4">
        </video>
        <button class="fz-big-play" type="button" aria-label="Reproduzir vídeo"${profile.showBigPlay ? "" : " hidden"}>▶</button>
        ${profile.autoplayMuted ? `<button class="fz-autoplay-hint" type="button">${escapeHtml(profile.autoplayMessage)}</button>` : ""}
        ${profile.watermark ? `<span class="fz-watermark">${escapeHtml(profile.watermark)}</span>` : ""}
        ${profile.miniHookText ? `<span class="fz-mini-hook" data-timed="mini-hook">${escapeHtml(profile.miniHookText)}</span>` : ""}
        ${profile.smartProgress ? `<i class="fz-smart-progress"><b></b></i>` : ""}
        ${profile.resumePlayback ? `<div class="fz-resume-dialog" hidden><strong>${escapeHtml(profile.resumeMessage)}</strong><div><button type="button" data-action="resume">${escapeHtml(profile.resumeContinueLabel)}</button><button type="button" data-action="restart">${escapeHtml(profile.resumeRestartLabel)}</button></div></div>` : ""}
        ${profile.ctaUrl ? `<a class="fz-player-cta${profile.ctaPulse ? " pulse" : ""}" data-checkout="true" data-timed="cta" href="${escapeHtml(profile.ctaUrl)}"${profile.ctaNewTab ? ` target="_blank" rel="noopener noreferrer"` : ""}>${escapeHtml(profile.ctaText)}</a>` : ""}
        <div class="fz-controls"${profile.showControls ? "" : " hidden"}>
          <button type="button" data-action="toggle" aria-label="Reproduzir ou pausar">▶</button>
          ${profile.rewindSeconds ? `<button type="button" data-action="rewind" aria-label="Voltar ${profile.rewindSeconds} segundos">−${profile.rewindSeconds}</button>` : ""}
          <input type="range" data-action="seek" min="0" max="1000" value="0" aria-label="Progresso"${profile.allowSeek ? "" : " disabled"}>
          ${profile.forwardSeconds ? `<button type="button" data-action="forward" aria-label="Avançar ${profile.forwardSeconds} segundos">+${profile.forwardSeconds}</button>` : ""}
          ${profile.showTime ? `<span data-time>0:00 / 0:00</span>` : ""}
          ${profile.showVolume ? `<input type="range" data-action="volume" min="0" max="1" step="0.05" value="${profile.autoplayMuted ? "0" : "1"}" aria-label="Volume">` : ""}
          ${profile.showSpeed ? `<select data-action="speed" aria-label="Velocidade"><option value="1">1x</option><option value="1.25">1,25x</option><option value="1.5">1,5x</option><option value="2">2x</option></select>` : ""}
          ${profile.showQuality && qualitySources.length ? `<select data-action="quality" aria-label="Qualidade"><option value="${escapeHtml(src)}">Original</option>${qualitySources.map((item) => `<option value="${escapeHtml(item.src)}">${escapeHtml(item.label)}</option>`).join("")}</select>` : ""}
          ${profile.showFullscreen ? `<button type="button" data-action="fullscreen" aria-label="Tela cheia">⛶</button>` : ""}
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
      {
        const fields = content.fields && typeof content.fields === "object"
          ? content.fields as Record<string, unknown>
          : { name: true, email: true, whatsapp: false };
      return `<form class="fz-lead-form" data-lead-form>
        ${fields.name !== false ? `<label>Nome<input name="name" autocomplete="name" maxlength="120"></label>` : ""}
        ${fields.email !== false ? `<label>E-mail<input name="email" type="email" autocomplete="email" maxlength="254"></label>` : ""}
        ${fields.whatsapp === true ? `<label>WhatsApp<input name="whatsapp" type="tel" autocomplete="tel" maxlength="30"></label>` : ""}
        <label class="fz-consent"><input name="consent" type="checkbox" required> Aceito receber o conteúdo solicitado.</label>
        <button class="fz-cta" type="submit">${escapeHtml(content.label ?? "Quero receber")}</button>
        <output aria-live="polite"></output>
      </form>`;
      }
    case "quiz": {
      const questions = Array.isArray(content.questions) ? content.questions.slice(0, 10) : [];
      if (!questions.length) return `<div class="fz-quiz"><strong>Quiz demonstrativo</strong><p>Adicione perguntas no editor.</p></div>`;
      const transitionMs = Math.min(Math.max(Number(content.transitionMs) || 250, 0), 5_000);
      return `<div class="fz-quiz" data-quiz data-transition="${transitionMs}">
        <div class="fz-quiz-progress"><span></span></div>${questions
        .map((question, index) => {
          const item = contentRecord(question);
          const options = Array.isArray(item.options) ? item.options.slice(0, 8) : [];
          return `<section ${index ? "hidden" : ""} data-question="${index}">
            <small>Pergunta ${index + 1} de ${questions.length}</small>
            <strong>${escapeHtml(item.title ?? `Pergunta ${index + 1}`)}</strong>
            ${options.map((option) => `<button type="button" data-answer="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join("")}
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

function renderBlock(
  block: PageBlock,
  page: PublicPageRow,
  pitchAtSeconds: number,
  playerProfiles: Map<string, PlayerConfig>
): string {
  const content = renderBlockContent(block, page, pitchAtSeconds, playerProfiles);
  if (!content) return "";
  const presentation = blockStyle(block.settings ?? {});
  return `<div class="${presentation.className}" style="${escapeHtml(presentation.style)}">${content}</div>`;
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
(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');</script>`);
  }
  if (ga4Id) {
    blocks.push(`<script nonce="${nonce}" async src="https://www.googletagmanager.com/gtag/js?id=${ga4Id}"></script>
<script nonce="${nonce}">window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:false});</script>`);
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
  const pixelNames = {
    page_view:'PageView', vsl_start:'ViewContent', quiz_complete:'CompleteRegistration',
    lead_submit:'Lead', checkout_click:'InitiateCheckout', purchase:'Purchase'
  };
  const ga4Names = {
    page_view:'page_view', vsl_start:'video_start', vsl_progress:'video_progress',
    vsl_complete:'video_complete', quiz_complete:'quiz_complete',
    lead_submit:'generate_lead', checkout_click:'begin_checkout', purchase:'purchase'
  };
  const emit = (type, properties = {}, once = '') => {
    const key = once || type + ':' + JSON.stringify(properties);
    if (once && sent.has(key)) return;
    if (once) sent.add(key);
    const id = crypto.randomUUID();
    queue.push({
      id, type, occurredAt: new Date().toISOString(),
      source: utm.utm_source || null,
      campaign: utm.utm_campaign || null, utm, properties
    });
    if (window.fbq && pixelNames[type]) {
      window.fbq('track', pixelNames[type], properties, {eventID:id});
    }
    if (window.gtag && ga4Names[type]) {
      window.gtag('event', ga4Names[type], {
        ...properties,
        event_id:id,
        page_location:location.href,
        campaign_source:utm.utm_source,
        campaign_medium:utm.utm_medium,
        campaign_name:utm.utm_campaign
      });
    }
    if (queue.length >= 10) flush();
  };
  const flush = () => {
    if (!queue.length) return;
    const body = JSON.stringify({
      contextToken: meta.trackingToken,
      events: queue.splice(0, 30)
    });
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
    const speed = root.querySelector('[data-action="speed"]');
    const quality = root.querySelector('[data-action="quality"]');
    const rewind = root.querySelector('[data-action="rewind"]');
    const forward = root.querySelector('[data-action="forward"]');
    const fullscreen = root.querySelector('[data-action="fullscreen"]');
    const autoplayHint = root.querySelector('.fz-autoplay-hint');
    const resumeDialog = root.querySelector('.fz-resume-dialog');
    const resumeButton = root.querySelector('[data-action="resume"]');
    const restartButton = root.querySelector('[data-action="restart"]');
    const smartProgress = root.querySelector('.fz-smart-progress b');
    const headline = root.querySelector('[data-timed="headline"]');
    const miniHook = root.querySelector('[data-timed="mini-hook"]');
    const playerCta = root.querySelector('[data-timed="cta"]');
    const time = root.querySelector('[data-time]');
    const pitch = Number(root.dataset.pitch || 0);
    const assetId = root.dataset.assetId || '';
    let profile = {};
    try { profile = JSON.parse(root.dataset.profile || '{}'); } catch {}
    const allowedDomains = Array.isArray(profile.allowedDomains) ? profile.allowedDomains : [];
    const hostnameAllowed = (rule) => rule.startsWith('*.')
      ? location.hostname === rule.slice(2) || location.hostname.endsWith('.' + rule.slice(2))
      : location.hostname === rule;
    if (allowedDomains.length && !allowedDomains.some(hostnameAllowed)) {
      root.innerHTML = '<div class="fz-player-blocked"><strong>Vídeo protegido</strong><span>Este domínio não está autorizado na KRANO.</span></div>';
      return;
    }
    const userAgent = navigator.userAgent;
    const device = /ipad|tablet/i.test(userAgent) ? 'Tablet' : /mobile|android|iphone/i.test(userAgent) ? 'Celular' : 'Desktop';
    const browser = /edg/i.test(userAgent) ? 'Edge' : /firefox/i.test(userAgent) ? 'Firefox' : /chrome|crios/i.test(userAgent) ? 'Chrome' : /safari/i.test(userAgent) ? 'Safari' : 'Outro';
    let playerVariant = 'principal';
    if (profile.posterAssetId && profile.posterTestAssetId) {
      const hash = [...aid].reduce((sum, character) => sum + character.charCodeAt(0), 0);
      if (hash % 2) {
        video.poster = '/media/' + profile.posterTestAssetId;
        playerVariant = 'thumbnail-b';
      } else {
        video.poster = '/media/' + profile.posterAssetId;
        playerVariant = 'thumbnail-a';
      }
    }
    const eventData = (properties = {}) => ({assetId, device, browser, playerVariant, ...properties});
    const resumeKey = 'fz:resume:' + assetId;
    let lastProgressBucket = 0;
    let lastSavedSecond = -1;
    const format = (seconds) => Number.isFinite(seconds) ? Math.floor(seconds / 60) + ':' +
      String(Math.floor(seconds % 60)).padStart(2, '0') : '0:00';
    const playToggle = () => video.paused ? video.play() : video.pause();
    big.addEventListener('click', playToggle);
    if (autoplayHint) autoplayHint.addEventListener('click', () => {
      video.muted = false;
      video.volume = 1;
      autoplayHint.hidden = true;
      video.play().catch(() => {});
    });
    if (toggle) toggle.addEventListener('click', playToggle);
    if (profile.clickToPause !== false) video.addEventListener('click', playToggle);
    if (volume) volume.addEventListener('input', () => {
      video.volume = Number(volume.value);
      video.muted = video.volume === 0;
    });
    if (seek && profile.allowSeek !== false) seek.addEventListener('input', () => {
      if (video.duration) video.currentTime = Number(seek.value) / 1000 * video.duration;
    });
    if (rewind) rewind.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - Number(profile.rewindSeconds || 0));
    });
    if (forward) forward.addEventListener('click', () => {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + Number(profile.forwardSeconds || 0));
    });
    if (fullscreen) fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else root.requestFullscreen().catch(() => {});
    });
    if (speed) speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
    if (quality) quality.addEventListener('change', () => {
      const currentTime = video.currentTime;
      const shouldResume = !video.paused;
      video.src = quality.value;
      video.load();
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(currentTime, video.duration || currentTime);
        if (shouldResume) video.play().catch(() => {});
      }, {once:true});
    });
    if (profile.protectVideo !== false) {
      root.addEventListener('contextmenu', (event) => event.preventDefault());
      video.addEventListener('dragstart', (event) => event.preventDefault());
    }
    video.addEventListener('loadedmetadata', () => {
      video.playbackRate = Math.min(Math.max(Number(profile.playbackRate || 1), .75), 1.5);
      if (profile.resumePlayback !== false && assetId) {
        const saved = Number(localStorage.getItem(resumeKey) || 0);
        if (saved > 3 && saved < video.duration - 3 && resumeDialog) {
          resumeDialog.hidden = false;
          if (resumeButton) resumeButton.addEventListener('click', () => {
            video.currentTime = saved;
            resumeDialog.hidden = true;
            video.play().catch(() => {});
          }, {once:true});
          if (restartButton) restartButton.addEventListener('click', () => {
            localStorage.removeItem(resumeKey);
            video.currentTime = 0;
            resumeDialog.hidden = true;
            video.play().catch(() => {});
          }, {once:true});
        }
      }
      if (profile.autoplayMuted === true) {
        video.muted = true;
        video.play().catch(() => {});
      }
    }, {once:true});
    video.addEventListener('play', () => {
      big.hidden = true;
      if (autoplayHint && !video.muted) autoplayHint.hidden = true;
      if (toggle) toggle.textContent = 'Ⅱ';
      emit('vsl_start', eventData(), 'vsl_start:' + assetId);
    });
    video.addEventListener('pause', () => {
      if (toggle) toggle.textContent = '▶';
      if (!video.ended) emit('vsl_pause', eventData({second:Math.round(video.currentTime)}));
    });
    video.addEventListener('timeupdate', () => {
      const ratio = video.duration ? video.currentTime / video.duration : 0;
      if (seek) seek.value = String(Math.round(ratio * 1000));
      if (smartProgress) smartProgress.style.width = String(Math.round(ratio * 10000) / 100) + '%';
      if (time) time.textContent = format(video.currentTime) + ' / ' + format(video.duration);
      const current = video.currentTime;
      const showBetween = (element, start, end) => {
        if (!element) return;
        const visible = current >= Number(start || 0) && (!Number(end) || current <= Number(end));
        element.classList.toggle('visible', visible);
      };
      showBetween(headline, profile.headlineStartSeconds, profile.headlineEndSeconds);
      showBetween(miniHook, profile.miniHookStartSeconds, profile.miniHookEndSeconds);
      showBetween(playerCta, profile.ctaAtSeconds, profile.ctaEndSeconds);
      if (ratio >= .25) emit('vsl_25', eventData(), 'vsl_25:' + assetId);
      if (ratio >= .50) emit('vsl_50', eventData(), 'vsl_50:' + assetId);
      if (ratio >= .75) emit('vsl_75', eventData(), 'vsl_75:' + assetId);
      const bucket = Math.floor(ratio * 10) * 10;
      if (bucket > lastProgressBucket && bucket < 100) {
        lastProgressBucket = bucket;
        emit('vsl_progress', eventData({
          percent:bucket,
          second:Math.round(video.currentTime)
        }), 'vsl_progress:' + assetId + ':' + bucket);
      }
      const currentSecond = Math.floor(video.currentTime);
      if (profile.resumePlayback !== false && assetId && currentSecond - lastSavedSecond >= 3) {
        lastSavedSecond = currentSecond;
        localStorage.setItem(resumeKey, String(currentSecond));
      }
      if (pitch > 0 && video.currentTime >= pitch) {
        emit('vsl_pitch', eventData({second:pitch}), 'vsl_pitch:' + assetId);
        document.querySelectorAll('.fz-delayed-cta').forEach((item) => item.classList.add('visible'));
      }
    });
    video.addEventListener('ended', () => {
      if (assetId) localStorage.removeItem(resumeKey);
      emit('vsl_complete', eventData(), 'vsl_complete:' + assetId);
    });
  });

  document.querySelectorAll('[data-checkout="true"]').forEach((link) => {
    link.addEventListener('click', () => {
      const player = document.querySelector('[data-fz-player]');
      emit('checkout_click', {
        href:link.href,
        assetId:player?.dataset.assetId || ''
      }, 'checkout_click:' + link.href);
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
          whatsapp:data.get('whatsapp'),
          consent:data.get('consent') === 'on', contextToken:meta.trackingToken})
      });
      output.textContent = response.ok ? 'Recebido. Obrigado!' : 'Não foi possível enviar.';
      if (response.ok) { emit('lead_submit', {}, 'lead_submit'); form.reset(); }
    });
  });

  document.querySelectorAll('[data-quiz]').forEach((quiz) => {
    const questions = [...quiz.querySelectorAll('[data-question]')];
    const progress = quiz.querySelector('.fz-quiz-progress span');
    const transition = Number(quiz.dataset.transition || 250);
    emit('quiz_start', {questionCount:questions.length}, 'quiz_start');
    const updateProgress = (index) => {
      if (progress) progress.style.width = String(Math.round(index / questions.length * 100)) + '%';
    };
    updateProgress(0);
    questions.forEach((section, index) => section.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        const question = section.querySelector('strong')?.textContent || 'Pergunta ' + (index + 1);
        const answer = button.dataset.answer || button.textContent || '';
        emit('quiz_answer', {question, answer, questionIndex:index});
        button.classList.add('selected');
        updateProgress(index + 1);
        setTimeout(() => {
        section.hidden = true;
        if (questions[index + 1]) questions[index + 1].hidden = false;
        else {
          quiz.querySelector('output').textContent = 'Respostas registradas. Continue para a próxima etapa.';
          emit('quiz_complete', {questionCount:questions.length}, 'quiz_complete');
        }
        }, transition);
      });
    }));
  });
})();
</script>`;
}

async function readPlayerProfiles(
  env: Env,
  content: PageDocument
): Promise<Map<string, PlayerConfig>> {
  const assetIds = content.blocks
    .filter((block) => block.type === "video")
    .map((block) => contentRecord(block.content).assetId)
    .filter(
      (assetId): assetId is string =>
        typeof assetId === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(assetId)
    );
  const uniqueIds = [...new Set(assetIds)];
  if (!uniqueIds.length) return new Map();
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, player_config_json
     FROM assets
     WHERE id IN (${placeholders}) AND media_type = 'video'
       AND upload_status = 'ready' AND deleted_at IS NULL`
  ).bind(...uniqueIds).all<PlayerProfileRow>();
  return new Map(
    rows.results.map((row) => [
      row.id,
      normalizePlayerConfig(safeJson<unknown>(row.player_config_json, DEFAULT_PLAYER_CONFIG))
    ])
  );
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
    theme: { background: "#000000", text: "#f7f7f8", accent: "#f00000" },
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
  const background = safeColor(theme.background, "#000000");
  const text = safeColor(theme.text, "#f7f7f8");
  const accent = safeColor(theme.accent, "#f00000");
  const pageWidth = clampNumber(theme.maxWidth, 320, 1440, 920);
  const pageAlign = typeof theme.contentAlign === "string" && ["left", "center", "right"].includes(theme.contentAlign)
    ? theme.contentAlign
    : "center";
  const buttonRadius = clampNumber(theme.buttonRadius, 0, 999, 14);
  const fontFamily = theme.font === "editorial"
    ? "Georgia,'Times New Roman',serif"
    : theme.font === "rounded"
      ? "'Trebuchet MS',ui-rounded,sans-serif"
      : theme.font === "system"
        ? "system-ui,sans-serif"
        : "Inter,ui-sans-serif,system-ui,sans-serif";
  const pitchAtSeconds = Math.max(0, Number(content.settings?.pitchAtSeconds ?? 0) || 0);
  const nonce = randomToken(18);
  const pixels = safeJson<Record<string, unknown>>(page.pixel_config_json, {});
  const title = content.settings?.title ?? page.page_name;
  const description =
    content.settings?.description ?? `${page.offer_name} — página publicada na KRANO.`;
  const playerProfiles = await readPlayerProfiles(env, content);
  const blocks = content.blocks
    .map((block) => renderBlock(block, page, pitchAtSeconds, playerProfiles))
    .join("\n");
  const requestUrl = new URL(request.url);
  const trackingToken = await signPublicTrackingContext(env.SESSION_SECRET, {
    host: requestUrl.host.toLowerCase(),
    path: requestUrl.pathname,
    anonymousId,
    offerId: page.offer_id,
    funnelId: page.funnel_id,
    pageId: page.page_id,
    variantId: variant.id
  });
  const meta = {
    anonymousId,
    trackingToken
  };
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <style nonce="${nonce}">
    :root{--bg:${background};--text:${text};--accent:${accent};--page-width:${pageWidth}px;--page-align:${pageAlign};--button-radius:${buttonRadius}px;color-scheme:dark}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 42%),var(--bg);color:var(--text);font-family:${fontFamily};line-height:1.6}
    .fz-page{width:min(var(--page-width),calc(100% - 32px));margin:auto;padding:72px 0 96px;text-align:var(--page-align)}.fz-block{width:100%;margin-inline:auto}.fz-block>*{margin-inline:auto}
    .fz-heading{font-size:clamp(2rem,6vw,4.5rem);line-height:1.02;text-align:inherit;letter-spacing:-.045em;max-width:880px}
    .fz-copy{font-size:clamp(1rem,2.2vw,1.25rem);max-width:720px;text-align:inherit;color:color-mix(in srgb,currentColor 78%,transparent)}
    .fz-copy p{margin:0 0 1em}.fz-image img{display:block;max-width:100%;border-radius:20px;margin:auto}
    .fz-player,.fz-video-placeholder{position:relative;max-width:860px;aspect-ratio:16/9;border-radius:var(--fz-player-radius,22px);overflow:hidden;background:var(--fz-player-bg,#02040a);border:1px solid color-mix(in srgb,var(--text) 16%,transparent);box-shadow:0 30px 80px #0008}
    .fz-player video{width:100%;height:100%;display:block}.fz-big-play{position:absolute;z-index:5;inset:50% auto auto 50%;translate:-50% -50%;width:78px;height:78px;border:0;border-radius:50%;background:var(--fz-player-accent,var(--accent));color:white;font-size:28px;cursor:pointer}
    .fz-watermark{position:absolute;right:14px;top:14px;padding:5px 9px;border-radius:8px;background:#0009;color:#fff;font-size:11px;pointer-events:none}
    .fz-controls{position:absolute;z-index:6;inset:auto 0 0;display:flex;gap:10px;align-items:center;padding:14px;background:linear-gradient(transparent,#000d)}
    .fz-controls button{border:0;background:transparent;color:white;font-size:15px}.fz-controls input[data-action=seek]{flex:1;accent-color:var(--fz-player-accent,var(--accent))}.fz-controls input[data-action=seek]:disabled{opacity:.55}.fz-controls input[data-action=volume]{width:80px;accent-color:var(--fz-player-accent,var(--accent))}.fz-controls span{font-size:12px;white-space:nowrap}.fz-controls select{border:1px solid #ffffff26;border-radius:8px;background:#080808;color:#fff;padding:6px}
    .timeline-minimal .fz-controls input[data-action=seek]{height:3px}.timeline-minimal .fz-controls span{display:none}.timeline-hidden .fz-controls input[data-action=seek],.timeline-hidden .fz-controls span{display:none}
    .fz-player-headline{display:none;position:absolute;z-index:4;left:50%;top:18px;translate:-50% 0;width:min(92%,720px);padding:9px 13px;border-radius:10px;background:#000b;color:#fff;text-align:center;font-size:clamp(14px,2.2vw,22px)}.fz-player-headline.visible{display:block}
    .fz-mini-hook{display:none;position:absolute;z-index:7;left:50%;bottom:72px;translate:-50% 0;width:max-content;max-width:92%;padding:9px 14px;border-radius:10px;background:#000d;color:#fff;text-align:center;font-weight:750}.fz-mini-hook.visible{display:block}
    .fz-smart-progress{position:absolute;z-index:8;inset:auto 0 0;height:var(--fz-progress-height,6px);background:#ffffff24}.fz-smart-progress b{display:block;width:0;height:100%;background:var(--fz-player-accent,var(--accent));transition:width .2s linear}
    .fz-autoplay-hint{position:absolute;z-index:7;left:50%;bottom:18px;translate:-50% 0;width:min(92%,520px);padding:13px;border:1px solid #ffffff22;border-radius:12px;background:#000d;color:#fff;font-weight:800;cursor:pointer}
    .fz-resume-dialog{position:absolute;z-index:10;inset:0;place-content:center;padding:24px;background:#000d;color:#fff;text-align:center}.fz-resume-dialog:not([hidden]){display:grid}.fz-resume-dialog strong{font-size:clamp(18px,3vw,26px)}.fz-resume-dialog div{display:flex;justify-content:center;gap:9px;margin-top:18px;flex-wrap:wrap}.fz-resume-dialog button{padding:11px 15px;border:1px solid #ffffff2b;border-radius:10px;background:#111;color:#fff}.fz-resume-dialog button:first-child{background:var(--fz-player-accent,var(--accent));border-color:transparent}
    .fz-player-cta{display:none;position:absolute;z-index:7;left:50%;bottom:74px;translate:-50% 0;width:max-content;max-width:90%;padding:13px 22px;border-radius:12px;background:var(--fz-player-accent,var(--accent));color:#fff;text-decoration:none;font-weight:900;text-align:center}.fz-player-cta.visible{display:block}.fz-player-cta.pulse{animation:fzPulse 1.6s ease-in-out infinite}@keyframes fzPulse{50%{scale:1.035;box-shadow:0 0 0 10px color-mix(in srgb,var(--fz-player-accent,var(--accent)) 16%,transparent)}}
    .fz-player-blocked{display:grid;place-content:center;height:100%;padding:28px;text-align:center}.fz-player-blocked strong{font-size:22px}.fz-player-blocked span{margin-top:8px;color:#aaa}
    .fz-video-placeholder{display:grid;place-content:center;text-align:center;color:#94a3b8}.fz-video-placeholder strong{color:white;font-size:24px}.fz-video-placeholder span{display:block}
    .fz-cta-wrap{text-align:inherit}.fz-cta{display:inline-flex;justify-content:center;align-items:center;border:0;border-radius:var(--button-radius);padding:17px 28px;background:var(--accent);color:white;text-decoration:none;font-weight:800;font-size:18px;cursor:pointer;box-shadow:0 16px 44px color-mix(in srgb,var(--accent) 35%,transparent)}
    .fz-delayed-cta{display:none}.fz-delayed-cta.visible{display:block}.fz-spacer{height:44px}.fz-divider{border:0;border-top:1px solid color-mix(in srgb,var(--text) 18%,transparent);max-width:720px}
    .fz-lead-form,.fz-quiz{max-width:580px;padding:28px;border:1px solid color-mix(in srgb,var(--text) 16%,transparent);border-radius:20px;background:color-mix(in srgb,var(--text) 5%,transparent)}
    .fz-lead-form label{display:grid;gap:7px;margin:0 0 14px}.fz-lead-form input{padding:13px;border-radius:10px;border:1px solid #ffffff2b;background:#0004;color:var(--text)}.fz-consent{display:flex!important;grid-template-columns:auto 1fr!important}.fz-lead-form output{display:block;margin-top:12px}
    .fz-quiz-progress{height:6px;border-radius:999px;background:#ffffff14;overflow:hidden;margin-bottom:22px}.fz-quiz-progress span{display:block;width:0;height:100%;background:var(--accent);transition:width .25s ease}.fz-quiz section{display:grid;gap:10px}.fz-quiz section small{color:color-mix(in srgb,var(--text) 62%,transparent)}.fz-quiz section strong{font-size:20px}.fz-quiz button{padding:13px;border:1px solid #ffffff25;border-radius:12px;background:#ffffff0a;color:var(--text);cursor:pointer;text-align:left}.fz-quiz button:hover,.fz-quiz button.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,transparent)}.fz-quiz output{display:block}
    [hidden]{display:none!important}.fz-custom-html{max-width:720px;margin-inline:auto}.fz-hide-desktop{display:none}
    @media(max-width:640px){.fz-page{padding-top:48px}.fz-controls span{display:none}.fz-controls input[data-action=volume]{width:58px}.fz-player{border-radius:14px}.fz-hide-desktop{display:block}.fz-hide-mobile{display:none}}
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
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://connect.facebook.net https://www.googletagmanager.com; style-src 'self' 'nonce-${nonce}'; img-src 'self' data: https://www.facebook.com; media-src 'self' https://interactive-examples.mdn.mozilla.net; connect-src 'self' https://www.facebook.com https://www.google-analytics.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self' https:`
  });
  if (!existingAid) {
    headers.append("Set-Cookie", `fz_aid=${anonymousId}; Path=/; Secure; SameSite=Lax; Max-Age=31536000`);
  }
  if (variant.cookie) headers.append("Set-Cookie", variant.cookie);
  return new Response(html, { headers });
}
