import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import en from "./en.json";
import id from "./id.json";

export type Locale = "en" | "id";

// Catalog dictionary type
type LocaleCatalog = typeof en;

const catalogs: Record<Locale, LocaleCatalog> = {
  en,
  id,
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolvePath(
  obj: Record<string, unknown>,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (
      current &&
      typeof current === "object" &&
      part in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return typeof current === "string" ? current : undefined;
}

export interface I18nProviderProps {
  children: ReactNode;
  defaultLocale?: Locale;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  children,
  defaultLocale = "en",
}) => {
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const activeCatalog = catalogs[locale] || catalogs.en;
      let text = resolvePath(
        activeCatalog as unknown as Record<string, unknown>,
        key,
      );

      if (text === undefined) {
        text = resolvePath(
          catalogs.en as unknown as Record<string, unknown>,
          key,
        );
      }

      if (!text) {
        return key;
      }

      if (params) {
        return Object.entries(params).reduce((str, [paramKey, value]) => {
          return str.replace(
            new RegExp(`\\{${paramKey}\\}`, "g"),
            String(value),
          );
        }, text);
      }

      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useTranslation = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return context;
};
