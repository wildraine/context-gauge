// 입력창 위에 컨텍스트 사용량, 사용 한도(5h·7d), 작업 폴더 checklist.md 진행률을 칸(pill)으로 표시하고, 설정 시 컨텍스트 80%에서 인수인계 문서 작성을 요청하는 mod
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderChildren,
  SessionContextUsage,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type { Checklist, ChecklistLine, ContextFill, Limit } from '../types'

const COMMAND = 'context-gauge'

const HANDOFF_PERCENT = 80
const HANDOFF_MARK = '[context-gauge handoff]'
const HANDOFF_PROMPT =
  `${HANDOFF_MARK} The context window is over ${HANDOFF_PERCENT}% full. ` +
  'Write a handoff document so a new session can pick up this work: the goal, what is done, ' +
  'what is in progress, what is left, the decisions made and why, and anything to watch out for. ' +
  "Follow the project's existing handoff document convention if it has one, and tell me the file path."
const HANDOFF_DONE = 'Handoff document written. Start a new session or run /clear to free the context.'
const HANDOFF_STOPPED = 'The handoff document was not finished.'
const HANDOFF_ASKED = `Context over ${HANDOFF_PERCENT}%: asking Claude for a handoff document.`

const CHECKLIST_FILE = 'checklist.md'
const CHECKLIST_ITEM = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const CHECKLIST_HEADING = /^#+\s+(.*)$/
const CHECKLIST_PANE = { id: 'checklist', title: 'Checklist' } as const
const CHECKLIST_MISSING = 'No checklist.md in the working folder.'
const INDENT_SPACES = 2
const CHECKLIST_ICON = '☑'
const CHECKLIST_DONE_COLOR = 'green'
const NEXT_MAX_CELLS = 24
// 터미널에서 두 칸을 차지하는 동아시아 문자(한글·한자·가나·전각)
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

const CONTEXT_LEVEL_PERCENTS = [50, 60, 70]
const LIMIT_LEVEL_PERCENTS = [70, 80, 90]
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
  { kind: 'seven_day', label: '7d', icon: '⏲', windowMs: 7 * DAY_MS, tint: '#8a6fd1' },
] as const
const TINT_AMBER = '#d9a54a'
// 데스크톱 칸 글자는 가장 작은 크기로: 터미널은 글자 크기가 하나라 무시한다
const PILL_TEXT_SIZE = 'caption'
// 데스크톱 caption 글자 한 자의 폭(앱 화면 실측 약 8.3px)을 본문 1칸(9px)에 견준 비율
const PANEL_TEXT_SCALE = 0.92

// 막대의 최소 길이: 칸 폭이 정해지면 남는 만큼 늘어난다
const BAR_MIN_CELLS = 4
const SVG_BAR_MIN_WIDTH = 12
const SVG_BAR_HEIGHT = 8
const SVG_SPARK_STEP = 4
const SVG_SPARK_BAR = 3
const SVG_SPARK_HEIGHT = 12
const SVG_SPARK_MIN = 2
const SVG_TRACK = '#8888884d'
const SVG_HATCH = '#8888998c'
const SVG_SPARK = '#888888'

// 폭이 모자랄 때 항목을 빼는 단계: 값이 작을수록 먼저 빠진다
const DROP = { spark: 1, next: 1, reset: 2, contextTokens: 2, bar: 3 } as const
const DETAIL_LEVELS = 4
// 데스크톱 1칸 폭과 칸 테두리·여백은 앱 화면 실측 기준
const CELL_PX = 9
const DIVIDER_CELLS = 1
// 줄 끝 버튼(☰ 체크리스트, ✕ 닫기) 하나의 폭
const BUTTON_CELLS = 4
const CHECKLIST_BUTTON = '☰'
// innerGap은 그리는 값, innerGapCells는 폭 계산에 쓰는 칸 수(데스크톱 xs 간격은 반 칸으로 추정).
// marginCells: 데스크톱 폭 추정이 어긋나도 줄 끝 버튼이 잘리지 않도록 남겨 두는 칸
const TERMINAL_LAYOUT = { innerGap: 1, innerGapCells: 1, outerGap: 2, paddingX: 0, frameCells: 0, iconCells: 2, marginCells: 0 } as const
const PANEL_LAYOUT = { innerGap: 'xs', innerGapCells: 0.5, outerGap: 1, paddingX: 1, frameCells: 2, iconCells: 1, marginCells: 1 } as const

const fill = atom({ plugin: 'context-gauge', key: 'fill' } as const, null)
const history = atom({ plugin: 'context-gauge', key: 'history' } as const, [])
const limits = atom({ plugin: 'context-gauge', key: 'limits' } as const, [])
const now = atom({ plugin: 'context-gauge', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'context-gauge', key: 'isHidden' } as const, false)
const handoffSent = atom({ plugin: 'context-gauge', key: 'handoffSent' } as const, false)
const handoffTurn = atom({ plugin: 'context-gauge', key: 'handoffTurn' } as const, null)
const checklist = atom({ plugin: 'context-gauge', key: 'checklist' } as const, null)

const toFill = (context: SessionContextUsage): ContextFill | null =>
  context.tokens === undefined || context.percent === undefined
    ? null
    : { tokens: context.tokens, window: context.window, percent: context.percent }

const toLimits = (rateLimits: SessionRateLimit[]): Limit[] =>
  rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

const pushHistory = (points: number[], tokens: number) =>
  points.at(-1) === tokens ? points : [...points, tokens].slice(-HISTORY_POINTS)

const levelOf = (percent: number, thresholds: readonly number[]) => thresholds.filter(threshold => percent >= threshold).length

const colorOf = (percent: number, thresholds: readonly number[]) => LEVEL_COLORS[levelOf(percent, thresholds)] ?? 'red'

const tokensLabel = (tokens: number) =>
  Math.abs(tokens) < TOKENS_PER_K ? `${tokens}` : `${Math.round(tokens / TOKENS_PER_K)}k`

const durationLabel = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS))
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (hours === 0) return `${minutes}m`
  if (hours < HOURS_PER_DAY) return `${hours}h${String(minutes % MINUTES_PER_HOUR).padStart(2, '0')}`

  return `${Math.floor(hours / HOURS_PER_DAY)}d${hours % HOURS_PER_DAY}h`
}

const toChecklistLine = (line: string): ChecklistLine | null => {
  const item = CHECKLIST_ITEM.exec(line)
  if (item !== null) {
    const [, indent = '', mark, title = ''] = item

    return { depth: Math.floor(indent.length / INDENT_SPACES), text: title.trim(), kind: mark === ' ' ? 'open' : 'done' }
  }
  const heading = CHECKLIST_HEADING.exec(line)

  return heading === null ? null : { depth: 0, text: (heading[1] ?? '').trim(), kind: 'heading' }
}

// 체크박스 항목과 제목만 남긴다: 체크박스가 하나도 없으면 체크리스트로 보지 않는다
const toChecklist = (text: string): Checklist | null => {
  const lines = text.split('\n').flatMap(line => toChecklistLine(line) ?? [])
  const total = lines.filter(({ kind }) => kind !== 'heading').length
  if (total === 0) return null
  const nextIndex = lines.findIndex(({ kind }) => kind === 'open')

  return {
    done: lines.filter(({ kind }) => kind === 'done').length,
    total,
    next: lines[nextIndex]?.text ?? null,
    nextIndex,
    lines,
  }
}

const charCells = (char: string) => (WIDE_CHAR.test(char) ? 2 : 1)

const textCells = (text: string) => [...text].reduce((sum, char) => sum + charCells(char), 0)

// 칸 수가 넘치면 뒤를 잘라 말줄임표를 붙인다
const truncateCells = (text: string, maxCells: number) => {
  if (textCells(text) <= maxCells) return text

  let cells = 1
  let kept = ''
  for (const char of text) {
    cells += charCells(char)
    if (cells > maxCells) break
    kept += char
  }

  return `${kept}…`
}

const clampPercent = (percent: number) => Math.min(FULL_PERCENT, Math.max(0, percent))

const remainingMs = (limit: Limit, at: number) =>
  limit.resetsAt === undefined ? undefined : Math.max(0, Date.parse(limit.resetsAt) - at)

// 창이 지난 시간의 비율: 사용률이 이보다 앞서면 평균보다 빠르게 쓰는 중이다
const elapsedPercent = (limit: Limit, windowMs: number, at: number) => {
  const remaining = remainingMs(limit, at)

  return remaining === undefined ? 0 : clampPercent(FULL_PERCENT - (remaining / windowMs) * FULL_PERCENT)
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

const barSvg = (used: number, elapsed: number, color: string, width: number) => {
  const radius = SVG_BAR_HEIGHT / 2
  const toWidth = (percent: number) => (clampPercent(percent) / FULL_PERCENT) * width

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SVG_BAR_HEIGHT}" viewBox="0 0 ${width} ${SVG_BAR_HEIGHT}">` +
    `<defs><clipPath id="r"><rect width="${width}" height="${SVG_BAR_HEIGHT}" rx="${radius}"/></clipPath>` +
    `<pattern id="h" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="1.5" height="3" fill="${SVG_HATCH}"/></pattern></defs>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${width}" height="${SVG_BAR_HEIGHT}" fill="${SVG_TRACK}"/>` +
    `<rect width="${toWidth(elapsed)}" height="${SVG_BAR_HEIGHT}" fill="url(#h)"/>` +
    `<rect width="${toWidth(used)}" height="${SVG_BAR_HEIGHT}" rx="${radius}" fill="${color}"/>` +
    `</g></svg>`
  )
}

const barCells = (used: number, elapsed: number, total: number) => {
  const toCells = (percent: number) => Math.round((clampPercent(percent) / FULL_PERCENT) * total)
  const filled = toCells(used)
  const hatched = Math.max(0, toCells(elapsed) - filled)

  return { filled, hatched, empty: total - filled - hatched }
}

type Part = { node: RenderChildren; cells: number; dropAt: number; hasDivider: boolean }
type Pill = { key: string; tint: string; parts: Part[] }
type Grow = (key: string) => number
type Layout = typeof TERMINAL_LAYOUT | typeof PANEL_LAYOUT

const part = (node: RenderChildren, cells: number, dropAt = DETAIL_LEVELS, hasDivider = false): Part => ({
  node,
  cells,
  dropAt,
  hasDivider,
})

const visibleParts = (pill: Pill, detail: number) => pill.parts.filter(({ dropAt }) => detail < dropAt)

const pillCells = (pill: Pill, detail: number, layout: Layout) => {
  const parts = visibleParts(pill, detail)
  const children = parts.length + parts.filter(({ hasDivider }) => hasDivider).length
  const content = parts.reduce((sum, { cells, hasDivider }) => sum + cells + (hasDivider ? DIVIDER_CELLS : 0), 0)

  return layout.frameCells + content + Math.max(0, children - 1) * layout.innerGapCells
}

// 칸이 아닌 몫: 칸 사이·버튼 앞 간격, 줄 끝 버튼, 여유 칸
const reservedCells = (pillCount: number, buttonCount: number, layout: Layout) =>
  (pillCount + buttonCount - 1) * layout.outerGap + buttonCount * BUTTON_CELLS + layout.marginCells

// 칸이 나눠 받는 폭의 비율: 체크리스트 칸은 다른 칸의 3분의 2, 나머지는 같다
const PILL_WEIGHTS: Record<string, number> = { checklist: 2 / 3 }
const weightOf = (pill: Pill) => PILL_WEIGHTS[pill.key] ?? 1
const totalWeight = (pills: Pill[]) => pills.reduce((sum, pill) => sum + weightOf(pill), 0)

// 비율대로 나눠 받는 칸 폭
const slotCells = (pill: Pill, unit: number) => Math.floor(unit * weightOf(pill))

const rowCells = (pills: Pill[], detail: number, layout: Layout, reserved: number) =>
  pills.reduce((sum, pill) => sum + pillCells(pill, detail, layout), reserved)

// 조건을 만족하는 가장 자세한 단계: 폭이 모자라면 덜 중요한 항목부터 뺀다
const detailFor = (fits: (detail: number) => boolean) => {
  for (let detail = 0; detail < DETAIL_LEVELS; detail += 1) {
    if (fits(detail)) return detail
  }

  return DETAIL_LEVELS - 1
}

// 작업 폴더의 checklist.md를 다시 읽는다: 없거나 읽을 수 없으면 칸을 그리지 않는다
const refreshChecklist = async ($: EngineInterface) => {
  const current = await $.fs.read(CHECKLIST_FILE).then(toChecklist, () => null)
  await update($, checklist, () => current)
}

// 체크리스트 창이 열려 있으면 닫고, 닫혀 있으면 연다
const toggleChecklistPane = async ($: EngineInterface) => {
  const isOpen = (await $.ui.panes()).some(({ id }) => id === CHECKLIST_PANE.id)

  if (isOpen) await $.ui.close({ id: CHECKLIST_PANE.id })
  else await $.ui.open({ ...CHECKLIST_PANE, closeOnEscape: true })
}

// 80%를 처음 넘으면 한 번 요청하고, 압축·정리로 80% 아래로 내려가면 다시 요청할 수 있게 한다
const requestHandoff = async ($: EngineInterface, percent: number) => {
  if (percent < HANDOFF_PERCENT) {
    await update($, handoffSent, () => false)
    return
  }
  if (await read($, handoffSent)) return

  await update($, handoffSent, () => true)
  $.ui.toast(HANDOFF_ASKED)
  void $.prompt.submit({ text: HANDOFF_PROMPT })
}

export const register: Register = (on, options) => {
  const isAutoHandoff = options.autoHandoff === true
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
    await refreshChecklist($)

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
      if (current !== null && isAutoHandoff) await requestHandoff($, current.percent)
    }
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => toLimits(e.rateLimits))
    }
    const at = await $.clock.now()
    await update($, now, () => at)
    await refreshChecklist($)
    // 리셋까지 남은 시간과 직접 고친 checklist.md가 대기 중에도 반영되도록 1분마다 다시 그린다
    ticker ??= $.clock.every(TICK_MS, () => {
      void $.clock.now().then(tick => update($, now, () => tick))
      void refreshChecklist($)
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.includes(HANDOFF_MARK)) {
      await update($, handoffTurn, () => e.turnId)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.turnId === (await read($, handoffTurn))) {
      await update($, handoffTurn, () => null)
      await $.ui.notify(e.reason === 'answer' ? HANDOFF_DONE : HANDOFF_STOPPED, { title: 'Context gauge' })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, fill)

    if (e.props.hasSurvey || current === null || (await read($, isHidden))) {
      return next(e)
    }

    const points = await read($, history)
    const readings = await read($, limits)
    const progress = await read($, checklist)
    const at = await read($, now)
    const isTerminal = e.surface === 'terminal'
    const { Box, Button, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const svgCells = (px: number) => Math.ceil(px / CELL_PX)
    const textScale = isTerminal ? 1 : PANEL_TEXT_SCALE
    // 글자 칸: 데스크톱은 작은 글자라 본문 칸보다 좁게 센다
    const textPart = (node: RenderChildren, cells: number, dropAt?: number, hasDivider?: boolean) =>
      part(node, cells * textScale, dropAt, hasDivider)
    const layout = isTerminal ? TERMINAL_LAYOUT : PANEL_LAYOUT

    const color = colorOf(current.percent, CONTEXT_LEVEL_PERCENTS)
    const contextLabel = tokensLabel(current.tokens)
    const contextPill: Pill = {
      key: 'context',
      tint: TINT_BLUE,
      parts: [
        textPart(<Text size={PILL_TEXT_SIZE} color={color}>{LEVEL_ICONS[levelOf(current.percent, CONTEXT_LEVEL_PERCENTS)]}</Text>, layout.iconCells),
        textPart(<Text size={PILL_TEXT_SIZE} bold>{contextLabel}</Text>, contextLabel.length, DROP.contextTokens),
        Svg === undefined
          ? textPart(<Text size={PILL_TEXT_SIZE} dimColor>{sparkText(points)}</Text>, points.length, DROP.spark)
          : part(
              <Svg source={sparkSvg(points)} alt="Context history" width={points.length * SVG_SPARK_STEP} height={SVG_SPARK_HEIGHT} />,
              svgCells(points.length * SVG_SPARK_STEP),
              DROP.spark,
            ),
        textPart(<Text size={PILL_TEXT_SIZE} color={color}>{current.percent}%</Text>, `${current.percent}%`.length),
      ],
    }

    // grow: 칸 폭을 맞추도록 그 칸의 막대에 더하는 칸 수
    const limitPills = (grow: Grow) => LIMITS.flatMap((style): Pill[] => {
      const limit = readings.find(reading => reading.kind === style.kind)
      if (limit === undefined) return []

      const growCells = grow(style.kind)
      const used = limit.percentUsed
      const elapsed = elapsedPercent(limit, style.windowMs, at)
      const usedColor = colorOf(used, LIMIT_LEVEL_PERCENTS)
      const remaining = remainingMs(limit, at)
      const barTotal = BAR_MIN_CELLS + growCells
      const barWidth = SVG_BAR_MIN_WIDTH + growCells * CELL_PX
      const cells = barCells(used, elapsed, barTotal)
      const bar =
        Svg === undefined
          ? part(
              <Box flexDirection="row">
                <Text size={PILL_TEXT_SIZE} color={usedColor}>{'█'.repeat(cells.filled)}</Text>
                <Text size={PILL_TEXT_SIZE} dimColor>{'▒'.repeat(cells.hatched)}</Text>
                <Text size={PILL_TEXT_SIZE} dimColor>{'░'.repeat(cells.empty)}</Text>
              </Box>,
              barTotal,
              DROP.bar,
            )
          : part(
              <Svg source={barSvg(used, elapsed, usedColor, barWidth)} alt={`${style.label} ${used}%`} width={barWidth} height={SVG_BAR_HEIGHT} />,
              svgCells(barWidth),
              DROP.bar,
            )
      const usedLabel = `${Math.round(used)}%`
      const resetLabel = remaining === undefined ? undefined : durationLabel(remaining)

      return [
        {
          key: style.kind,
          tint: style.tint,
          parts: [
            textPart(<Text size={PILL_TEXT_SIZE}>{style.icon}</Text>, layout.iconCells),
            textPart(<Text size={PILL_TEXT_SIZE}>{style.label}</Text>, style.label.length),
            bar,
            textPart(<Text size={PILL_TEXT_SIZE} bold color={usedColor}>{usedLabel}</Text>, usedLabel.length),
            ...(resetLabel === undefined
              ? []
              : [textPart(<Text size={PILL_TEXT_SIZE} dimColor>{resetLabel}</Text>, resetLabel.length, DROP.reset, true)]),
          ],
        },
      ]
    })

    const checklistPills = (grow: Grow): Pill[] => {
      if (progress === null) return []

      const growCells = grow(CHECKLIST_PANE.id)
      const percent = (progress.done / progress.total) * FULL_PERCENT
      const isComplete = progress.done === progress.total
      const countLabel = `${progress.done}/${progress.total}`
      const barTotal = BAR_MIN_CELLS + growCells
      const barWidth = SVG_BAR_MIN_WIDTH + growCells * CELL_PX
      const filled = Math.round((percent / FULL_PERCENT) * barTotal)
      const bar =
        Svg === undefined
          ? part(
              <Box flexDirection="row">
                <Text size={PILL_TEXT_SIZE} color={CHECKLIST_DONE_COLOR}>{'█'.repeat(filled)}</Text>
                <Text size={PILL_TEXT_SIZE} dimColor>{'░'.repeat(barTotal - filled)}</Text>
              </Box>,
              barTotal,
              DROP.bar,
            )
          : part(
              <Svg source={barSvg(percent, 0, CHECKLIST_DONE_COLOR, barWidth)} alt={`Checklist ${countLabel}`} width={barWidth} height={SVG_BAR_HEIGHT} />,
              svgCells(barWidth),
              DROP.bar,
            )
      const nextLabel = progress.next === null ? undefined : `▸ ${truncateCells(progress.next, NEXT_MAX_CELLS)}`

      return [
        {
          key: 'checklist',
          tint: TINT_AMBER,
          parts: [
            textPart(<Text size={PILL_TEXT_SIZE}>{CHECKLIST_ICON}</Text>, layout.iconCells),
            textPart(<Text size={PILL_TEXT_SIZE} bold color={isComplete ? CHECKLIST_DONE_COLOR : undefined}>{countLabel}</Text>, countLabel.length),
            bar,
            ...(nextLabel === undefined
              ? []
              : [textPart(<Text size={PILL_TEXT_SIZE} dimColor>{nextLabel}</Text>, textCells(nextLabel), DROP.next, true)]),
          ],
        },
      ]
    }

    const columns = e.props.bodyColumns
    const pillsWith = (grow: Grow) => [contextPill, ...limitPills(grow), ...checklistPills(grow)]
    const compact = pillsWith(() => 0)
    const reserved = reservedCells(compact.length, progress === null ? 1 : 2, layout)
    const unit = (columns - reserved) / totalWeight(compact)
    const slotOf = (key: string) => {
      const pill = compact.find(candidate => candidate.key === key)

      return pill === undefined ? undefined : slotCells(pill, unit)
    }
    // 비율대로 나눈 폭으로 그려도 내용 폭대로 그릴 때만큼 보이면 그 폭으로, 아니면 정보를 먼저 살려 내용 폭대로 그린다
    const equalDetail = detailFor(detail => compact.every(pill => pillCells(pill, detail, layout) <= slotCells(pill, unit)))
    const rowDetail = detailFor(detail => rowCells(compact, detail, layout, reserved) <= columns)
    const isEqual = equalDetail <= rowDetail
    const detail = isEqual ? equalDetail : rowDetail
    // 막대가 있는 칸(컨텍스트 칸 말고 모두)이 남는 폭을 비율대로 막대로 받는다
    const spare = Math.max(0, columns - rowCells(compact, detail, layout, reserved))
    const barWeight = totalWeight(compact.filter(pill => pill.key !== contextPill.key))
    const growOf: Grow = key => {
      const pill = compact.find(candidate => candidate.key === key)
      if (pill === undefined || detail >= DROP.bar) return 0

      return isEqual
        ? Math.max(0, Math.floor(slotCells(pill, unit) - pillCells(pill, detail, layout)))
        : Math.floor((spare * weightOf(pill)) / Math.max(1, barWeight))
    }
    const pills = pillsWith(growOf)
    const minWidthOf = (pill: Pill) => (isEqual ? slotOf(pill.key) : undefined)
    const divider = <Text size={PILL_TEXT_SIZE} dimColor>│</Text>
    const drawPill = (pill: Pill) => {
      const children = visibleParts(pill, detail).flatMap(({ node, hasDivider }) =>
        hasDivider ? [divider, node] : [node],
      )

      return isTerminal ? (
        <Box key={pill.key} flexDirection="row" alignItems="center" justifyContent="center" flexGrow={weightOf(pill)} flexShrink={0} minWidth={minWidthOf(pill)} gap={layout.innerGap}>
          {children}
        </Box>
      ) : (
        <Box
          key={pill.key}
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          flexGrow={weightOf(pill)}
          flexShrink={0}
          minWidth={minWidthOf(pill)}
          gap={layout.innerGap}
          paddingX={layout.paddingX}
          paddingY={0}
          borderStyle="round"
          borderColor={`${pill.tint}${BORDER_ALPHA}`}
          backgroundColor={`${pill.tint}${BACKGROUND_ALPHA}`}
        >
          {children}
        </Box>
      )
    }

    return (
      <Box
        flexDirection="row"
        alignItems="center"
        flexWrap="nowrap"
        overflow="hidden"
        gap={layout.outerGap}
      >
        {pills.map(drawPill)}
        {progress === null ? null : (
          <Button key="checklist-open" label={CHECKLIST_BUTTON} onPress={() => void toggleChecklistPane($)} />
        )}
        <Button key="close" label="✕" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CHECKLIST_PANE.id }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const progress = await read($, checklist)

    if (progress === null) return <Text dimColor>{CHECKLIST_MISSING}</Text>

    const drawLine = ({ depth, text, kind }: ChecklistLine, index: number) => {
      const key = `line:${index}`
      const indent = ' '.repeat(depth * INDENT_SPACES)

      if (kind === 'heading') return <Text key={key} bold>{text}</Text>
      if (kind === 'done') return <Text key={key} dimColor>{`${indent}✓ ${text}`}</Text>

      return <Text key={key} bold={index === progress.nextIndex}>{`${indent}○ ${text}`}</Text>
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>{`${progress.done}/${progress.total} done · checklist.md`}</Text>
        {progress.lines.map(drawLine)}
      </Box>
    )
  })
}
