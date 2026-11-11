# context-gauge

A Claude Code mod that shows the session's usage above the prompt as a row of pills.

```
☀ 237k 42% │ ▁▃▅▃▁ │ ▲ +713   ⏱ 5h ███▒░░░░ 38% │ ↺ 2h12   ⏲ 7d ███░░░░░ 33% │ ↺ 1d23h   [✕]
```

- **Context**: tokens in the context window, its percent, a sparkline of the last 8 measurements and the change since the previous one. The icon and color follow the percent: ☀ green below 50%, ⛅ yellow from 50%, ☁ orange from 60%, ⛈ red from 70%.
- **5h / 7d**: how much of each rate-limit window is used and how long until it resets. The hatched part (`▒`) is how much of the window's time has passed: usage ahead of it means you are spending faster than an even pace. The percent and the used part of the bar turn yellow from 70%, orange from 80% and red from 90%.
- The rate-limit pills appear only when the API reports rate limits (subscription plans).
- The pills and `✕` stay on one line and fill it: spare width goes to the 5h/7d bars, and the pills widen to take up the rest. When the line is too narrow, details drop in this order: sparkline and change, then the bars and context token count, then the reset times (the context percent always stays).
- In the terminal the pills are text; in the desktop app, VS Code and mobile they are rounded boxes with SVG bars.
- Updates after each response; the reset countdowns also tick every minute.
- `✕` hides the gauge; `/context-gauge` shows or hides it again.

## Handoff at 80%

Off by default. Turn on **Handoff at 80%** (`autoHandoff`) in the plugin's settings, or under `pluginConfigs` in `settings.json`:

```json
{ "pluginConfigs": { "context-gauge": { "autoHandoff": true } } }
```

When the context window first passes 80% after a response, the gauge asks Claude to write a handoff document (following the project's own convention if it has one). When that turn ends it sends a notification suggesting a new session or `/clear`. It asks once; after the context drops below 80% (a compaction or `/clear`) it can ask again. Nothing is compacted or cleared for you.

Requires Claude Code 2.1.299 or newer.

## Install

At the prompt of a terminal session:

```
/plugin install context-gauge --marketplace wildraine/context-gauge
```

From a shell:

```bash
claude plugin install context-gauge --marketplace wildraine/context-gauge
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `wildraine/context-gauge`, then **Add plugin**.
