import { ChatCard } from "@/components/chat-card";

export function HomeRoute() {
  return (
    <section aria-label="Home" className="flex min-h-full items-center px-16">
      <div className="-translate-y-7 flex flex-col gap-8">
        <h1 className="text-2xl leading-snug tracking-tight font-normal">
          Start a chat in Codex
          <br />
          or set global defaults
        </h1>

        <div className="flex gap-6 overflow-x-auto pb-1">
          <ChatCard title="Global defaults" />
          <ChatCard empty />
          <ChatCard empty />
        </div>
      </div>
    </section>
  );
}
