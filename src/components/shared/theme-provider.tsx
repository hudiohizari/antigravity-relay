import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ipc } from '@/ipc/manager';
import { parseThemeMode, ThemeMode } from '@/modules/app-shell/types/theme-mode';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider(props: ThemeProviderProps) {
  const { children, defaultTheme = 'system', storageKey = 'vite-ui-theme' } = props;
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return parseThemeMode(localStorage.getItem(storageKey)) ?? defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = useMemo<ThemeProviderState>(
    () => ({
      theme,
      setTheme: (nextTheme) => {
        localStorage.setItem(storageKey, nextTheme);
        setTheme(nextTheme);
        ipc.client.theme.setThemeMode(nextTheme);
      },
    }),
    [storageKey, theme],
  );

  return (
    <ThemeProviderContext.Provider value={value} {...props}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
