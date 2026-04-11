import { ArrowLeft } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod/v4";
import { revealHooksFile } from "@/lib/loopndroll";
import { useLoopndrollState } from "@/lib/use-loopndroll-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

const settingsSchema = z.object({
  defaultPrompt: z
    .string()
    .trim()
    .min(1, "Default prompt is required.")
    .max(500, "Default prompt must be 500 characters or fewer."),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const settingsSectionCardClassName = "gap-6 pt-5 pb-0 shadow-sm";
const settingsSectionFooterClassName =
  "flex items-center justify-between border-t gap-4 pb-4 [.border-t]:pt-4";

export function SettingsRoute() {
  const navigate = useNavigate();
  const { errorMessage, snapshot, installHooks, savePrompt, uninstallHooks } = useLoopndrollState();
  const form = useForm<SettingsFormValues>({
    defaultValues: {
      defaultPrompt: "Keep working on the task. Do not finish yet.",
    },
    mode: "onChange",
  });
  const defaultPromptError = form.formState.errors.defaultPrompt?.message;
  const saveDefaultPrompt = form.handleSubmit((values) => {
    return savePrompt(values.defaultPrompt).then(() => {
      form.reset({ defaultPrompt: values.defaultPrompt });
    });
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

  const hooksDetected = snapshot?.health.registered ?? false;

  return (
    <section aria-label="Settings" className="relative px-4 pt-20 pb-32 md:px-6">
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
              <CardTitle className="font-semibold">Default Prompt</CardTitle>
              <CardDescription className="leading-normal">
                This text is used as the default instruction block for the workflow.
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
            <CardFooter className={settingsSectionFooterClassName}>
              <Button form="default-prompt-form" size="sm" type="submit">
                Save
              </Button>
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

              <div className="flex items-center gap-2">
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
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
