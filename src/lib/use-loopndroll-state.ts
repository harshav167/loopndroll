import { useEffect, useState } from "react";
import type { LoopPreset, LoopScope, LoopndrollSnapshot } from "./loopndroll";
import {
  clearHooks,
  deleteSession,
  ensureLoopndrollSetup,
  getLoopndrollState,
  registerHooks,
  saveDefaultPrompt,
  setGlobalPreset,
  setLoopScope,
  setSessionPreset,
} from "./loopndroll";

type UseLoopndrollStateResult = {
  snapshot: LoopndrollSnapshot | null;
  isLoading: boolean;
  errorMessage: string | null;
  savePrompt: (defaultPrompt: string) => Promise<void>;
  updateScope: (scope: LoopScope) => Promise<void>;
  updateGlobalPreset: (preset: LoopPreset | null) => Promise<void>;
  updateSessionPreset: (sessionId: string, preset: LoopPreset | null) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  installHooks: () => Promise<void>;
  uninstallHooks: () => Promise<void>;
  refresh: () => Promise<void>;
};

const LOOPNDROLL_POLL_INTERVAL_MS = 2000;

export function useLoopndrollState(): UseLoopndrollStateResult {
  const [snapshot, setSnapshot] = useState<LoopndrollSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const nextSnapshot = await ensureLoopndrollSetup();
        if (!cancelled && nextSnapshot) {
          setSnapshot(nextSnapshot);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load Loopndroll.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void hydrate();

    const intervalId = window.setInterval(() => {
      void getLoopndrollState()
        .then((nextSnapshot) => {
          if (!cancelled && nextSnapshot) {
            setSnapshot(nextSnapshot);
            setErrorMessage(null);
          }
        })
        .catch(() => {
          // Polling should not replace the last good state with a transient error.
        });
    }, LOOPNDROLL_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  async function runMutation(action: () => Promise<LoopndrollSnapshot | undefined>) {
    setErrorMessage(null);

    try {
      const nextSnapshot = await action();
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Loopndroll update failed.");
      throw error;
    }
  }

  return {
    snapshot,
    isLoading,
    errorMessage,
    savePrompt(defaultPrompt) {
      return runMutation(() => saveDefaultPrompt(defaultPrompt));
    },
    updateScope(scope) {
      return runMutation(() => setLoopScope(scope));
    },
    updateGlobalPreset(preset) {
      return runMutation(() => setGlobalPreset(preset));
    },
    updateSessionPreset(sessionId, preset) {
      return runMutation(() => setSessionPreset(sessionId, preset));
    },
    removeSession(sessionId) {
      return runMutation(() => deleteSession(sessionId));
    },
    installHooks() {
      return runMutation(() => registerHooks());
    },
    uninstallHooks() {
      return runMutation(() => clearHooks());
    },
    refresh() {
      return runMutation(() => getLoopndrollState());
    },
  };
}
