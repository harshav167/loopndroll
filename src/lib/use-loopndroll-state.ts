import { useEffect, useState } from "react";
import type {
  CreateLoopNotificationInput,
  LoopPreset,
  LoopScope,
  LoopndrollSnapshot,
  UpdateLoopNotificationInput,
} from "./loopndroll";
import {
  clearHooks,
  createCompletionCheck,
  createNotification,
  deleteCompletionCheck,
  deleteNotification,
  deleteSession,
  ensureLoopndrollSetup,
  getLoopndrollState,
  registerHooks,
  saveDefaultPrompt,
  setGlobalCompletionCheckConfig,
  setGlobalNotification,
  setGlobalPreset,
  setSessionArchived,
  setSessionNotifications,
  setLoopScope,
  setSessionCompletionCheckConfig,
  setSessionPreset,
  updateCompletionCheck,
  updateNotification,
} from "./loopndroll";

type UseLoopndrollStateResult = {
  snapshot: LoopndrollSnapshot | null;
  isLoading: boolean;
  errorMessage: string | null;
  savePrompt: (defaultPrompt: string) => Promise<void>;
  addNotification: (notification: CreateLoopNotificationInput) => Promise<void>;
  addCompletionCheck: (completionCheck: { label?: string; commands: string[] }) => Promise<void>;
  editNotification: (notification: UpdateLoopNotificationInput) => Promise<void>;
  editCompletionCheck: (completionCheck: {
    id: string;
    label?: string;
    commands: string[];
  }) => Promise<void>;
  removeNotification: (notificationId: string) => Promise<void>;
  removeCompletionCheck: (completionCheckId: string) => Promise<void>;
  updateScope: (scope: LoopScope) => Promise<void>;
  updateGlobalPreset: (preset: LoopPreset | null) => Promise<void>;
  updateGlobalNotification: (notificationId: string | null) => Promise<void>;
  updateGlobalCompletionCheckConfig: (
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => Promise<void>;
  updateSessionNotifications: (sessionId: string, notificationIds: string[]) => Promise<void>;
  updateSessionPreset: (sessionId: string, preset: LoopPreset | null) => Promise<void>;
  updateSessionCompletionCheckConfig: (
    sessionId: string,
    completionCheckId: string | null,
    waitForReplyAfterCompletion: boolean,
  ) => Promise<void>;
  updateSessionArchived: (sessionId: string, archived: boolean) => Promise<void>;
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
    addNotification(notification) {
      return runMutation(() => createNotification(notification));
    },
    addCompletionCheck(completionCheck) {
      return runMutation(() => createCompletionCheck(completionCheck));
    },
    editNotification(notification) {
      return runMutation(() => updateNotification(notification));
    },
    editCompletionCheck(completionCheck) {
      return runMutation(() => updateCompletionCheck(completionCheck));
    },
    removeNotification(notificationId) {
      return runMutation(() => deleteNotification(notificationId));
    },
    removeCompletionCheck(completionCheckId) {
      return runMutation(() => deleteCompletionCheck(completionCheckId));
    },
    updateScope(scope) {
      return runMutation(() => setLoopScope(scope));
    },
    updateGlobalPreset(preset) {
      return runMutation(() => setGlobalPreset(preset));
    },
    updateGlobalNotification(notificationId) {
      return runMutation(() => setGlobalNotification(notificationId));
    },
    updateGlobalCompletionCheckConfig(completionCheckId, waitForReplyAfterCompletion) {
      return runMutation(() =>
        setGlobalCompletionCheckConfig(completionCheckId, waitForReplyAfterCompletion),
      );
    },
    updateSessionNotifications(sessionId, notificationIds) {
      return runMutation(() => setSessionNotifications(sessionId, notificationIds));
    },
    updateSessionPreset(sessionId, preset) {
      return runMutation(() => setSessionPreset(sessionId, preset));
    },
    updateSessionCompletionCheckConfig(sessionId, completionCheckId, waitForReplyAfterCompletion) {
      return runMutation(() =>
        setSessionCompletionCheckConfig(sessionId, completionCheckId, waitForReplyAfterCompletion),
      );
    },
    updateSessionArchived(sessionId, archived) {
      return runMutation(() => setSessionArchived(sessionId, archived));
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
