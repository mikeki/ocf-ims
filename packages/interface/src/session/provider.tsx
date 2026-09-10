//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { Session, SessionState } from "@/session/types";

// React's view of the session (plan 09l F5): the provider mounts one Session
// and bootstraps it once; useSession() subscribes through
// useSyncExternalStore so a state change re-renders exactly the screens that
// read it.

const SessionContext = createContext<Session | undefined>(undefined);

export interface SessionProviderProps {
  session: Session;
  children: ReactNode;
}

export function SessionProvider(props: SessionProviderProps) {
  const { session } = props;
  useEffect(() => {
    void session.bootstrap();
  }, [session]);
  return (
    <SessionContext.Provider value={session}>
      {props.children}
    </SessionContext.Provider>
  );
}

export interface SessionHandle {
  readonly state: SessionState;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** From `unreachable`: run the bootstrap again. */
  retry(): Promise<void>;
  refreshAuthStatus(): Promise<void>;
}

export function useSession(): SessionHandle {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession() needs a <SessionProvider> above it");
  }
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
  return useMemo(
    () => ({
      state,
      signIn: session.signIn,
      signOut: session.signOut,
      retry: session.bootstrap,
      refreshAuthStatus: session.refreshAuthStatus,
    }),
    [session, state],
  );
}
