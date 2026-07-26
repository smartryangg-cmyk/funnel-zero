import { z } from "zod";

export const setupSchema = z.object({
  token: z.string().min(32).max(256),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, "Inclua uma letra minúscula.")
    .regex(/[A-Z]/, "Inclua uma letra maiúscula.")
    .regex(/[0-9]/, "Inclua um número.")
    .regex(/[^A-Za-z0-9]/, "Inclua um símbolo.")
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128)
});

export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "editor" | "analyst";
}

export interface DashboardMetrics {
  activeOffers: number;
  publishedFunnels: number;
  pageViews: number;
  approximateVisitors: number;
  vslStarts: number;
  averageRetention: number;
  pitchReached: number;
  checkoutClicks: number;
  clickThroughRate: number;
  conversions: number;
  winningVariants: number;
  storageBytes: number;
  storageLimitBytes: number;
  storageScanComplete: boolean;
  activeDomains: number;
  pendingDomains: number;
  periodDays: number;
  freeOnly: boolean;
}

export interface BootstrapResponse {
  installed: boolean;
  user: SessionUser | null;
  environment: string;
  freeOnly: boolean;
}
