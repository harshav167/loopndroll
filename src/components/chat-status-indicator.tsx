import { cn } from "@/lib/utils";

type ChatStatusIndicatorProps = {
  active?: boolean;
  className?: string;
};

export function ChatStatusIndicator({ active = false, className }: ChatStatusIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "chat-status-indicator",
        active
          ? "chat-status-indicator--fillsweep text-green-500"
          : "chat-status-indicator--diagsweep text-foreground/20",
        className,
      )}
    />
  );
}
