import { describe, expect, it } from "vitest";
import { isPublicRouteReady } from "../../packages/shared/src/schemas";

const ready = {
  pageStatus: "published",
  publishedVersionId: "version-1",
  offerId: "offer-1",
  offerStatus: "active",
  funnelId: "funnel-1",
  funnelStatus: "published"
};

describe("publicação real", () => {
  it("só confirma uma rota com página, versão, oferta e funil publicados", () => {
    expect(isPublicRouteReady(ready)).toBe(true);
  });

  it("recusa o estado antigo que marcava a página como publicada com oferta em rascunho", () => {
    expect(isPublicRouteReady({ ...ready, offerStatus: "draft" })).toBe(false);
  });

  it("permite páginas independentes de um funil", () => {
    expect(isPublicRouteReady({ ...ready, funnelId: null, funnelStatus: null })).toBe(true);
  });
});
