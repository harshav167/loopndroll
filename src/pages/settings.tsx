import { ArrowLeft, DotsThree, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod/v4";
import {
  type CompletionCheck,
  getTelegramChats,
  revealHooksFile,
  type LoopNotification,
  type TelegramChatOption,
} from "@/lib/loopndroll";
import { useLoopndrollState } from "@/lib/use-loopndroll-state";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const settingsSchema = z.object({
  defaultPrompt: z
    .string()
    .trim()
    .min(1, "Default prompt is required.")
    .max(500, "Default prompt must be 500 characters or fewer."),
});

const notificationSchema = z
  .object({
    label: z.string(),
    channel: z.enum(["slack", "telegram"]),
    webhookUrl: z.string(),
    botToken: z.string(),
    telegramChatId: z.string(),
    telegramChatUsername: z.string(),
    telegramChatDisplayName: z.string(),
  })
  .superRefine((values, context) => {
    if (values.channel === "slack") {
      if (values.webhookUrl.trim().length === 0) {
        context.addIssue({
          code: "custom",
          message: "Webhook URL is required.",
          path: ["webhookUrl"],
        });
        return;
      }

      if (!z.string().url().safeParse(values.webhookUrl.trim()).success) {
        context.addIssue({
          code: "custom",
          message: "Webhook URL must be a valid URL.",
          path: ["webhookUrl"],
        });
      }

      return;
    }

    if (values.botToken.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "API token is required.",
        path: ["botToken"],
      });
    }

    if (values.telegramChatId.trim().length === 0) {
      context.addIssue({
        code: "custom",
        message: "Select a Telegram chat.",
        path: ["telegramChatId"],
      });
    }
  });

const completionCheckSchema = z.object({
  label: z.string(),
  commandsText: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => value.split(/\r?\n/).some((line) => line.trim().length > 0),
      "At least one command is required.",
    ),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;
type NotificationFormValues = z.infer<typeof notificationSchema>;
type CompletionCheckFormValues = z.input<typeof completionCheckSchema>;

const notificationChannelItems = [
  { label: "Slack", value: "slack" },
  { label: "Telegram", value: "telegram" },
] as const;

const settingsSectionCardClassName = "gap-6 pt-5 pb-0 shadow-sm";
const settingsSectionFooterClassName =
  "flex items-center justify-between border-t gap-4 pb-4 [.border-t]:pt-4";

type TelegramChatItem = TelegramChatOption & {
  value: string;
  label: string;
  primaryLabel: string;
};

function getNotificationChannelLabel(notification: LoopNotification) {
  return notification.channel === "slack" ? "Slack" : "Telegram";
}

function toTelegramChatItem(chat: TelegramChatOption): TelegramChatItem {
  const primaryLabel =
    chat.kind === "dm"
      ? chat.username
        ? `@${chat.username}`
        : chat.displayName
      : chat.displayName || (chat.username ? `@${chat.username}` : "Unknown chat");

  return {
    ...chat,
    value: chat.chatId,
    label: primaryLabel,
    primaryLabel,
  };
}

function mergeTelegramChats(
  currentChats: TelegramChatOption[],
  nextChats: TelegramChatOption[],
): TelegramChatOption[] {
  const mergedChats = new Map<string, TelegramChatOption>();

  for (const chat of currentChats) {
    mergedChats.set(chat.chatId, chat);
  }

  for (const chat of nextChats) {
    mergedChats.set(chat.chatId, chat);
  }

  return [...mergedChats.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function inferTelegramChatKind(chatId: string): TelegramChatOption["kind"] {
  return chatId.trim().startsWith("-") ? "group" : "dm";
}

function parseCommandsText(commandsText: string) {
  return commandsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const {
    addCompletionCheck,
    errorMessage,
    isLoading,
    snapshot,
    addNotification,
    editCompletionCheck,
    editNotification,
    installHooks,
    removeCompletionCheck,
    removeNotification,
    savePrompt,
    uninstallHooks,
  } = useLoopndrollState();
  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);
  const [isCompletionCheckDialogOpen, setIsCompletionCheckDialogOpen] = useState(false);
  const [editingNotificationId, setEditingNotificationId] = useState<string | null>(null);
  const [editingCompletionCheckId, setEditingCompletionCheckId] = useState<string | null>(null);
  const [telegramChats, setTelegramChats] = useState<TelegramChatOption[]>([]);
  const [isLoadingTelegramChats, setIsLoadingTelegramChats] = useState(false);
  const [telegramChatsError, setTelegramChatsError] = useState<string | null>(null);
  const form = useForm<SettingsFormValues>({
    defaultValues: {
      defaultPrompt: "Keep working on the task. Do not finish yet.",
    },
    mode: "onChange",
  });
  const notificationForm = useForm<NotificationFormValues>({
    defaultValues: {
      label: "",
      channel: "slack",
      webhookUrl: "",
      botToken: "",
      telegramChatId: "",
      telegramChatUsername: "",
      telegramChatDisplayName: "",
    },
    mode: "onChange",
  });
  const completionCheckForm = useForm<CompletionCheckFormValues>({
    defaultValues: {
      label: "",
      commandsText: "",
    },
    mode: "onChange",
  });

  const defaultPromptError = form.formState.errors.defaultPrompt?.message;
  const notificationChannel = notificationForm.watch("channel");
  const notificationBotToken = notificationForm.watch("botToken");
  const notificationTelegramChatId = notificationForm.watch("telegramChatId");
  const notificationTelegramChatUsername = notificationForm.watch("telegramChatUsername");
  const notificationTelegramChatDisplayName = notificationForm.watch("telegramChatDisplayName");
  const notificationWebhookUrlError = notificationForm.formState.errors.webhookUrl?.message;
  const notificationBotTokenError = notificationForm.formState.errors.botToken?.message;
  const notificationTelegramChatIdError = notificationForm.formState.errors.telegramChatId?.message;
  const completionCheckCommandsError = completionCheckForm.formState.errors.commandsText?.message;
  const normalizedNotificationBotToken = notificationBotToken.trim();

  const saveDefaultPrompt = form.handleSubmit((values) => {
    return savePrompt(values.defaultPrompt).then(() => {
      form.reset({ defaultPrompt: values.defaultPrompt });
    });
  });
  const saveNotification = notificationForm.handleSubmit(async (values) => {
    const parsed = notificationSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0];
        if (typeof fieldName === "string") {
          notificationForm.setError(fieldName as keyof NotificationFormValues, {
            message: issue.message,
          });
        }
      }
      return;
    }

    if (editingNotificationId) {
      if (values.channel === "slack") {
        await editNotification({
          id: editingNotificationId,
          label: values.label.trim(),
          channel: "slack",
          webhookUrl: values.webhookUrl.trim(),
        });
      } else {
        await editNotification({
          id: editingNotificationId,
          label: values.label.trim(),
          channel: "telegram",
          chatId: values.telegramChatId.trim(),
          botToken: values.botToken.trim(),
          chatUsername: values.telegramChatUsername.trim() || null,
          chatDisplayName: values.telegramChatDisplayName.trim() || null,
        });
      }
    } else {
      if (values.channel === "slack") {
        await addNotification({
          label: values.label.trim(),
          channel: "slack",
          webhookUrl: values.webhookUrl.trim(),
        });
      } else {
        await addNotification({
          label: values.label.trim(),
          channel: "telegram",
          chatId: values.telegramChatId.trim(),
          botToken: values.botToken.trim(),
          chatUsername: values.telegramChatUsername.trim() || null,
          chatDisplayName: values.telegramChatDisplayName.trim() || null,
        });
      }
    }

    notificationForm.reset({
      label: "",
      channel: "slack",
      webhookUrl: "",
      botToken: "",
      telegramChatId: "",
      telegramChatUsername: "",
      telegramChatDisplayName: "",
    });
    setEditingNotificationId(null);
    setIsNotificationDialogOpen(false);
  });
  const saveCompletionCheck = completionCheckForm.handleSubmit(async (values) => {
    const parsed = completionCheckSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0];
        if (typeof fieldName === "string") {
          completionCheckForm.setError(fieldName as keyof CompletionCheckFormValues, {
            message: issue.message,
          });
        }
      }
      return;
    }

    const commands = parseCommandsText(values.commandsText);
    if (editingCompletionCheckId) {
      await editCompletionCheck({
        id: editingCompletionCheckId,
        label: values.label.trim(),
        commands,
      });
    } else {
      await addCompletionCheck({
        label: values.label.trim(),
        commands,
      });
    }

    completionCheckForm.reset({
      label: "",
      commandsText: "",
    });
    setEditingCompletionCheckId(null);
    setIsCompletionCheckDialogOpen(false);
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  };

  useEffect(() => {
    if (!snapshot || form.formState.isDirty) {
      return;
    }

    form.reset({
      defaultPrompt: snapshot.defaultPrompt,
    });
  }, [form, form.formState.isDirty, snapshot]);

  useEffect(() => {
    if (!isNotificationDialogOpen) {
      notificationForm.reset({
        label: "",
        channel: "slack",
        webhookUrl: "",
        botToken: "",
        telegramChatId: "",
        telegramChatUsername: "",
        telegramChatDisplayName: "",
      });
      setEditingNotificationId(null);
      setTelegramChats([]);
      setTelegramChatsError(null);
      setIsLoadingTelegramChats(false);
    }
  }, [isNotificationDialogOpen, notificationForm]);

  useEffect(() => {
    if (!isCompletionCheckDialogOpen) {
      completionCheckForm.reset({
        label: "",
        commandsText: "",
      });
      setEditingCompletionCheckId(null);
    }
  }, [completionCheckForm, isCompletionCheckDialogOpen]);

  useEffect(() => {
    if (!isNotificationDialogOpen || notificationChannel !== "telegram") {
      return;
    }

    if (normalizedNotificationBotToken.length === 0) {
      setTelegramChats([]);
      setTelegramChatsError(null);
      setIsLoadingTelegramChats(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsLoadingTelegramChats(true);
      setTelegramChatsError(null);

      void getTelegramChats(normalizedNotificationBotToken)
        .then((chats) => {
          if (!cancelled) {
            setTelegramChats(chats);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setTelegramChatsError(
              error instanceof Error ? error.message : "Failed to load Telegram chats.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoadingTelegramChats(false);
          }
        });

      const runLongPoll = async () => {
        while (!cancelled) {
          try {
            const chats = await getTelegramChats(normalizedNotificationBotToken, true);
            if (cancelled) {
              return;
            }

            setTelegramChats((current) => mergeTelegramChats(current, chats));
            setTelegramChatsError(null);
          } catch (error) {
            if (!cancelled) {
              setTelegramChatsError(
                error instanceof Error ? error.message : "Failed to load Telegram chats.",
              );
            }
            return;
          } finally {
            if (!cancelled) {
              setIsLoadingTelegramChats(false);
            }
          }
        }
      };

      void runLongPoll();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isNotificationDialogOpen, normalizedNotificationBotToken, notificationChannel]);

  const hasResolvedHookState = !isLoading && snapshot !== null;
  const hooksDetected = snapshot?.health.registered ?? false;
  const notifications = snapshot?.notifications ?? [];
  const completionChecks = snapshot?.completionChecks ?? [];
  const telegramChatItems = telegramChats.map(toTelegramChatItem);
  const hasSelectedTelegramChat =
    notificationTelegramChatId.trim().length > 0 &&
    !telegramChatItems.some((chat) => chat.chatId === notificationTelegramChatId.trim());
  const selectedTelegramChat =
    (hasSelectedTelegramChat
      ? [
          {
            chatId: notificationTelegramChatId.trim(),
            kind: inferTelegramChatKind(notificationTelegramChatId),
            username: notificationTelegramChatUsername.trim() || null,
            displayName: notificationTelegramChatDisplayName.trim() || "Selected chat",
          },
          ...telegramChats,
        ]
      : telegramChats
    )
      .map(toTelegramChatItem)
      .find((chat) => chat.chatId === notificationTelegramChatId.trim()) ?? null;

  function openCreateNotificationDialog() {
    setEditingNotificationId(null);
    notificationForm.reset({
      label: "",
      channel: "slack",
      webhookUrl: "",
      botToken: "",
      telegramChatId: "",
      telegramChatUsername: "",
      telegramChatDisplayName: "",
    });
    setTelegramChats([]);
    setTelegramChatsError(null);
    setIsNotificationDialogOpen(true);
  }

  function openCreateCompletionCheckDialog() {
    setEditingCompletionCheckId(null);
    completionCheckForm.reset({
      label: "",
      commandsText: "",
    });
    setIsCompletionCheckDialogOpen(true);
  }

  function openEditNotificationDialog(notification: LoopNotification) {
    setEditingNotificationId(notification.id);
    if (notification.channel === "slack") {
      notificationForm.reset({
        label: notification.label,
        channel: "slack",
        webhookUrl: notification.webhookUrl,
        botToken: "",
        telegramChatId: "",
        telegramChatUsername: "",
        telegramChatDisplayName: "",
      });
    } else {
      notificationForm.reset({
        label: notification.label,
        channel: "telegram",
        webhookUrl: "",
        botToken: notification.botToken,
        telegramChatId: notification.chatId,
        telegramChatUsername: notification.chatUsername ?? "",
        telegramChatDisplayName: notification.chatDisplayName ?? "",
      });
    }
    setTelegramChats([]);
    setTelegramChatsError(null);
    setIsNotificationDialogOpen(true);
  }

  function openEditCompletionCheckDialog(completionCheck: CompletionCheck) {
    setEditingCompletionCheckId(completionCheck.id);
    completionCheckForm.reset({
      label: completionCheck.label,
      commandsText: completionCheck.commands.join("\n"),
    });
    setIsCompletionCheckDialogOpen(true);
  }

  return (
    <>
      <Dialog open={isNotificationDialogOpen} onOpenChange={setIsNotificationDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form className="grid gap-6" onSubmit={saveNotification}>
            <DialogHeader>
              <DialogTitle>
                {editingNotificationId ? "Edit Notification" : "Add Notification"}
              </DialogTitle>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldContent>
                  <FieldLabel htmlFor="notification-label">Label</FieldLabel>
                  <Input
                    id="notification-label"
                    placeholder={notificationChannel === "slack" ? "Slack" : "Telegram"}
                    {...notificationForm.register("label")}
                  />
                </FieldContent>
              </Field>
              <Field>
                <FieldContent>
                  <FieldLabel htmlFor="notification-channel">Channel</FieldLabel>
                  <Controller
                    control={notificationForm.control}
                    name="channel"
                    render={({ field }) => (
                      <Select
                        items={notificationChannelItems}
                        onValueChange={(value) => {
                          if (!value) {
                            return;
                          }

                          notificationForm.clearErrors();
                          field.onChange(value);
                        }}
                        value={field.value}
                      >
                        <SelectTrigger className="w-full" id="notification-channel">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="slack">Slack</SelectItem>
                            <SelectItem value="telegram">Telegram</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FieldContent>
              </Field>

              {notificationChannel === "slack" ? (
                <Field data-invalid={Boolean(notificationWebhookUrlError)}>
                  <FieldContent>
                    <FieldLabel htmlFor="notification-webhook-url">Webhook URL</FieldLabel>
                    <Input
                      aria-invalid={Boolean(notificationWebhookUrlError)}
                      id="notification-webhook-url"
                      placeholder="https://hooks.slack.com/services/..."
                      {...notificationForm.register("webhookUrl")}
                    />
                    {notificationWebhookUrlError ? (
                      <FieldError>{notificationWebhookUrlError}</FieldError>
                    ) : null}
                  </FieldContent>
                </Field>
              ) : (
                <>
                  <Field data-invalid={Boolean(notificationBotTokenError)}>
                    <FieldContent>
                      <FieldLabel htmlFor="notification-bot-token">API Token</FieldLabel>
                      <Input
                        aria-invalid={Boolean(notificationBotTokenError)}
                        id="notification-bot-token"
                        placeholder="123456789:AA..."
                        {...notificationForm.register("botToken", {
                          onChange: () => {
                            notificationForm.setValue("telegramChatId", "");
                            notificationForm.setValue("telegramChatUsername", "");
                            notificationForm.setValue("telegramChatDisplayName", "");
                            setTelegramChats([]);
                            setTelegramChatsError(null);
                          },
                        })}
                      />
                      <FieldDescription>
                        <a
                          className="text-blue-400 transition-colors hover:text-blue-300"
                          href="https://t.me/BotFather"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Where do I find this?
                        </a>
                      </FieldDescription>
                      {notificationBotTokenError ? (
                        <FieldError>{notificationBotTokenError}</FieldError>
                      ) : null}
                    </FieldContent>
                  </Field>

                  <Field
                    data-invalid={Boolean(notificationTelegramChatIdError || telegramChatsError)}
                  >
                    <FieldContent>
                      <FieldLabel htmlFor="notification-telegram-chat">Chat</FieldLabel>
                      <Combobox
                        items={
                          hasSelectedTelegramChat
                            ? [selectedTelegramChat!, ...telegramChatItems]
                            : telegramChatItems
                        }
                        isItemEqualToValue={(item, value) => item.value === value.value}
                        itemToStringLabel={(item) => item.label}
                        itemToStringValue={(item) => item.value}
                        onValueChange={(chat) => {
                          notificationForm.setValue("telegramChatId", chat?.chatId ?? "", {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          notificationForm.setValue("telegramChatUsername", chat?.username ?? "", {
                            shouldDirty: true,
                          });
                          notificationForm.setValue(
                            "telegramChatDisplayName",
                            chat?.displayName ?? "",
                            {
                              shouldDirty: true,
                            },
                          );
                          notificationForm.clearErrors("telegramChatId");
                        }}
                        value={selectedTelegramChat}
                      >
                        <ComboboxInput
                          disabled={
                            normalizedNotificationBotToken.length === 0 || isLoadingTelegramChats
                          }
                          placeholder={
                            normalizedNotificationBotToken.length === 0
                              ? "Enter token first"
                              : isLoadingTelegramChats
                                ? "Loading chats..."
                                : "Search chats"
                          }
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>
                            {telegramChatsError
                              ? "Unable to load chats"
                              : normalizedNotificationBotToken.length === 0
                                ? "Enter a token to load chats"
                                : isLoadingTelegramChats
                                  ? "Loading chats..."
                                  : "No chats found"}
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(chat) => (
                              <ComboboxItem key={chat.value} value={chat}>
                                <span className="truncate font-medium">{chat.primaryLabel}</span>
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      <FieldDescription>
                        Send a message in the chat with the bot, and it will appear here.
                      </FieldDescription>
                      {telegramChatsError ? (
                        <FieldError>{telegramChatsError}</FieldError>
                      ) : notificationTelegramChatIdError ? (
                        <FieldError>{notificationTelegramChatIdError}</FieldError>
                      ) : null}
                    </FieldContent>
                  </Field>
                </>
              )}
            </FieldGroup>
            <DialogFooter className="-mx-6 -mb-6 mt-2 border-t bg-muted/50 px-6 py-4 sm:justify-end">
              <DialogClose asChild>
                <Button size="sm" type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button size="sm" type="submit">
                {editingNotificationId ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isCompletionCheckDialogOpen} onOpenChange={setIsCompletionCheckDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <form className="grid gap-6" onSubmit={saveCompletionCheck}>
            <DialogHeader>
              <DialogTitle>
                {editingCompletionCheckId ? "Edit Completion Check" : "Add Completion Check"}
              </DialogTitle>
              <DialogDescription>
                Create reusable command groups that Completion checks mode runs before Codex is
                allowed to finish.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldContent>
                  <FieldLabel htmlFor="completion-check-label">Name</FieldLabel>
                  <Input
                    id="completion-check-label"
                    placeholder="Frontend checks"
                    {...completionCheckForm.register("label")}
                  />
                </FieldContent>
              </Field>
              <Field data-invalid={Boolean(completionCheckCommandsError)}>
                <FieldContent>
                  <FieldLabel htmlFor="completion-check-commands">Commands</FieldLabel>
                  <Textarea
                    aria-invalid={Boolean(completionCheckCommandsError)}
                    className="min-h-40 bg-input px-3 py-2.5 tracking-tight focus-visible:bg-background"
                    id="completion-check-commands"
                    placeholder={"pnpm lint\npnpm test"}
                    rows={7}
                    {...completionCheckForm.register("commandsText", {
                      validate: (value) => {
                        const result = completionCheckSchema.shape.commandsText.safeParse(value);
                        return result.success || result.error.issues[0]?.message;
                      },
                    })}
                  />
                  <FieldDescription>
                    Enter one shell command per line. Commands run sequentially and stop on the
                    first failure.
                  </FieldDescription>
                  {completionCheckCommandsError ? (
                    <FieldError>{completionCheckCommandsError}</FieldError>
                  ) : null}
                </FieldContent>
              </Field>
            </FieldGroup>
            <DialogFooter className="-mx-6 -mb-6 mt-2 border-t bg-muted/50 px-6 py-4 sm:justify-end">
              <DialogClose asChild>
                <Button size="sm" type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button size="sm" type="submit">
                {editingCompletionCheckId ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section aria-label="Settings" className="relative px-4 pt-16 pb-32 md:px-6">
        <div className="fixed top-16 left-4 z-20">
          <Button
            aria-label="Go back"
            onClick={handleBack}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ArrowLeft weight="regular" />
          </Button>
        </div>
        <div className="mx-auto flex w-full max-w-[816px] flex-col gap-6">
          <div className="space-y-0.5">
            <h1 className="text-4xl leading-tight font-semibold tracking-[-0.03em] text-[#fafafa]">
              Settings
            </h1>
          </div>

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

          <div className="space-y-5">
            <Card className={settingsSectionCardClassName}>
              <CardHeader>
                <CardTitle className="font-semibold">Continue prompt</CardTitle>
                <CardDescription className="leading-normal">
                  Sent to Codex when completion is blocked, so the task continues instead of
                  stopping.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form
                    className="space-y-8"
                    id="default-prompt-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveDefaultPrompt();
                    }}
                  >
                    <Field data-invalid={Boolean(defaultPromptError)}>
                      <FieldContent>
                        <FieldLabel className="sr-only" htmlFor="default-prompt">
                          Prompt
                        </FieldLabel>
                        <Textarea
                          aria-invalid={Boolean(defaultPromptError)}
                          className="min-h-28 max-w-[496px] bg-input px-3 py-2.5 tracking-tight focus-visible:bg-background"
                          id="default-prompt"
                          rows={4}
                          {...form.register("defaultPrompt", {
                            validate: (value) => {
                              const result = settingsSchema.shape.defaultPrompt.safeParse(value);
                              return result.success || result.error.issues[0]?.message;
                            },
                          })}
                        />
                        {defaultPromptError ? <FieldError>{defaultPromptError}</FieldError> : null}
                      </FieldContent>
                    </Field>
                  </form>
                </FieldGroup>
              </CardContent>
              <CardFooter className={`${settingsSectionFooterClassName} justify-end`}>
                <Button form="default-prompt-form" size="sm" type="submit">
                  Save
                </Button>
              </CardFooter>
            </Card>

            <Card className={settingsSectionCardClassName}>
              <CardHeader>
                <CardTitle className="font-semibold">Notifications</CardTitle>
                <CardDescription className="leading-normal">
                  When Codex stops, send its final reply to connected channel.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {notifications.length === 0 ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">No notifications yet</p>
                      <p className="text-sm text-muted-foreground">
                        Add a Slack or Telegram destination for Stop-event delivery.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Table>
                    <TableBody>
                      {notifications.map((notification) => (
                        <TableRow key={notification.id} className="hover:bg-transparent">
                          <TableCell className="pl-0 font-medium">{notification.label}</TableCell>
                          <TableCell className="pr-0 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label={`Open actions for ${getNotificationChannelLabel(notification)} notification`}
                                className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
                              >
                                <DotsThree aria-hidden="true" weight="bold" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      openEditNotificationDialog(notification);
                                    }}
                                  >
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      void removeNotification(notification.id);
                                    }}
                                    variant="destructive"
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              <CardFooter className={`${settingsSectionFooterClassName} gap-2`}>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span>Learn more in the </span>
                  <a
                    className="text-blue-400 transition-colors hover:text-blue-300"
                    href="https://github.com/lnikell/loopndroll?tab=readme-ov-file#telegram-commands"
                    rel="noreferrer"
                    target="_blank"
                  >
                    documentation
                  </a>
                </div>

                <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
                  <Button
                    onClick={() => {
                      openCreateNotificationDialog();
                    }}
                    size="sm"
                    type="button"
                  >
                    <Plus weight="bold" />
                    Add Notification
                  </Button>
                </div>
              </CardFooter>
            </Card>

            <Card className={settingsSectionCardClassName}>
              <CardHeader>
                <CardTitle className="font-semibold">Completion Checks</CardTitle>
                <CardDescription className="leading-normal">
                  Register reusable command groups that Completion checks mode can run before a chat
                  is allowed to finish.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {completionChecks.length === 0 ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        No completion checks yet
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Add named command groups, then attach one from the Completion checks card on
                        Home.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Table>
                    <TableBody>
                      {completionChecks.map((completionCheck) => (
                        <TableRow key={completionCheck.id} className="hover:bg-transparent">
                          <TableCell className="pl-0">
                            <div className="space-y-0.5">
                              <p className="font-medium">{completionCheck.label}</p>
                              <p className="text-sm text-muted-foreground">
                                {completionCheck.commands.length}{" "}
                                {completionCheck.commands.length === 1 ? "command" : "commands"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="pr-0 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label={`Open actions for ${completionCheck.label}`}
                                className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
                              >
                                <DotsThree aria-hidden="true" weight="bold" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      openEditCompletionCheckDialog(completionCheck);
                                    }}
                                  >
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      void removeCompletionCheck(completionCheck.id);
                                    }}
                                    variant="destructive"
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              <CardFooter className={`${settingsSectionFooterClassName} gap-2`}>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span>Learn more in the </span>
                  <a
                    className="text-blue-400 transition-colors hover:text-blue-300"
                    href="https://github.com/lnikell/loopndroll?tab=readme-ov-file#4-completion-checks"
                    rel="noreferrer"
                    target="_blank"
                  >
                    documentation
                  </a>
                </div>

                <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
                  <Button
                    onClick={() => {
                      openCreateCompletionCheckDialog();
                    }}
                    size="sm"
                    type="button"
                  >
                    <Plus weight="bold" />
                    Add Check
                  </Button>
                </div>
              </CardFooter>
            </Card>

            <Card className={settingsSectionCardClassName}>
              <CardHeader>
                <CardTitle className="font-semibold">Hook Registration</CardTitle>
                <CardDescription className="leading-normal">
                  Register hooks when they are missing, or clear the current registration state.
                </CardDescription>
              </CardHeader>
              <CardContent />
              <CardFooter className={`${settingsSectionFooterClassName} gap-2`}>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span>Open</span>
                  <button
                    className="text-blue-400 transition-colors hover:text-blue-300"
                    onClick={() => {
                      void revealHooksFile();
                    }}
                    type="button"
                  >
                    hooks.json
                  </button>
                </div>

                <div className="flex min-h-8 min-w-[220px] items-center justify-end gap-2">
                  {hasResolvedHookState ? (
                    <>
                      <Button
                        disabled={!hooksDetected}
                        onClick={() => {
                          void uninstallHooks();
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Clear hooks
                      </Button>
                      {!hooksDetected ? (
                        <Button
                          onClick={() => {
                            void installHooks();
                          }}
                          size="sm"
                          type="button"
                        >
                          Register
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </CardFooter>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}
