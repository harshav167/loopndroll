import type { CSSProperties, ReactNode } from "react";
import {
  ChatCircleDots,
  Checks,
  Infinity as InfinityIcon,
  Play,
  Stop,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ChatCardProps = {
  title?: ReactNode;
  marker?: ReactNode;
  markerContainerClassName?: string;
  tone?: string;
  isRunning?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  empty?: boolean;
  loading?: boolean;
  className?: string;
  titleClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  footerStart?: ReactNode;
};

export function ChatCard({
  title,
  marker,
  markerContainerClassName,
  tone,
  isRunning = false,
  actionLabel = "Start",
  onAction,
  empty = false,
  loading = false,
  className,
  titleClassName,
  contentClassName,
  footerClassName,
  footerStart,
}: ChatCardProps) {
  const placeholder = loading || empty;
  const tinted = Boolean(tone);
  const cardStyle: CSSProperties | undefined = tinted
    ? {
        backgroundColor: tone,
        color: "oklch(0.205 0 0)",
        borderColor: `color-mix(in oklch, ${tone} 78%, black)`,
      }
    : undefined;
  const footerStyle: CSSProperties | undefined = tinted
    ? {
        backgroundColor: `color-mix(in oklch, ${tone} 80%, black)`,
        borderTopColor: `color-mix(in oklch, ${tone} 72%, black)`,
      }
    : undefined;

  return (
    <Card
      aria-busy={loading || undefined}
      aria-hidden={empty || undefined}
      className={cn(
        "size-80 shrink-0 snap-start pb-0",
        isRunning && "outline outline-1 -outline-offset-1 outline-green-500/50",
        placeholder && "relative gap-0 overflow-hidden py-0",
        className,
      )}
      style={cardStyle}
    >
      <CardContent
        className={cn("flex flex-1 items-start", placeholder && "p-0", contentClassName)}
      >
        {placeholder ? (
          <Skeleton className="size-full rounded-[inherit] bg-white/[0.03]" />
        ) : (
          <div className="flex flex-col items-start gap-5">
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-full",
                tinted
                  ? "border border-black/10 bg-black/6 text-inherit"
                  : "border border-white/10 bg-white/4 text-foreground",
                markerContainerClassName,
              )}
            >
              {marker}
            </div>
            <CardTitle
              className={cn("text-xl leading-snug tracking-normal font-normal", titleClassName)}
            >
              {title}
            </CardTitle>
          </div>
        )}
      </CardContent>

      {!placeholder ? (
        <CardFooter
          className={cn(
            "mt-auto justify-between gap-3 border-t bg-muted/50 px-4 pb-4 [.border-t]:pt-4",
            footerClassName,
          )}
          style={footerStyle}
        >
          <div className="min-h-8 min-w-0">{footerStart}</div>
          <Button
            aria-pressed={isRunning}
            onClick={onAction}
            className={cn(
              "w-20 gap-1.5",
              tinted && "border-black/10 bg-white/35 text-black shadow-none hover:bg-white/45",
            )}
            size="sm"
            type="button"
            variant="outline"
          >
            {isRunning ? (
              <Stop data-icon="inline-start" weight="fill" />
            ) : (
              <Play data-icon="inline-start" weight="fill" />
            )}
            {isRunning ? "Stop" : actionLabel}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function InfiniteCardIcon() {
  return <InfinityIcon aria-hidden="true" size={32} weight="regular" />;
}

export function AwaitReplyCardIcon() {
  return <ChatCircleDots aria-hidden="true" size={28} weight="regular" />;
}

export function CompletionChecksCardIcon() {
  return <Checks aria-hidden="true" size={28} weight="regular" />;
}

type TurnCountMarkerProps = {
  value: 1 | 2 | 3;
  className?: string;
};

export function TurnCountMarker({ value, className }: TurnCountMarkerProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("text-2xl leading-none tracking-tight font-medium", className)}
    >
      {value}
    </span>
  );
}
