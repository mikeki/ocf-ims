// SPDX-License-Identifier: Apache-2.0

import type { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import type { QueryClient } from "@tanstack/react-query";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { AppState, Platform } from "react-native";
import type { Blobs } from "@/api/blobs";
import { createImsClient } from "@/api/client";
import { PERSIST_MAX_AGE_MS } from "@/api/persist";
import { createLiveHub, type LiveHub } from "@/features/live/hub";

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
  /** The blob helper (09s); absent only in tests that never upload. */
  blobs?: Blobs;
  /** The live hub (09v); built over the transport unless a test supplies one. */
  liveHub?: LiveHub;
  children: ReactNode;
}

const BlobsContext = createContext<Blobs | undefined>(undefined);
const LiveHubContext = createContext<LiveHub | undefined>(undefined);

/** The event streams' hub (09v). */
export function useLiveHub(): LiveHub {
  const hub = useContext(LiveHubContext);
  if (!hub) {
    throw new Error("useLiveHub() needs an <ApiProvider> above it");
  }
  return hub;
}

/** The blob helper for the attachment routes (09s). */
export function useBlobs(): Blobs {
  const blobs = useContext(BlobsContext);
  if (!blobs) {
    throw new Error("useBlobs() needs an <ApiProvider blobs> above it");
  }
  return blobs;
}

export function ApiProvider(props: ApiProviderProps) {
  useAppStateFocus();
  const { transport, queryClient } = props;
  const builtHub = useMemo(
    () =>
      createLiveHub({
        client: createImsClient(transport),
        queryClient,
        transport,
        active: Platform.OS === "web" || AppState.currentState === "active",
      }),
    [transport, queryClient],
  );
  const hub = props.liveHub ?? builtHub;
  useAppStateLive(hub);
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
    <TransportProvider transport={props.transport}>
      <BlobsContext.Provider value={props.blobs}>
        <LiveHubContext.Provider value={hub}>{client}</LiveHubContext.Provider>
      </BlobsContext.Provider>
    </TransportProvider>
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

/** The streams follow the app to the background and back (09v); web tabs keep theirs. */
function useAppStateLive(hub: LiveHub): void {
  useEffect(() => {
    if (Platform.OS === "web") {
      return undefined;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      hub.setActive(state === "active");
    });
    return () => subscription.remove();
  }, [hub]);
}
