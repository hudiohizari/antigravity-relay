import type { i18n } from 'i18next';

export function setAppLanguage(lang: string, i18n: i18n) {
  i18n
    .changeLanguage(lang)
    .then(() => {
      localStorage.setItem('lang', lang);
      document.documentElement.lang = lang;
      if (window.electron?.changeLanguage) {
        window.electron.changeLanguage(lang);
      }
    })
    .catch((err) => {
      console.error('[Language] Failed to change language:', err);
    });
}

export function updateAppLanguage(i18n: i18n) {
  document.documentElement.lang = i18n.language;
}
