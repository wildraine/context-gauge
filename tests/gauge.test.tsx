// context-gauge mod의 입력창 위 사용량 칸(컨텍스트·5h·7d·소진 예상) 표시 동작 테스트
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const PLUGIN = 'context-gauge'
const BAND = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 200,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}
const NOW = Date.parse('2026-11-11T10:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

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

const setup = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  echoMeasure(on)
  engineBand(on)

  return clock
}

const measure = ($: Engine, tokens: number, percent: number, rateLimits: SessionRateLimit[] = []) =>
  $.session.measure({
    context: { tokens, window: 200_000, percent },
    rateLimits,
    changed: rateLimits.length > 0 ? ['context', 'rateLimits'] : ['context'],
  })

const limit = (kind: string, percentUsed: number, resetsInMs: number): SessionRateLimit => ({
  kind,
  percentUsed,
  resetsAt: new Date(NOW + resetsInMs).toISOString(),
})

const FIVE_HOUR = limit('five_hour', 38, 2 * HOUR + 12 * MINUTE)
const SEVEN_DAY = limit('seven_day', 33, DAY + 23 * HOUR)

for (const surface of SURFACES) {
  const mount = ($: Engine, props = BAND) =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })

  test(`${surface}: 측정 전에는 아무것도 그리지 않는다`, async ($, on) => {
    setup(on)
    const ui = await mount($)

    expect(await ui.find({ key: 'context' })).toBeUndefined()
  })

  test(`${surface}: 컨텍스트 칸에 토큰과 퍼센트를 표시한다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($)

    expect(await ui.find({ type: 'Text', text: '84k' })).toBeDefined()
    const percent = await ui.find({ type: 'Text', text: '42%' })
    expect(percent?.props.color).toBe('green')
    expect(await ui.find({ type: 'Text', text: '☀' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'close' })).toBeDefined()
  })

  for (const [percent, color, icon] of [
    [49, 'green', '☀'],
    [50, 'yellow', '⛅'],
    [60, '#ff8700', '☁'],
    [70, 'red', '⛈'],
  ] as const) {
    test(`${surface}: ${percent}%는 ${color} ${icon}`, async ($, on) => {
      setup(on)
      await measure($, percent * 2_000, percent)
      const ui = await mount($)

      const label = await ui.find({ type: 'Text', text: `${percent}%` })
      expect(label?.props.color).toBe(color)
      expect(await ui.find({ type: 'Text', text: icon })).toBeDefined()
    })
  }

  test(`${surface}: 직전 측정 대비 증감을 표시한다`, async ($, on) => {
    setup(on)
    await measure($, 236_287, 50)
    await measure($, 237_000, 50)
    const ui = await mount($)

    expect(await ui.find({ type: 'Text', text: '▲ +713' })).toBeDefined()
  })

  test(`${surface}: 컨텍스트가 줄면 감소로 표시한다`, async ($, on) => {
    setup(on)
    await measure($, 100_000, 50)
    await measure($, 40_000, 20)
    const ui = await mount($)

    expect(await ui.find({ type: 'Text', text: '▼ -60k' })).toBeDefined()
  })

  test(`${surface}: 첫 측정에는 증감을 표시하지 않는다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($)

    expect(await ui.find({ type: 'Text', text: /[▲▼]/ })).toBeUndefined()
  })

  test(`${surface}: 5h·7d 한도와 리셋까지 남은 시간을 표시한다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR, SEVEN_DAY])
    const ui = await mount($)

    expect(await ui.find({ key: 'five_hour' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '38%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↺ 2h12' })).toBeDefined()
    expect(await ui.find({ key: 'seven_day' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '33%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↺ 1d23h' })).toBeDefined()
  })

  test(`${surface}: 한도 정보가 없으면 한도 칸을 그리지 않는다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($)

    expect(await ui.find({ key: 'five_hour' })).toBeUndefined()
    expect(await ui.find({ key: 'seven_day' })).toBeUndefined()
    expect(await ui.find({ key: 'burn' })).toBeUndefined()
  })

  test(`${surface}: 1분마다 남은 시간을 갱신한다`, async ($, on) => {
    const clock = setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR])
    const ui = await mount($)

    await clock.advance(2 * MINUTE)
    await ui.redraw()

    expect(await ui.find({ type: 'Text', text: '↺ 2h10' })).toBeDefined()
  })

  test(`${surface}: 리셋 전에 바닥날 속도면 소진 예상 시간을 표시한다`, async ($, on) => {
    setup(on)
    // 3시간 동안 80%를 썼다: 남은 20%는 45분 뒤 소진, 리셋은 2시간 뒤
    await measure($, 84_000, 42, [limit('five_hour', 80, 2 * HOUR)])
    const ui = await mount($)

    expect(await ui.find({ key: 'burn' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '45m' })).toBeDefined()
  })

  test(`${surface}: 리셋 전에 바닥나지 않을 속도면 소진 예상 시간 대신 —를 표시한다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR])
    const ui = await mount($)

    expect(await ui.find({ key: 'burn' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
  })

  test(`${surface}: 설문이 떠 있으면 양보한다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($, { ...BAND, hasSurvey: true })

    expect(await ui.find({ key: 'context' })).toBeUndefined()
  })

  test(`${surface}: 닫기 버튼을 누르면 사라진다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($)

    await ui.press({ key: 'close' })

    expect(await ui.find({ key: 'context' })).toBeUndefined()
  })

  test(`${surface}: 명령으로 닫은 게이지를 다시 켠다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($)
    await ui.press({ key: 'close' })

    const shown = await $.command.run(RUN_TOGGLE)
    expect(shown.text).toBe('Usage gauge shown.')
    await ui.redraw()
    expect(await ui.find({ key: 'context' })).toBeDefined()

    const hidden = await $.command.run(RUN_TOGGLE)
    expect(hidden.text).toBe('Usage gauge hidden.')
  })
}

test('terminal: 증감 추이를 문자 스파크라인으로 그린다', async ($, on) => {
  setup(on)
  for (const tokens of [10_000, 20_000, 80_000]) await measure($, tokens, 10)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ type: 'Text', text: '▁▂█' })).toBeDefined()
})

test('terminal: 한도 막대를 사용(█)·경과 시간(▒)·빈칸(░) 8칸으로 그린다', async ($, on) => {
  setup(on)
  // 38% 사용, 창 경과 56%: 사용 3칸, 경과 빗금 1칸, 빈칸 4칸
  await measure($, 84_000, 42, [FIVE_HOUR])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })

  const filled = await ui.find({ type: 'Text', text: '███' })
  expect(filled?.props.color).toBe('green')
  expect(await ui.find({ type: 'Text', text: '▒' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '░░░░' })).toBeDefined()
})

test('desktop: 칸을 둥근 테두리로, 막대와 스파크라인을 SVG로 그린다', async ($, on) => {
  setup(on)
  await measure($, 80_000, 40)
  await measure($, 84_000, 42, [FIVE_HOUR])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect((await ui.find({ key: 'context' }))?.props.borderStyle).toBe('round')
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.find(svg => svg.props.alt === 'Context history')?.props.source).toContain('<rect')
  const bar = svgs.find(svg => svg.props.alt === '5h 38%')
  expect(bar?.props.source).toContain('fill="url(#h)"')
  expect(bar?.props.source).toContain('fill="green"')
  expect(await ui.find({ text: /█/ })).toBeUndefined()
})

// 터미널 폭 계산 기준(▲ +713, 5h·7d, ⚡ —): 전체 96칸, 스파크라인·증감 제외 82칸, 막대·컨텍스트 % 제외 60칸, 리셋 제외 41칸
const RESPONSIVE = [
  { columns: 96, shown: ['▲ +713', '███', '↺ 2h12'], hidden: [] },
  { columns: 90, shown: ['███', '↺ 2h12', '50%'], hidden: ['▲ +713'] },
  { columns: 70, shown: ['↺ 2h12', '38%'], hidden: ['▲ +713', '███', '50%'] },
  { columns: 50, shown: ['38%', '33%', '—'], hidden: ['↺ 2h12', '███'] },
  { columns: 30, shown: ['237k', '38%', '33%', '—'], hidden: ['↺ 2h12'] },
] as const

for (const { columns, shown, hidden } of RESPONSIVE) {
  test(`terminal: ${columns}칸이면 덜 중요한 항목부터 빼고 한 줄로 그린다`, async ($, on) => {
    setup(on)
    await measure($, 236_287, 50)
    await measure($, 237_000, 50, [FIVE_HOUR, SEVEN_DAY])
    const ui = await $.ui.mount({
      plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: columns },
    })

    for (const text of shown) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    for (const text of hidden) expect(await ui.find({ type: 'Text', text })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'close' })).toBeDefined()
  })
}

for (const surface of SURFACES) {
  test(`${surface}: 칸과 닫기 버튼을 줄바꿈 없이 한 줄에 둔다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR, SEVEN_DAY])
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 40 } })

    const row = (await ui.findAll({ type: 'Box' })).find(box => box.props.flexWrap !== undefined)
    expect(row?.props.flexWrap).toBe('nowrap')
    expect(row?.props.flexDirection).toBe('row')
  })
}

test('desktop: 칸의 위아래 여백을 두지 않는다', async ($, on) => {
  setup(on)
  await measure($, 84_000, 42)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })

  expect((await ui.find({ key: 'context' }))?.props.paddingY).toBe(0)
})
