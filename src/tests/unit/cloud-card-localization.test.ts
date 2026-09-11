import { describe, expect, it } from "vitest";

import en from "@/localization/en";
import fr from "@/localization/fr";
import id from "@/localization/id";
import ru from "@/localization/ru";
import tr from "@/localization/tr";
import vi from "@/localization/vi";
import zhCn from "@/localization/zh-CN";

const locales = [
  { code: "en", card: en.cloud.card },
  { code: "zh-CN", card: zhCn.cloud.card },
  { code: "ru", card: ru.cloud.card },
  { code: "vi", card: vi.cloud.card },
  { code: "tr", card: tr.cloud.card },
  { code: "fr", card: fr.cloud.card },
  { code: "id", card: id.cloud.card },
];

describe("cloud account validation translations", () => {
  it.each(locales)(
    "defines every validation status and action in $code",
    ({ card }) => {
      expect(card.validationOAuthReauthRequired.trim()).not.toBe("");
      expect(card.validationRequired.trim()).not.toBe("");
      expect(card.completeValidation.trim()).not.toBe("");
    },
  );
});

const switchLocales = [
  { code: "en", switchStrings: en.cloud.switch },
  { code: "zh-CN", switchStrings: zhCn.cloud.switch },
  { code: "ru", switchStrings: ru.cloud.switch },
  { code: "vi", switchStrings: vi.cloud.switch },
  { code: "tr", switchStrings: tr.cloud.switch },
  { code: "fr", switchStrings: fr.cloud.switch },
  { code: "id", switchStrings: id.cloud.switch },
];

describe("cloud account switch translations", () => {
  it.each(switchLocales)(
    "defines CLI hints and accurate switch notices in $code",
    ({ switchStrings }) => {
      expect(switchStrings.cliHint.trim()).not.toBe("");
      expect(switchStrings.noticeCliUpdated.trim()).not.toBe("");
      expect(switchStrings.noticeRestarted.trim()).not.toBe("");
      expect(switchStrings.noticeInjectedOnDisk.trim()).not.toBe("");
      expect(switchStrings.noticeBatchAllRestarted.trim()).not.toBe("");
      expect(switchStrings.noticeBatchAllInjected.trim()).not.toBe("");
      expect(switchStrings.noticeBatchMixed.trim()).not.toBe("");
    },
  );
});
