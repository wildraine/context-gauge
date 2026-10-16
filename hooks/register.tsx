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

    return (
      <Box flexDirection="row">
        <Text color={color}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}</Text>
        <Text color={color}>
          {' '}Context {current.percent}% · {kilo(current.tokens)} / {kilo(current.window)}{' '}
        </Text>
        <Button key="close" label="✕" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
