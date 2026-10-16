// context-gauge mod의 입력창 위 컨텍스트 표시 동작 테스트
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const PLUGIN = 'context-gauge'
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

// 엔진 자리에서 기본 밴드(빈 Box)를 그린다
const engineBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine" />
  })

const RUN_TOGGLE = {
  command: PLUGIN,
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const echoMeasure = (on: On) =>
  on('session.measure', ($, e) => ({ changed: e.changed }))

const measure = ($: Engine, tokens: number, window: number, percent: number) =>
  $.session.measure({ context: { tokens, window, percent }, rateLimits: [], changed: ['context'] })

for (const surface of SURFACES) {
  test(`${surface}: 측정 전에는 아무것도 그리지 않는다`, async ($, on) => {
    engineBand(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

    expect(await ui.find({ text: /Context/ })).toBeUndefined()
  })

  test(`${surface}: 측정값을 퍼센트와 토큰으로 표시한다`, async ($, on) => {
    echoMeasure(on)
    engineBand(on)
    await measure($, 84_000, 200_000, 42)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

    const [filled, empty, label] = await ui.findAll({ type: 'Text' })
    expect(filled?.text).toBe('█'.repeat(8))
    expect(empty?.text).toBe('░'.repeat(12))
    expect(label?.text.trim()).toBe('Context 42% · 84k / 200k')
    expect(await ui.find({ type: 'Button', key: 'close' })).toBeDefined()
    expect(label?.props.color).toBe('green')
  })

  for (const [percent, color] of [[49, 'green'], [50, 'yellow'], [60, '#ff8700'], [70, 'red']] as const) {
    test(`${surface}: ${percent}%는 ${color}`, async ($, on) => {
      echoMeasure(on)
      engineBand(on)
      await measure($, percent * 2_000, 200_000, percent)
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

      const [filled, , label] = await ui.findAll({ type: 'Text' })
      expect(filled?.props.color).toBe(color)
      expect(label?.props.color).toBe(color)
    })
  }

  test(`${surface}: 설문이 떠 있으면 양보한다`, async ($, on) => {
    echoMeasure(on)
    engineBand(on)
    await measure($, 84_000, 200_000, 42)
    const ui = await $.ui.mount({
      plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, hasSurvey: true },
    })

    expect(await ui.find({ text: /Context/ })).toBeUndefined()
  })

  test(`${surface}: 닫기 버튼을 누르면 사라진다`, async ($, on) => {
    echoMeasure(on)
    engineBand(on)
    await measure($, 84_000, 200_000, 42)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

    await ui.press({ key: 'close' })

    expect(await ui.find({ text: /Context/ })).toBeUndefined()
  })

  test(`${surface}: 명령으로 닫은 게이지를 다시 켠다`, async ($, on) => {
    echoMeasure(on)
    engineBand(on)
    await measure($, 84_000, 200_000, 42)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'close' })

    const shown = await $.command.run(RUN_TOGGLE)
    expect(shown.text).toBe('Context gauge shown.')
    await ui.redraw()
    expect(await ui.find({ text: /Context 42%/ })).toBeDefined()

    const hidden = await $.command.run(RUN_TOGGLE)
    expect(hidden.text).toBe('Context gauge hidden.')
  })
}
