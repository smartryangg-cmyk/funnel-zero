import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const windowsInstaller = readFileSync("installers/KRANO-Installer-Windows-x64.exe");
const linuxInstaller = readFileSync("installers/krano-installer-linux-x64");
const readme = readFileSync("README.md", "utf8");

describe("downloads dos instaladores", () => {
  it("publica um PE Windows x64 real", () => {
    expect(windowsInstaller.subarray(0, 2).toString("ascii")).toBe("MZ");
    const peOffset = windowsInstaller.readUInt32LE(0x3c);
    expect(windowsInstaller.subarray(peOffset, peOffset + 4).toString("hex")).toBe("50450000");
    expect(windowsInstaller.readUInt16LE(peOffset + 4)).toBe(0x8664);
    expect(windowsInstaller.byteLength).toBeGreaterThan(5_000_000);
  });

  it("publica um ELF Linux x64 real", () => {
    expect(linuxInstaller.subarray(0, 4).toString("hex")).toBe("7f454c46");
    expect(linuxInstaller[4]).toBe(2);
    expect(linuxInstaller.readUInt16LE(18)).toBe(0x3e);
  });

  it("usa links raw que entregam os binários em vez da página HTML do GitHub", () => {
    expect(readme).toContain(
      "https://raw.githubusercontent.com/smartryangg-cmyk/funnel-zero/main/installers/KRANO-Installer-Windows-x64.exe"
    );
    expect(readme).toContain(
      "https://raw.githubusercontent.com/smartryangg-cmyk/funnel-zero/main/installers/krano-installer-linux-x64"
    );
    expect(readme).not.toContain(
      "[`KRANO-Installer-Windows-x64.exe`](./installers/KRANO-Installer-Windows-x64.exe)"
    );
  });
});
