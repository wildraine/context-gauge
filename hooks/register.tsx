// 입력창 위에 현재 세션의 컨텍스트 사용량을 표시하는 mod
import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage } from 'claude-code'

import type { ContextFill } from '../types'

const CAUTION_PERCENT = 50
const WARN_PERCENT = 60
const DANGER_PERCENT = 70
const ORANGE = '#ff8700'
const TOKENS_PER_K = 1000
const BAR_CELLS = 20
const FULL_PERCENT = 100
const COMMAND = 'context-gauge'
const SVG_WIDTH = 120
const SVG_HEIGHT = 10
const SVG_TRACK = '#8888884d'

const fill = atom({ plugin: 'context-gauge', key: 'fill' } as const, null)
const isHidden = atom({ plugin: 'context-gauge', key: 'isHidden' } as const, false)

const toFill = (context: SessionContextUsage): ContextFill | null =>
  context.tokens === undefined || context.percent === undefined
    ? null
    : { tokens: context.tokens, window: context.window, percent: context.percent }

const colorOf = (percent: number) => {
  if (percent >= DANGER_PERCENT) return 'red'
  if (percent >= WARN_PERCENT) return ORANGE
  if (percent >= CAUTION_PERCENT) return 'yellow'

  return 'green'
}

const kilo = (tokens: number) => `${Math.round(tokens / TOKENS_PER_K)}k`

const filledCells = (percent: number) =>
  Math.min(BAR_CELLS, Math.round((percent / FULL_PERCENT) * BAR_CELLS))

const barSvg = (percent: number, color: string) => {
  const radius = SVG_HEIGHT / 2
  const filled = Math.min(SVG_WIDTH, (percent / FULL_PERCENT) * SVG_WIDTH)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">` +
    `<clipPath id="r"><rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="${radius}"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${SVG_TRACK}"/>` +
    `<rect width="${filled}" height="${SVG_HEIGHT}" fill="${color}"/>` +
    `</g></svg>`
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the context usage gauge above the prompt',
    })
    const { context } = await $.session.usage()
    await update($, fill, () => toFill(context))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Context gauge hidden.' : 'Context gauge shown.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, fill, () => toFill(e.context))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, fill)

    if (e.props.hasSurvey || current === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const color = colorOf(current.percent)
    const filled = filledCells(current.percent)
    const bar =
      e.surface === 'terminal' ? (
        <Box flexDirection="row">
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}</Text>
        </Box>
      ) : (
        h($.ui.resolve(e).Svg, {
          source: barSvg(current.percent, color),
          alt: `Context ${current.percent}%`,
          width: SVG_WIDTH,
          height: SVG_HEIGHT,
        })
      )

    return (
      <Box flexDirection="row" alignItems="center">
        {bar}
        <Text color={color}>
          {' '}Context {current.percent}% · {kilo(current.tokens)} / {kilo(current.window)}{' '}
        </Text>
        <Button key="close" label="✕" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
