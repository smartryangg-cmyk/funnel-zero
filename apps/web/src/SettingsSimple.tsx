import type { SessionUser } from "../../../packages/shared/src/schemas";
import { AppearanceSettings, PageHeader } from "./ui";

export function SettingsSimple({ user }: { user: SessionUser }) {
  return <><PageHeader eyebrow="Configurações" title="Configurações" subtitle="Preferências da ferramenta." /><AppearanceSettings /><section className="panel v5-account-summary"><span className="eyebrow">CONTA</span><h2>{user.name}</h2><p>{user.email}</p></section></>;
}
