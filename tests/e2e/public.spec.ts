import { expect, test } from "@playwright/test";

test("health check expõe o modo gratuito", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ ok: true, freeOnly: true });
});

test("dashboard privado redireciona para login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Volte a testar ofertas." })).toBeVisible();
});

test("login é responsivo e acessível", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar no Funnel Zero" })).toBeVisible();
});
