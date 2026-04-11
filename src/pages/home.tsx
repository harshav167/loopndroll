import type { ReactNode } from "react";
import { Trash } from "@phosphor-icons/react";
import { ChatCard, InfiniteCardIcon, TurnCountMarker } from "@/components/chat-card";
import type { LoopPreset, LoopSession } from "@/lib/loopndroll";
import { useLoopndrollState } from "@/lib/use-loopndroll-state";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
}: {
  activePreset: LoopPreset | null;
  onToggle: (preset: LoopPreset) => void;
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
            title={item.title}
          />
        ))}
      </div>
    </div>
  );
}

function getSessionPrompt(session: LoopSession) {
  return session.title?.trim() || null;
}

function getSessionNumber(session: LoopSession, fallbackNumber: number) {
  const codexNumber = /^\d+$/.test(session.sessionId)
    ? Number.parseInt(session.sessionId, 10)
    : undefined;
  return typeof codexNumber === "number" && Number.isSafeInteger(codexNumber) && codexNumber > 0
    ? codexNumber
    : fallbackNumber;
}

export function HomeRoute() {
  const {
    errorMessage,
    isLoading,
    removeSession,
    snapshot,
    updateGlobalPreset,
    updateScope,
    updateSessionPreset,
  } = useLoopndrollState();

  const activeTab = snapshot?.scope ?? "global";
  const sessions = snapshot?.sessions ?? [];
  const hasRegisteredChats = sessions.length > 0;
  const sessionNumbers = new Map(
    [...sessions]
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
      .map((session, index) => [session.sessionId, getSessionNumber(session, index + 1)]),
  );

  return (
    <section aria-label="Home" className="min-h-full min-w-0 overflow-hidden px-16 pt-16">
      <div className="flex min-w-0 w-full flex-col gap-8">
        <h1 className="text-2xl leading-snug tracking-tight font-normal">
          Start with a global hook configuration,
          <br />
          or customize hooks separately for every task
        </h1>

        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

        <Tabs
          className="min-w-0 gap-6"
          onValueChange={(value) => {
            if (value === "global" || value === "per-task") {
              void updateScope(value);
            }
          }}
          value={activeTab}
        >
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="per-task">Per task</TabsTrigger>
          </TabsList>

          <TabsContent value="global">
            <ChatCardRail
              activePreset={snapshot?.globalPreset ?? null}
              onToggle={(preset) => {
                const nextPreset = snapshot?.globalPreset === preset ? null : preset;
                void updateGlobalPreset(nextPreset);
              }}
            />
          </TabsContent>

          <TabsContent className="flex flex-col gap-4" value="per-task">
            {!hasRegisteredChats ? (
              <>
                <div className="-mx-16 min-w-0 overflow-hidden">
                  <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pl-16 pr-16 pt-1 pb-3 [scroll-padding-left:4rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    <ChatCard empty loading={isLoading || !snapshot} />
                    <ChatCard empty loading={isLoading || !snapshot} />
                    <ChatCard empty loading={isLoading || !snapshot} />
                    <ChatCard empty loading={isLoading || !snapshot} />
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  Start a chat in Codex so they appear here.
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-8">
                {sessions.map((session) => (
                  <div key={session.sessionId} className="space-y-3">
                    <ChatCardRail
                      activePreset={session.preset}
                      onToggle={(preset) => {
                        const nextPreset = session.preset === preset ? null : preset;
                        void updateSessionPreset(session.sessionId, nextPreset);
                      }}
                    />

                    <div>
                      <div className="group flex items-center gap-2 text-base text-foreground">
                        <p className="text-base text-muted-foreground">
                          #{sessionNumbers.get(session.sessionId) ?? 0} -
                        </p>
                        {getSessionPrompt(session) ? (
                          <p className="max-w-[200px] truncate">{getSessionPrompt(session)}</p>
                        ) : null}
                        <Button
                          aria-label={`Delete chat ${sessionNumbers.get(session.sessionId) ?? 0}`}
                          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => {
                            void removeSession(session.sessionId);
                          }}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Trash aria-hidden="true" weight="regular" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
