import type { ReactNode } from "react";
import { Play } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardTitle } from "@/components/ui/card";

type ChatCardProps = {
  title?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  empty?: boolean;
  className?: string;
  titleClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
};

export function ChatCard({
  title,
  actionLabel = "Start",
  onAction,
  empty = false,
  className,
  titleClassName,
  contentClassName,
  footerClassName,
}: ChatCardProps) {
  return (
    <Card aria-hidden={empty || undefined} className={cn("size-80 shrink-0 pb-0", className)}>
      <CardContent className={cn("flex flex-1 items-start", contentClassName)}>
        {!empty ? (
          <CardTitle
            className={cn("text-xl leading-snug tracking-normal font-normal", titleClassName)}
          >
            {title}
          </CardTitle>
        ) : null}
      </CardContent>

      {!empty ? (
        <CardFooter
          className={cn(
            "mt-auto justify-end border-t bg-muted/50 px-4 pb-4 [.border-t]:pt-4",
            footerClassName,
          )}
        >
          <Button onClick={onAction} className="gap-1.5" size="sm" type="button" variant="outline">
            <Play data-icon="inline-start" weight="regular" />
            {actionLabel}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
