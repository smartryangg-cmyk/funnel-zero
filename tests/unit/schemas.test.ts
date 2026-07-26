import { describe, expect, it } from "vitest";
import { loginSchema, setupSchema } from "../../packages/shared/src/schemas";

describe("setupSchema", () => {
  it("aceita credenciais fortes", () => {
    expect(
      setupSchema.safeParse({
        token: "a".repeat(43),
        name: "Pessoa Teste",
        email: "pessoa@example.com",
        password: "Senha-forte-2026!"
      }).success
    ).toBe(true);
  });

  it("recusa senha curta", () => {
    expect(
      setupSchema.safeParse({
        token: "a".repeat(43),
        name: "Pessoa Teste",
        email: "pessoa@example.com",
        password: "Fraca1!"
      }).success
    ).toBe(false);
  });

  it("normaliza e-mail", () => {
    const result = setupSchema.parse({
      token: "a".repeat(43),
      name: "Pessoa Teste",
      email: " PESSOA@EXAMPLE.COM ",
      password: "Senha-forte-2026!"
    });
    expect(result.email).toBe("pessoa@example.com");
  });
});

describe("loginSchema", () => {
  it("limita payloads inesperados", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "x".repeat(129) }).success).toBe(false);
  });
});
