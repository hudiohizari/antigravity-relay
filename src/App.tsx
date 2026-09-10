import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { syncWithLocalTheme } from "@/modules/app-shell/actions/theme";
import { useTranslation } from "react-i18next";
import { updateAppLanguage } from "@/modules/app-shell/actions/language";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./modules/app-shell/routing/routes";
import "./localization/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { LOCAL_STORAGE_KEYS } from "@/shared/constants";
import { ManualUpdateNotification } from "@/modules/app-shell/components/ManualUpdateNotification";
import { useTrayAccountSync } from "@/modules/cloud-account/hooks/useTrayAccountSync";
import { RootErrorBoundary } from "@/components/layout/RootErrorBoundary";

function AppContent() {
  const { i18n } = useTranslation();
  useTrayAccountSync();

  useEffect(() => {
    syncWithLocalTheme();
    updateAppLanguage(i18n);
    if (window.electron?.changeLanguage) {
      window.electron.changeLanguage(i18n.language);
    }
  }, [i18n]);

  return <RouterProvider router={router} />;
}

function App() {
  return (
    <RootErrorBoundary>
      <AppContent />
    </RootErrorBoundary>
  );
}

const queryClient = new QueryClient();

const root = createRoot(document.getElementById("app")!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        storageKey={LOCAL_STORAGE_KEYS.THEME}
        defaultTheme="system"
      >
        <RootErrorBoundary>
          <App />
          <ManualUpdateNotification />
          <Toaster />
        </RootErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
