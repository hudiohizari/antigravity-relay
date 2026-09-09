import { describe, expect, it } from "vitest";
import en from "@/localization/en";
import id from "@/localization/id";

describe("local import localization parity", () => {
  it("has identical keys between en and id for cloud.localImport", () => {
    const enKeys = Object.keys(en.cloud.localImport).sort();
    const idKeys = Object.keys(id.cloud.localImport).sort();
    expect(idKeys).toEqual(enKeys);

    const enSources = Object.keys(en.cloud.localImport.sources).sort();
    const idSources = Object.keys(id.cloud.localImport.sources).sort();
    expect(idSources).toEqual(enSources);

    const enValidationErrors = Object.keys(
      en.cloud.localImport.validationErrors,
    ).sort();
    const idValidationErrors = Object.keys(
      id.cloud.localImport.validationErrors,
    ).sort();
    expect(idValidationErrors).toEqual(enValidationErrors);

    const enDiscoveryErrors = Object.keys(
      en.cloud.localImport.discoveryErrors,
    ).sort();
    const idDiscoveryErrors = Object.keys(
      id.cloud.localImport.discoveryErrors,
    ).sort();
    expect(idDiscoveryErrors).toEqual(enDiscoveryErrors);

    const enImportErrors = Object.keys(
      en.cloud.localImport.importErrors,
    ).sort();
    const idImportErrors = Object.keys(
      id.cloud.localImport.importErrors,
    ).sort();
    expect(idImportErrors).toEqual(enImportErrors);

    const enErrors = Object.keys(en.cloud.localImport.errors).sort();
    const idErrors = Object.keys(id.cloud.localImport.errors).sort();
    expect(idErrors).toEqual(enErrors);
  });

  it("provides complete Indonesian translations for legacy agent and local import UI", () => {
    expect(id.cloud.localImport.sources["legacy-agent"]).toBe(
      "Data Agent Lama",
    );
    expect(id.cloud.localImport.trigger).toBe("Pindai Akun Lokal");
    expect(id.cloud.localImport.title).toBe("Impor Akun Lokal");
    expect(id.cloud.localImport.accountList).toBe(
      "Daftar akun lokal terdeteksi",
    );
    expect(id.cloud.localImport.accounts).toBe("Akun");
    expect(id.cloud.localImport.rescan).toBe("Pindai Ulang");
    expect(id.cloud.localImport.cancel).toBe("Batal");
    expect(id.cloud.localImport.close).toBe("Tutup");
  });

  it("contains zero em or en dashes in translation values", () => {
    function assertNoEmOrEnDashes(obj: Record<string, unknown>) {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string") {
          expect(value, `Key ${key} contains em-dash`).not.toContain("—");
          expect(value, `Key ${key} contains en-dash`).not.toContain("–");
        } else if (typeof value === "object" && value !== null) {
          assertNoEmOrEnDashes(value as Record<string, unknown>);
        }
      }
    }

    assertNoEmOrEnDashes(
      id.cloud.localImport as unknown as Record<string, unknown>,
    );
  });
});
