// 입력창 위에 컨텍스트 사용량과 사용 한도(5h·7d), 5h 한도 소진 예상 시간을 칸(pill)으로 표시하는 mod
import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'

import type { ContextFill, Limit } from '../types'

const COMMAND = 'context-gauge'

const LEVEL_PERCENTS = [50, 60, 70]
const LEVEL_COLORS = ['green', 'yellow', '#ff8700', 'red']
const LEVEL_ICONS = ['☀', '⛅', '☁', '⛈']
const FULL_PERCENT = 100

const TOKENS_PER_K = 1000
const HISTORY_POINTS = 8
const SPARK_CHARS = '▁▂▃▄▅▆▇█'

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS
const HOURS_PER_DAY = 24
const DAY_MS = HOURS_PER_DAY * HOUR_MS
const TICK_MS = MINUTE_MS

const TINT_BLUE = '#4a90d9'
const BORDER_ALPHA = '66'
const BACKGROUND_ALPHA = '14'
const LIMITS = [
  { kind: 'five_hour', label: '5h', icon: '⏱', windowMs: 5 * HOUR_MS, tint: '#3fa34d' },
  { kind: 'seven_day', label: '7d', icon: '📅', windowMs: 7 * DAY_MS, tint: '#8a6fd1' },
] as const
const BURN_KIND = 'five_hour'

const BAR_CELLS = 8
const SVG_BAR_WIDTH = 48
const SVG_BAR_HEIGHT = 8
const SVG_SPARK_STEP = 5
const SVG_SPARK_BAR = 3
const SVG_SPARK_HEIGHT = 12
const SVG_SPARK_MIN = 2
const SVG_TRACK = '#8888884d'
const SVG_HATCH = '#8888998c'
const SVG_SPARK = '#888888'

const fill = atom({ plugin: 'context-gauge', key: 'fill' } as const, null)
const history = atom({ plugin: 'context-gauge', key: 'history' } as const, [])
const limits = atom({ plugin: 'context-gauge', key: 'limits' } as const, [])
const now = atom({ plugin: 'context-gauge', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'context-gauge', key: 'isHidden' } as const, false)

const toFill = (context: SessionContextUsage): ContextFill | null =>
  context.tokens === undefined || context.percent === undefined
    ? null
    : { tokens: context.tokens, window: context.window, percent: context.percent }

const toLimits = (rateLimits: SessionRateLimit[]): Limit[] =>
  rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

const pushHistory = (points: number[], tokens: number) =>
  points.at(-1) === tokens ? points : [...points, tokens].slice(-HISTORY_POINTS)

const levelOf = (percent: number) => LEVEL_PERCENTS.filter(threshold => percent >= threshold).length

const colorOf = (percent: number) => LEVEL_COLORS[levelOf(percent)] ?? 'red'

const tokensLabel = (tokens: number) =>
  Math.abs(tokens) < TOKENS_PER_K ? `${tokens}` : `${Math.round(tokens / TOKENS_PER_K)}k`

const deltaLabel = (delta: number) => (delta < 0 ? `▼ ${tokensLabel(delta)}` : `▲ +${tokensLabel(delta)}`)

const durationLabel = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS))
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (hours === 0) return `${minutes}m`
  if (hours < HOURS_PER_DAY) return `${hours}h${String(minutes % MINUTES_PER_HOUR).padStart(2, '0')}`

  return `${Math.floor(hours / HOURS_PER_DAY)}d${hours % HOURS_PER_DAY}h`
}

const clampPercent = (percent: number) => Math.min(FULL_PERCENT, Math.max(0, percent))

const remainingMs = (limit: Limit, at: number) =>
  limit.resetsAt === undefined ? undefined : Math.max(0, Date.parse(limit.resetsAt) - at)

// 창이 지난 시간의 비율: 사용률이 이보다 앞서면 평균보다 빠르게 쓰는 중이다
const elapsedPercent = (limit: Limit, windowMs: number, at: number) => {
  const remaining = remainingMs(limit, at)

  return remaining === undefined ? 0 : clampPercent(FULL_PERCENT - (remaining / windowMs) * FULL_PERCENT)
}

// 창 시작부터의 평균 속도로 남은 한도를 다 쓰는 데 걸리는 시간. 리셋 전에 바닥나지 않으면 null
const exhaustMs = (limit: Limit, windowMs: number, at: number) => {
  const remaining = remainingMs(limit, at)

  if (remaining === undefined || limit.percentUsed <= 0) return undefined

  const elapsed = windowMs - remaining
  if (elapsed <= 0) return undefined

  const eta = ((FULL_PERCENT - limit.percentUsed) / limit.percentUsed) * elapsed

  return eta < remaining ? eta : null
}

const sparkLevels = (points: number[], steps: number) => {
  const low = Math.min(...points)
  const span = Math.max(...points) - low

  return points.map(point => (span === 0 ? steps / 2 : ((point - low) / span) * steps))
}

const sparkText = (points: number[]) =>
  sparkLevels(points, SPARK_CHARS.length - 1)
    .map(level => SPARK_CHARS[Math.round(level)])
    .join('')

const sparkSvg = (points: number[]) => {
  const width = points.length * SVG_SPARK_STEP
  const bars = sparkLevels(points, SVG_SPARK_HEIGHT - SVG_SPARK_MIN)
    .map((level, index) => {
      const height = SVG_SPARK_MIN + level

      return `<rect x="${index * SVG_SPARK_STEP}" y="${SVG_SPARK_HEIGHT - height}" width="${SVG_SPARK_BAR}" height="${height}" rx="1" fill="${SVG_SPARK}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SVG_SPARK_HEIGHT}" viewBox="0 0 ${width} ${SVG_SPARK_HEIGHT}">${bars}</svg>`
}

const barSvg = (used: number, elapsed: number, color: string) => {
  const radius = SVG_BAR_HEIGHT / 2
  const toWidth = (percent: number) => (clampPercent(percent) / FULL_PERCENT) * SVG_BAR_WIDTH

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_BAR_WIDTH}" height="${SVG_BAR_HEIGHT}" viewBox="0 0 ${SVG_BAR_WIDTH} ${SVG_BAR_HEIGHT}">` +
    `<defs><clipPath id="r"><rect width="${SVG_BAR_WIDTH}" height="${SVG_BAR_HEIGHT}" rx="${radius}"/></clipPath>` +
    `<pattern id="h" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="1.5" height="3" fill="${SVG_HATCH}"/></pattern></defs>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${SVG_BAR_WIDTH}" height="${SVG_BAR_HEIGHT}" fill="${SVG_TRACK}"/>` +
    `<rect width="${toWidth(elapsed)}" height="${SVG_BAR_HEIGHT}" fill="url(#h)"/>` +
    `<rect width="${toWidth(used)}" height="${SVG_BAR_HEIGHT}" rx="${radius}" fill="${color}"/>` +
    `</g></svg>`
  )
}

const barCells = (used: number, elapsed: number) => {
  const toCells = (percent: number) => Math.round((clampPercent(percent) / FULL_PERCENT) * BAR_CELLS)
  const filled = toCells(used)
  const hatched = Math.max(0, toCells(elapsed) - filled)

  return { filled, hatched, empty: BAR_CELLS - filled - hatched }
}

export const register: Register = on => {
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the usage gauge above the prompt',
    })
    const usage = await $.session.usage()
    const current = toFill(usage.context)
    await update($, fill, () => current)
    if (current !== null) await update($, history, points => pushHistory(points, current.tokens))
    await update($, limits, () => toLimits(usage.rateLimits))
    const startedAt = await $.clock.now()
    await update($, now, () => startedAt)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Usage gauge hidden.' : 'Usage gauge shown.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const current = toFill(e.context)
      await update($, fill, () => current)
      if (current !== null) await update($, history, points => pushHistory(points, current.tokens))
    }
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => toLimits(e.rateLimits))
    }
    const at = await $.clock.now()
    await update($, now, () => at)
    // 리셋까지 남은 시간이 대기 중에도 줄어들도록 1분마다 다시 그린다
    ticker ??= $.clock.every(TICK_MS, () => {
      void $.clock.now().then(tick => update($, now, () => tick))
    })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, fill)

    if (e.props.hasSurvey || current === null || (await read($, isHidden))) {
      return next(e)
    }

    const points = await read($, history)
    const readings = await read($, limits)
    const at = await read($, now)
    const isTerminal = e.surface === 'terminal'
    const { Box, Button, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg

    const divider = <Text dimColor>│</Text>
    const pill = (key: string, tint: string, children: RenderChildren[]) =>
      isTerminal ? (
        <Box key={key} flexDirection="row" alignItems="center" gap={1}>
          {children}
        </Box>
      ) : (
        <Box
          key={key}
          flexDirection="row"
          alignItems="center"
          gap="sm"
          paddingX="sm"
          borderStyle="round"
          borderColor={`${tint}${BORDER_ALPHA}`}
          backgroundColor={`${tint}${BACKGROUND_ALPHA}`}
        >
          {children}
        </Box>
      )

    const color = colorOf(current.percent)
    const delta = points.length > 1 ? (points.at(-1) ?? 0) - (points.at(-2) ?? 0) : undefined
    const contextPill = pill('context', TINT_BLUE, [
      <Text color={color}>{LEVEL_ICONS[levelOf(current.percent)]}</Text>,
      <Text bold>{tokensLabel(current.tokens)}</Text>,
      <Text color={color}>{current.percent}%</Text>,
      divider,
      Svg === undefined ? (
        <Text dimColor>{sparkText(points)}</Text>
      ) : (
        <Svg source={sparkSvg(points)} alt="Context history" width={points.length * SVG_SPARK_STEP} height={SVG_SPARK_HEIGHT} />
      ),
      ...(delta === undefined ? [] : [divider, <Text dimColor>{deltaLabel(delta)}</Text>]),
    ])

    const limitPills = LIMITS.flatMap(style => {
      const limit = readings.find(reading => reading.kind === style.kind)
      if (limit === undefined) return []

      const used = limit.percentUsed
      const elapsed = elapsedPercent(limit, style.windowMs, at)
      const barColor = colorOf(used)
      const remaining = remainingMs(limit, at)
      const cells = barCells(used, elapsed)
      const bar = Svg === undefined ? (
        <Box flexDirection="row">
          <Text color={barColor}>{'█'.repeat(cells.filled)}</Text>
          <Text dimColor>{'▒'.repeat(cells.hatched)}</Text>
          <Text dimColor>{'░'.repeat(cells.empty)}</Text>
        </Box>
      ) : (
        <Svg source={barSvg(used, elapsed, barColor)} alt={`${style.label} ${used}%`} width={SVG_BAR_WIDTH} height={SVG_BAR_HEIGHT} />
      )

      return [
        pill(style.kind, style.tint, [
          <Text>{style.icon}</Text>,
          <Text>{style.label}</Text>,
          bar,
          <Text bold>{Math.round(used)}%</Text>,
          ...(remaining === undefined ? [] : [divider, <Text dimColor>↺ {durationLabel(remaining)}</Text>]),
        ]),
      ]
    })

    const burnStyle = LIMITS.find(style => style.kind === BURN_KIND)
    const burnLimit = readings.find(reading => reading.kind === BURN_KIND)
    const eta = burnStyle && burnLimit ? exhaustMs(burnLimit, burnStyle.windowMs, at) : undefined
    const burnPills =
      eta === undefined
        ? []
        : [
            pill('burn', TINT_BLUE, [
              <Text>⚡</Text>,
              eta === null ? <Text dimColor>—</Text> : <Text bold>{durationLabel(eta)}</Text>,
            ]),
          ]

    return (
      <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap={isTerminal ? 2 : 'sm'}>
        {contextPill}
        {limitPills}
        {burnPills}
        <Button key="close" label="✕" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
