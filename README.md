# Loopndroll

Loopndroll is a desktop app for keeping Codex chats moving after Codex tries to stop.

It watches Codex hook events, keeps a list of chats, sends notifications, and lets you continue work from Telegram when needed.

## What The App Does

- Tracks Codex chats automatically.
- Shows active chats and archived chats.
- Lets you run chats in different modes.
- Sends stop notifications to Slack or Telegram.
- Lets you reply from Telegram to continue a chat.
- Lets you save reusable completion check command groups.
- Registers the Codex hooks the app needs.

## Modes

- `Infinite`: when Codex stops, Loopndroll sends the continue prompt and keeps going.
- `Await Reply`: when Codex stops, Loopndroll waits for a Telegram reply before continuing.
- `Completion Checks`: runs your shell commands before Codex is allowed to finish. You can also make it wait for a Telegram reply after the checks pass.
- `Max Turns 1`, `Max Turns 2`, `Max Turns 3`: keeps going for a limited number of extra turns, then stops.

Notes:

- `Await Reply` needs a Telegram notification attached to that chat.
- Slack can receive notifications, but replying back into the chat flow is a Telegram feature.

## Main Features

### 1. Chat control

You can set a mode for all chats, or set a different mode for one specific chat.

Each chat gets a short reference like `C22`. That reference is used in Telegram commands.

### 2. Notifications

You can add:

- Slack destinations
- Telegram destinations

When Codex stops, Loopndroll can send the final reply there.

### 3. Telegram reply bridge

Telegram is not just for notifications. You can also:

- reply to a stop message to continue a chat
- send commands like `/status` and `/mode`
- target a specific chat by its reference, like `C22`

### 4. Completion checks

Completion checks are named command groups.

Example:

```text
pnpm lint
pnpm test
```

Commands run one by one and stop on the first failure.

### 5. Hook registration

The app can register the Codex hooks it needs for you.

This updates:

- `~/.codex/hooks.json`
- `~/.codex/config.toml`

## Quick Setup

1. Install dependencies with `pnpm install`.
2. Start the app with `pnpm run dev`.
3. Open `Settings`.
4. In `Hook Registration`, click `Register`.
5. Add a Slack or Telegram notification.
6. Start a Codex chat so it appears on the Home screen.
7. Pick a mode for that chat, or set a global mode.

## Telegram Setup

### Get a Telegram bot token

1. Open Telegram.
2. Start a chat with [`@BotFather`](https://t.me/BotFather).
3. Send `/newbot`.
4. Follow the prompts to choose a bot name and username.
5. BotFather will send you a bot token. It looks like `123456789:AA...`.
6. In Loop N Roll, go to `Settings` -> `Notifications` -> `Add Notification`.
7. Choose `Telegram`.
8. Paste the bot token into `API Token`.

### Get your Telegram chat to show up in the app

1. Open a direct message with your bot and send any message.
2. Or add the bot to a group and send any message in that group.
3. Go back to Loopndroll.
4. The chat should appear in the `Chat` dropdown.
5. Select it and save the notification.

## Telegram Commands

These commands work in Telegram after your bot is connected:

- `/help` - show the command help
- `/list` - list chats registered to this Telegram destination
- `/status` - show the current global mode and per-chat modes
- `/reply C22 your message` - send a message to one specific chat
- `/mode global infinite` - set the global mode to Infinite
- `/mode global await` - set the global mode to Await Reply
- `/mode global checks` - set the global mode to Completion Checks
- `/mode global off` - turn off the global mode
- `/mode C22 infinite` - set chat `C22` to Infinite
- `/mode C22 await` - set chat `C22` to Await Reply
- `/mode C22 checks` - set chat `C22` to Completion Checks
- `/mode C22 off` - stop chat `C22`

Notes:

- If you reply directly to a Telegram notification, Loopndroll uses that chat automatically.
- If you send plain text without a command, Loopndroll sends it to the latest waiting chat in that Telegram conversation.

## Slack Setup

### Important

This app uses a Slack Incoming Webhook URL.

It does **not** use a Slack bot token.

### Get the Slack webhook URL

1. Go to [Slack Apps](https://api.slack.com/apps).
2. Create a new app, or open an existing app.
3. Open `Incoming Webhooks`.
4. Turn Incoming Webhooks on.
5. Click `Add New Webhook to Workspace`.
6. Pick the channel where you want messages posted.
7. Approve the app.
8. Copy the webhook URL. It looks like `https://hooks.slack.com/services/...`.
9. In Loopndroll, go to `Settings` -> `Notifications` -> `Add Notification`.
10. Choose `Slack`.
11. Paste the webhook URL into `Webhook URL`.

If you were looking for a Slack token: this app does not need one for Slack notifications.

## Development

- `pnpm install` - install dependencies
- `pnpm run dev` - start the app in development mode
- `pnpm run check` - run lint, format check, and typecheck
- `pnpm run build` - build the app
- `pnpm run build:stable` - build the release version

## Useful Links

- Telegram BotFather: [https://t.me/BotFather](https://t.me/BotFather)
- Telegram Bot API: [https://core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- Slack apps: [https://api.slack.com/apps](https://api.slack.com/apps)
- Slack incoming webhooks: [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)
