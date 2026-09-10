// SPDX-License-Identifier: Apache-2.0

import type { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import type { QueryClient } from "@tanstack/react-query";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { PERSIST_MAX_AGE_MS } from "@/api/persist";

// The data-layer providers (plan 09l F10): connect-query's TransportProvider
// so `useQuery(ImsService.method.x, input)` finds the auth transport, and the
// TanStack client — persisted when a persister is given (the app), plain when
// not (tests).

export interface ApiProviderProps {
  transport: Transport;
  queryClient: QueryClient;
  persister?: Persister;
  /** Discards a restored cache whose buster differs (see cacheBuster). */
  buster?: string;
  children: ReactNode;
}

export function ApiProvider(props: ApiProviderProps) {
  useAppStateFocus();
  const client = props.persister ? (
    <PersistQueryClientProvider
      client={props.queryClient}
      persistOptions={{
        persister: props.persister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: props.buster ?? "",
      }}
    >
      {props.children}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={props.queryClient}>
      {props.children}
    </QueryClientProvider>
  );
  return (
    <TransportProvider transport={props.transport}>{client}</TransportProvider>
  );
}

/**
 * On native, TanStack's focus manager does not know about the app coming to
 * the foreground; wire it to AppState so a focused list refetches (09i E6).
 * Web keeps the default visibilitychange listener.
 */
function useAppStateFocus(): void {
  useEffect(() => {
    if (Platform.OS === "web") {
      return undefined;
    }
    return focusManager.setEventListener((handleFocus) => {
      const subscription = AppState.addEventListener("change", (state) => {
        handleFocus(state === "active");
      });
      return () => subscription.remove();
    });
  }, []);
}
