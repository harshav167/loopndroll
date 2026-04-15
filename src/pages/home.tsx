import { intlFormatDistance } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DotsThreeVertical, Play, Stop } from "@phosphor-icons/react";
import { ChatStatusIndicator } from "@/components/chat-status-indicator";
import {
  AwaitReplyCardIcon,
  ChatCard,
  CompletionChecksCardIcon,
  InfiniteCardIcon,
  TurnCountMarker,
} from "@/components/chat-card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LoopPreset, LoopSession } from "@/lib/loopndroll";
import { useLoopndrollState } from "@/lib/use-loopndroll-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const globalPresets: Array<{
  preset: LoopPreset;
  title: string;
  marker: ReactNode;
  markerContainerClassName?: string;
}> = [
  {
    preset: "infinite",
    title: "Infinite",
    marker: <InfiniteCardIcon />,
  },
  {
    preset: "await-reply",
    title: "Await Reply",
    marker: <AwaitReplyCardIcon />,
  },
  {
    preset: "completion-checks",
    title: "Completion Checks",
    marker: <CompletionChecksCardIcon />,
  },
  {
    preset: "max-turns-1",
    title: "Max Turns",
    marker: <TurnCountMarker className="-ml-0.5" value={1} />,
    markerContainerClassName: "-ml-0.5",
  },
  {
    preset: "max-turns-2",
    title: "Max Turns",
    marker: <TurnCountMarker value={2} />,
  },
  {
    preset: "max-turns-3",
    title: "Max Turns",
    marker: <TurnCountMarker value={3} />,
  },
];

function ChatCardRail({
  activePreset,
  onToggle,
  renderFooterStart,
}: {
  activePreset: LoopPreset | null;
  onToggle: (preset: LoopPreset) => void;
  renderFooterStart?: (preset: LoopPreset) => ReactNode;
}) {
  return (
    <div className="-mx-16 min-w-0 overflow-hidden">
      <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pl-16 pr-16 pt-1 pb-3 [scroll-padding-left:4rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {globalPresets.map((item) => (
          <ChatCard
            key={item.preset}
            isRunning={activePreset === item.preset}
            marker={item.marker}
            markerContainerClassName={item.markerContainerClassName}
            onAction={() => onToggle(item.preset)}
            footerStart={renderFooterStart?.(item.preset)}
            title={item.title}
          />
        ))}
      </div>
    </div>
  );
}

const sessionPresets: Array<{ preset: LoopPreset; label: string }> = [
  { preset: "infinite", label: "Infinite" },
  { preset: "await-reply", label: "Await Reply" },
  { preset: "completion-checks", label: "Completion Checks" },
  { preset: "max-turns-1", label: "Max Turns 1" },
  { preset: "max-turns-2", label: "Max Turns 2" },
  { preset: "max-turns-3", label: "Max Turns 3" },
];

const sessionPresetItems = sessionPresets.map((item) => ({
  label: item.label,
  value: item.preset,
}));
const EMPTY_SESSIONS: LoopSession[] = [];
const easeOut = [0.23, 1, 0.32, 1] as const;
const staggerContainerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.06,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};
const contentFadeVariants = {
  hidden: {
    opacity: 0,
    y: 8,
    filter: "blur(6px)",
  },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.28,
      ease: easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    filter: "blur(4px)",
    transition: {
      duration: 0.14,
      ease: easeOut,
    },
  },
};
const emptyStateVariants = {
  hidden: {
    opacity: 0,
  },
  show: {
    opacity: 1,
    transition: {
      duration: 0.18,
      ease: easeOut,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.12,
      ease: easeOut,
    },
  },
};
const rowStaggerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};
const SESSION_TIMING_WAVE_DURATION_MS = 280;

function stripMarkdownTitle(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)(?:#{1,6}\s+|>\s+|\d+\.\s+|[-+*]\s+)/gm, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\\([\\`*_#[\]~>])/g, "$1")
    .replace(/[\\`*_#[\]~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSessionPrompt(session: LoopSession) {
  if (!session.title) {
    return null;
  }

  const prompt = stripMarkdownTitle(session.title);
  return prompt || null;
}

function getSessionNumber(session: LoopSession, fallbackNumber: number) {
  const codexNumber = /^\d+$/.test(session.sessionId)
    ? Number.parseInt(session.sessionId, 10)
    : undefined;
  return typeof codexNumber === "number" && Number.isSafeInteger(codexNumber) && codexNumber > 0
    ? codexNumber
    : fallbackNumber;
}

function getSessionRef(session: LoopSession, fallbackNumber: number) {
  return session.sessionRef?.trim() || `C${getSessionNumber(session, fallbackNumber)}`;
}

function formatSessionRelativeTime(dateValue: string, now: number) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatted = intlFormatDistance(date, now, { style: "narrow" });
  return formatted === "now" ? "1s ago" : formatted;
}

function AnimatedEmptyStateMessage({ text }: { text: string }) {
  const characters = [...text];
  const totalCharacters = characters.length;

  return (
    <span aria-label={text} className="inline-flex flex-wrap">
      {characters.map((character, index) => (
        <span
          key={`${character}-${index}`}
          aria-hidden="true"
          className="empty-state-letter"
          style={
            {
              "--empty-letter-delay": `${(totalCharacters - index - 1) * -0.045}s`,
            } as CSSProperties
          }
        >
          {character === " " ? "\u00A0" : character}
        </span>
      ))}
    </span>
  );
}

function SessionTimingText({ text }: { text: string }) {
  const [animationVersion, setAnimationVersion] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const previousLengthRef = useRef(text.length);

  useEffect(() => {
    const previousLength = previousLengthRef.current;
    previousLengthRef.current = text.length;

    if (previousLength === text.length || text.length === 0) {
      return;
    }

    setAnimationVersion((current) => current + 1);
    setIsAnimating(true);

    const timeoutId = window.setTimeout(() => {
      setIsAnimating(false);
    }, SESSION_TIMING_WAVE_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [text]);

  return (
    <span aria-label={text} className="inline-flex min-w-0 whitespace-nowrap text-left">
      {[...text].map((character, index) => (
        <span
          key={isAnimating ? `${animationVersion}-${index}-${character}` : index}
          aria-hidden="true"
          className={cn("chat-timing-letter", isAnimating && "chat-timing-letter--animated")}
          style={
            {
              "--chat-timing-delay": `${Math.min(index * 0.012, 0.12)}s`,
            } as CSSProperties
          }
        >
          {character === " " ? "\u00A0" : character}
        </span>
      ))}
    </span>
  );
}

function HeaderLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="inline-flex h-auto items-center p-0 text-sm leading-none text-foreground/70 transition-colors hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function HomeRoute() {
  const {
    errorMessage,
    isLoading,
    removeSession,
    snapshot,
    updateGlobalCompletionCheckConfig,
    updateGlobalPreset,
    updateSessionArchived,
    updateSessionCompletionCheckConfig,
    updateSessionNotifications,
    updateSessionPreset,
  } = useLoopndrollState();

  const sessions = snapshot?.sessions ?? EMPTY_SESSIONS;
  const notifications = snapshot?.notifications ?? [];
  const completionChecks = snapshot?.completionChecks ?? [];
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const displaySessions = sessions.filter((session) =>
    showArchivedSessions ? session.archived : !session.archived,
  );
  const [now, setNow] = useState(() => Date.now());
  const [openActionsSessionId, setOpenActionsSessionId] = useState<string | null>(null);
  const [pendingSessionPresets, setPendingSessionPresets] = useState<Record<string, LoopPreset>>(
    {},
  );

  useEffect(() => {
    setPendingSessionPresets((current) => {
      const next: Record<string, LoopPreset> = {};

      for (const session of displaySessions) {
        next[session.sessionId] =
          current[session.sessionId] ?? session.preset ?? session.effectivePreset ?? "infinite";
      }

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => current[key] === next[key])
      ) {
        return current;
      }

      return next;
    });
  }, [displaySessions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const sessionRefs = new Map(
    [...sessions]
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
      .map((session, index) => [session.sessionId, getSessionRef(session, index + 1)]),
  );
  const sortedSessions = [...displaySessions].sort((left, right) =>
    right.firstSeenAt.localeCompare(left.firstSeenAt),
  );

  function hasAttachedTelegramNotification(session: LoopSession) {
    return session.notificationIds.some((notificationId) =>
      notifications.some(
        (notification) => notification.id === notificationId && notification.channel === "telegram",
      ),
    );
  }

  const selectedGlobalCompletionCheck =
    completionChecks.find(
      (completionCheck) => completionCheck.id === snapshot?.globalCompletionCheckId,
    ) ?? null;

  function hasConfiguredGlobalCompletionCheck() {
    return selectedGlobalCompletionCheck !== null;
  }

  function showAwaitReplyNotificationToast(session: LoopSession) {
    const sessionRef = sessionRefs.get(session.sessionId) ?? "C0";
    toast.error(`[${sessionRef}] Attach a Telegram notification first to use Await Reply.`);
  }

  function showCompletionCheckConfigToast(context: "global" | LoopSession) {
    if (context === "global") {
      toast.error("Select a registered Completion check first.");
      return;
    }

    const sessionRef = sessionRefs.get(context.sessionId) ?? "C0";
    toast.error(`[${sessionRef}] Select a registered Completion check first.`);
  }

  async function handleSessionPresetAction(session: LoopSession) {
    const pendingPreset =
      pendingSessionPresets[session.sessionId] ??
      session.preset ??
      session.effectivePreset ??
      "infinite";

    if (session.effectivePreset !== null) {
      await updateSessionPreset(session.sessionId, null);
      return;
    }

    if (pendingPreset === "await-reply" && !hasAttachedTelegramNotification(session)) {
      showAwaitReplyNotificationToast(session);
      return;
    }

    await updateSessionPreset(session.sessionId, pendingPreset);
  }

  async function handleSessionNotificationToggle(
    session: LoopSession,
    notificationId: string,
    checked: boolean,
  ) {
    const nextNotificationIds = checked
      ? [...session.notificationIds, notificationId]
      : session.notificationIds.filter((id) => id !== notificationId);

    await updateSessionNotifications(session.sessionId, [...new Set(nextNotificationIds)]);
  }

  async function handleSessionNotificationClear(sessionId: string) {
    await updateSessionNotifications(sessionId, []);
  }

  function renderGlobalPresetFooterStart(preset: LoopPreset) {
    if (preset !== "completion-checks") {
      return null;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Configure Completion checks preset"
          render={<Button className="-ml-[10px]" variant="ghost" size="icon-sm" />}
        >
          <DotsThreeVertical aria-hidden="true" weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={snapshot?.globalCompletionCheckId === null}
              onCheckedChange={() => {
                void updateGlobalCompletionCheckConfig(null, false);
              }}
            >
              None
            </DropdownMenuCheckboxItem>
            {completionChecks.length === 0 ? (
              <DropdownMenuItem disabled>No checks available</DropdownMenuItem>
            ) : (
              completionChecks.map((completionCheck) => (
                <DropdownMenuCheckboxItem
                  key={completionCheck.id}
                  checked={snapshot?.globalCompletionCheckId === completionCheck.id}
                  onCheckedChange={() => {
                    void updateGlobalCompletionCheckConfig(
                      completionCheck.id,
                      snapshot?.globalCompletionCheckWaitForReply ?? false,
                    );
                  }}
                >
                  {completionCheck.label}
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={snapshot?.globalCompletionCheckWaitForReply ?? false}
              disabled={!hasConfiguredGlobalCompletionCheck()}
              onCheckedChange={(checked) => {
                void updateGlobalCompletionCheckConfig(
                  snapshot?.globalCompletionCheckId ?? null,
                  Boolean(checked),
                );
              }}
            >
              Wait For Reply
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <section
      aria-label="Home"
      className="flex min-h-full min-w-0 flex-col overflow-hidden px-16 pt-16"
    >
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
        <h1 className="text-2xl leading-snug tracking-tight font-normal">
          Let Codex run until it’s actually done.
          <br />
          Get notified and reply in Telegram.
        </h1>

        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

        <div className="-mx-16 min-h-0 min-w-0 flex-1 pb-10">
          <div className="flex min-h-full min-w-0 flex-col gap-6 px-16 pt-6">
            <ChatCardRail
              activePreset={snapshot?.globalPreset ?? null}
              onToggle={(preset) => {
                if (preset === "completion-checks" && !hasConfiguredGlobalCompletionCheck()) {
                  showCompletionCheckConfigToast("global");
                  return;
                }
                const nextPreset = snapshot?.globalPreset === preset ? null : preset;
                void updateGlobalPreset(nextPreset);
              }}
              renderFooterStart={renderGlobalPresetFooterStart}
            />

            <AnimatePresence initial={false} mode="wait">
              {displaySessions.length === 0 ? (
                isLoading || !snapshot ? null : (
                  <motion.div
                    key={showArchivedSessions ? "empty-archived-chats" : "empty-registered-chats"}
                    animate="show"
                    className="space-y-3"
                    exit="exit"
                    initial="hidden"
                    variants={emptyStateVariants}
                  >
                    <div className="flex items-end justify-between gap-4">
                      <h2 className="text-[20px] leading-snug tracking-tight font-normal">
                        <span className="text-foreground">
                          {showArchivedSessions ? "Archived chats" : "Registered chats"}
                        </span>
                        <br />
                        <span className="text-foreground/60">
                          {showArchivedSessions
                            ? "stored separately from active hook controls"
                            : "and per-task mode controls"}
                        </span>
                      </h2>
                      <HeaderLink
                        onClick={() => {
                          setShowArchivedSessions((current) => !current);
                          setOpenActionsSessionId(null);
                        }}
                      >
                        {showArchivedSessions ? "Registered" : "Archived"}
                      </HeaderLink>
                    </div>
                    <p className="py-2 text-sm">
                      <AnimatedEmptyStateMessage
                        text={
                          showArchivedSessions
                            ? "No archived chats yet."
                            : "Start a chat in Codex so it appears here..."
                        }
                      />
                    </p>
                  </motion.div>
                )
              ) : (
                <motion.div
                  key={showArchivedSessions ? "archived-chats" : "registered-chats"}
                  animate="show"
                  className="space-y-3"
                  exit="exit"
                  initial="hidden"
                  variants={staggerContainerVariants}
                >
                  <motion.div
                    className="flex items-end justify-between gap-4"
                    variants={contentFadeVariants}
                  >
                    <h2 className="text-[20px] leading-snug tracking-tight font-normal">
                      <span className="text-foreground">
                        {showArchivedSessions ? "Archived chats" : "Registered chats"}
                      </span>
                      <br />
                      <span className="text-foreground/60">
                        {showArchivedSessions
                          ? "stored separately from active hook controls"
                          : "and per-task mode controls"}
                      </span>
                    </h2>
                    <HeaderLink
                      onClick={() => {
                        setShowArchivedSessions((current) => !current);
                        setOpenActionsSessionId(null);
                      }}
                    >
                      {showArchivedSessions ? "Registered" : "Archived"}
                    </HeaderLink>
                  </motion.div>

                  <motion.div variants={contentFadeVariants}>
                    <Table className="border-collapse">
                      <TableHeader className="sr-only">
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Task</TableHead>
                          <TableHead>Last seen</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <motion.tbody
                        className="[&_tr:last-child]:border-b-0"
                        variants={rowStaggerVariants}
                      >
                        {sortedSessions.map((session, index) => {
                          const isSessionActive = session.effectivePreset !== null;
                          const selectedSessionPreset =
                            pendingSessionPresets[session.sessionId] ??
                            session.preset ??
                            session.effectivePreset ??
                            "infinite";
                          const sessionTimingLabel = showArchivedSessions
                            ? ""
                            : (() => {
                                const registeredLabel = formatSessionRelativeTime(
                                  session.firstSeenAt,
                                  now,
                                );
                                const activeLabel = session.activeSince
                                  ? formatSessionRelativeTime(session.activeSince, now).replace(
                                      / ago$/,
                                      "",
                                    )
                                  : "";

                                return isSessionActive
                                  ? activeLabel
                                    ? `Working for ${activeLabel}`
                                    : "Working"
                                  : registeredLabel
                                    ? `Registered ${registeredLabel}`
                                    : "";
                              })();

                          return (
                            <motion.tr
                              key={session.sessionId}
                              className={cn(
                                "border-b border-[#292929] hover:bg-transparent has-aria-expanded:bg-transparent",
                                index === 0 && "border-t border-[#292929]",
                              )}
                              variants={contentFadeVariants}
                            >
                              <TableCell className="w-0 pl-0 pr-3 py-3">
                                <ChatStatusIndicator active={isSessionActive} />
                              </TableCell>
                              <TableCell className="w-full min-w-0 px-0 py-3">
                                {getSessionPrompt(session) ? (
                                  <div className="flex min-w-0 items-center text-base">
                                    <span className="mr-3 shrink-0 text-sm text-foreground/50">
                                      [{sessionRefs.get(session.sessionId) ?? "C0"}]
                                    </span>
                                    <span className="block max-w-[400px] min-w-0 truncate text-foreground">
                                      {getSessionPrompt(session)}
                                    </span>
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell className="w-36 min-w-36 px-0 py-3 pr-6 whitespace-nowrap text-sm tabular-nums text-foreground/80">
                                {sessionTimingLabel ? (
                                  <SessionTimingText text={sessionTimingLabel} />
                                ) : null}
                              </TableCell>
                              <TableCell className="w-[1%] px-0 py-3 whitespace-nowrap">
                                <div className="flex items-center justify-end gap-2">
                                  {showArchivedSessions ? null : (
                                    <>
                                      <Select
                                        items={sessionPresetItems}
                                        onValueChange={(value) => {
                                          if (!value) {
                                            return;
                                          }

                                          const nextPreset = value as LoopPreset;
                                          if (
                                            nextPreset === "await-reply" &&
                                            !hasAttachedTelegramNotification(session)
                                          ) {
                                            showAwaitReplyNotificationToast(session);
                                            return;
                                          }

                                          setPendingSessionPresets((current) => ({
                                            ...current,
                                            [session.sessionId]: nextPreset,
                                          }));

                                          if (
                                            isSessionActive &&
                                            ((session.presetSource === "session" &&
                                              session.preset !== nextPreset) ||
                                              (session.presetSource !== "session" &&
                                                session.effectivePreset !== nextPreset))
                                          ) {
                                            void updateSessionPreset(session.sessionId, nextPreset);
                                          }
                                        }}
                                        value={selectedSessionPreset}
                                      >
                                        <SelectTrigger
                                          className="ml-auto w-44 bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
                                          size="sm"
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent align="end" className="w-44">
                                          <SelectGroup>
                                            <SelectLabel>Continuous</SelectLabel>
                                            <SelectItem value="infinite">Infinite</SelectItem>
                                            <SelectItem value="await-reply">Await Reply</SelectItem>
                                            <SelectItem value="completion-checks">
                                              Completion Checks
                                            </SelectItem>
                                          </SelectGroup>
                                          <SelectSeparator />
                                          <SelectGroup>
                                            <SelectLabel>Max Turns</SelectLabel>
                                            <SelectItem value="max-turns-1">Max Turns 1</SelectItem>
                                            <SelectItem value="max-turns-2">Max Turns 2</SelectItem>
                                            <SelectItem value="max-turns-3">Max Turns 3</SelectItem>
                                          </SelectGroup>
                                        </SelectContent>
                                      </Select>
                                      <Button
                                        aria-label={`${isSessionActive ? "Stop" : "Start"} preset for ${sessionRefs.get(session.sessionId) ?? "C0"}`}
                                        aria-pressed={isSessionActive}
                                        className="bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
                                        onClick={() => {
                                          void handleSessionPresetAction(session);
                                        }}
                                        size="icon-sm"
                                        type="button"
                                        variant="outline"
                                      >
                                        {isSessionActive ? (
                                          <Stop weight="fill" />
                                        ) : (
                                          <Play className="-ml-0.5" weight="fill" />
                                        )}
                                      </Button>
                                    </>
                                  )}
                                  {showArchivedSessions ? (
                                    <Button
                                      aria-label={`Unarchive ${sessionRefs.get(session.sessionId) ?? "C0"}`}
                                      className="bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
                                      onClick={() => {
                                        void updateSessionArchived(session.sessionId, false);
                                      }}
                                      size="sm"
                                      type="button"
                                      variant="outline"
                                    >
                                      Unarchive
                                    </Button>
                                  ) : null}
                                  <DropdownMenu
                                    open={openActionsSessionId === session.sessionId}
                                    onOpenChange={(open) => {
                                      setOpenActionsSessionId(open ? session.sessionId : null);
                                    }}
                                  >
                                    <DropdownMenuTrigger
                                      aria-label={`Open actions for ${sessionRefs.get(session.sessionId) ?? "C0"}`}
                                      className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-transparent shadow-xs transition-colors hover:bg-muted"
                                    >
                                      <DotsThreeVertical aria-hidden="true" weight="bold" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-58" align="end">
                                      {showArchivedSessions ? null : (
                                        <>
                                          <DropdownMenuGroup>
                                            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem
                                              checked={session.notificationIds.length === 0}
                                              onCheckedChange={() => {
                                                void handleSessionNotificationClear(
                                                  session.sessionId,
                                                );
                                                setOpenActionsSessionId(null);
                                              }}
                                            >
                                              None
                                            </DropdownMenuCheckboxItem>
                                            {notifications.map((notification) => (
                                              <DropdownMenuCheckboxItem
                                                key={notification.id}
                                                checked={session.notificationIds.includes(
                                                  notification.id,
                                                )}
                                                onCheckedChange={(checked) => {
                                                  void handleSessionNotificationToggle(
                                                    session,
                                                    notification.id,
                                                    Boolean(checked),
                                                  );
                                                  setOpenActionsSessionId(null);
                                                }}
                                              >
                                                {notification.label}
                                              </DropdownMenuCheckboxItem>
                                            ))}
                                          </DropdownMenuGroup>
                                          {selectedSessionPreset === "completion-checks" ? (
                                            <>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuGroup>
                                                <DropdownMenuLabel>
                                                  Completion Checks
                                                </DropdownMenuLabel>
                                                <DropdownMenuCheckboxItem
                                                  checked={session.completionCheckId === null}
                                                  onCheckedChange={() => {
                                                    void updateSessionCompletionCheckConfig(
                                                      session.sessionId,
                                                      null,
                                                      false,
                                                    );
                                                    setOpenActionsSessionId(null);
                                                  }}
                                                >
                                                  None
                                                </DropdownMenuCheckboxItem>
                                                {completionChecks.length === 0 ? (
                                                  <DropdownMenuItem disabled>
                                                    No checks available
                                                  </DropdownMenuItem>
                                                ) : (
                                                  completionChecks.map((completionCheck) => (
                                                    <DropdownMenuCheckboxItem
                                                      key={completionCheck.id}
                                                      checked={
                                                        session.completionCheckId ===
                                                        completionCheck.id
                                                      }
                                                      onCheckedChange={() => {
                                                        void updateSessionCompletionCheckConfig(
                                                          session.sessionId,
                                                          completionCheck.id,
                                                          session.completionCheckWaitForReply,
                                                        );
                                                        setOpenActionsSessionId(null);
                                                      }}
                                                    >
                                                      {completionCheck.label}
                                                    </DropdownMenuCheckboxItem>
                                                  ))
                                                )}
                                              </DropdownMenuGroup>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuGroup>
                                                <DropdownMenuCheckboxItem
                                                  checked={session.completionCheckWaitForReply}
                                                  disabled={session.completionCheckId === null}
                                                  onCheckedChange={(checked) => {
                                                    void updateSessionCompletionCheckConfig(
                                                      session.sessionId,
                                                      session.completionCheckId,
                                                      Boolean(checked),
                                                    );
                                                    setOpenActionsSessionId(null);
                                                  }}
                                                >
                                                  Wait for reply
                                                </DropdownMenuCheckboxItem>
                                              </DropdownMenuGroup>
                                              <DropdownMenuSeparator />
                                            </>
                                          ) : null}
                                        </>
                                      )}
                                      <DropdownMenuGroup>
                                        <DropdownMenuItem
                                          onClick={() => {
                                            if (showArchivedSessions) {
                                              void removeSession(session.sessionId);
                                            } else {
                                              void updateSessionArchived(session.sessionId, true);
                                            }
                                          }}
                                          variant={showArchivedSessions ? "destructive" : undefined}
                                        >
                                          {showArchivedSessions ? "Delete" : "Archive"}
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </motion.tr>
                          );
                        })}
                      </motion.tbody>
                    </Table>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
