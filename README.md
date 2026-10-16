# context-gauge

A Claude Code mod that shows the session's context window usage above the prompt.

```
████████░░░░░░░░░░░░ Context 42% · 84k / 200k [✕]
```

- The bar has 20 cells; green below 60%, yellow from 60%, red from 80%.
- Updates after each response.
- `✕` hides the gauge; `/context-gauge` shows or hides it again.

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
