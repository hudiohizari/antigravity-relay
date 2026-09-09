import { describe, expect, it } from "vitest";
import en from "@/localization/en";
import fr from "@/localization/fr";
import id from "@/localization/id";
import ru from "@/localization/ru";
import tr from "@/localization/tr";
import vi from "@/localization/vi";
import zhCN from "@/localization/zh-CN";

type Dict = Record<string, unknown>;

function getFlattenedKeys(obj: Dict, prefix = ""): string[] {
  let keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys = keys.concat(getFlattenedKeys(value as Dict, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getAllLeafValues(obj: Dict): string[] {
  let values: string[] = [];
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      values = values.concat(getAllLeafValues(value as Dict));
    } else if (typeof value === "string") {
      values.push(value);
    }
  }
  return values;
}

const locales: Record<string, Dict> = {
  "zh-CN": zhCN as unknown as Dict,
  ru: ru as unknown as Dict,
  vi: vi as unknown as Dict,
  tr: tr as unknown as Dict,
  fr: fr as unknown as Dict,
  id: id as unknown as Dict,
};

const enKeys = new Set(getFlattenedKeys(en as unknown as Dict));

describe("localization key parity", () => {
  it.each(Object.entries(locales))(
    "%s matches English keys exactly",
    (lang, dict) => {
      const currentKeys = new Set(getFlattenedKeys(dict));

      const missingKeys = [...enKeys].filter((k) => !currentKeys.has(k));
      const extraKeys = [...currentKeys].filter((k) => !enKeys.has(k));

      expect(missingKeys, `Missing keys in ${lang}`).toEqual([]);
      expect(extraKeys, `Extra keys in ${lang}`).toEqual([]);
    },
  );

  it.each([["en", en as unknown as Dict], ...Object.entries(locales)])(
    "%s contains no empty values or invalid dash punctuation",
    (lang, dict) => {
      const values = getAllLeafValues(dict);
      for (const val of values) {
        expect(
          val.trim().length,
          `Empty string value found in ${lang}`,
        ).toBeGreaterThan(0);
        expect(val, `Em dash or en dash found in ${lang}`).not.toMatch(/[—–]/);
      }
    },
  );
});
