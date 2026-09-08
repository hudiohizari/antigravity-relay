import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import vi from "./vi";
import tr from "./tr";
import en from "./en";
import id from "./id";
import zhCn from "./zh-CN";
import ru from "./ru";
import fr from "./fr";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "lang",
    },
    supportedLngs: ["en", "zh-CN", "ru", "vi", "tr", "fr", "id"],
    load: "currentOnly", // Only load the exact language code, not variants
    resources: {
      en: {
        translation: en,
      },
      id: {
        translation: id,
      },
      vi: {
        translation: vi,
      },
      tr: {
        translation: tr,
      },
      "zh-CN": {
        translation: zhCn,
      },
      ru: {
        translation: ru,
      },
      fr: {
        translation: fr,
      },
    },
  });
