import { ChatCard, InfiniteCardIcon, TurnCountMarker } from "@/components/chat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function HomeRoute() {
  return (
    <section aria-label="Home" className="min-h-full min-w-0 overflow-hidden px-16 pt-28">
      <div className="flex min-w-0 w-full flex-col gap-8">
        <h1 className="text-2xl leading-snug tracking-tight font-normal">
          Start with a global hook configuration,
          <br />
          or customize hooks separately for every task
        </h1>

        <Tabs className="min-w-0 gap-6" defaultValue="global">
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="per-task">Per task</TabsTrigger>
          </TabsList>

          <TabsContent value="global">
            <div className="-mx-16 min-w-0 overflow-hidden">
              <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pl-16 pr-16 pb-3 [scroll-padding-left:4rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <ChatCard marker={<InfiniteCardIcon />} title="Infinite" />
                <ChatCard marker={<TurnCountMarker value={1} />} title="Max Turns" />
                <ChatCard marker={<TurnCountMarker value={2} />} title="Max Turns" />
                <ChatCard marker={<TurnCountMarker value={3} />} title="Max Turns" />
              </div>
            </div>
          </TabsContent>

          <TabsContent className="flex flex-col gap-4" value="per-task">
            <div className="-mx-16 min-w-0 overflow-hidden">
              <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pl-16 pr-16 pb-3 [scroll-padding-left:4rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <ChatCard loading />
                <ChatCard loading />
                <ChatCard loading />
                <ChatCard loading />
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Start a chat in Codex so they appear here.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
