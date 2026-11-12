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

  test(`${surface}: 컨텍스트 칸에 증감은 표시하지 않는다`, async ($, on) => {
    setup(on)
    await measure($, 236_287, 50)
    await measure($, 237_000, 50)
    const ui = await mount($)

    expect(await ui.find({ type: 'Text', text: /[▲▼]/ })).toBeUndefined()
  })

  for (const [percent, color] of [
    [69, 'green'],
    [70, 'yellow'],
    [80, '#ff8700'],
    [90, 'red'],
  ] as const) {
    test(`${surface}: 한도 ${percent}%는 숫자와 막대가 ${color}`, async ($, on) => {
      setup(on)
      await measure($, 84_000, 42, [limit('five_hour', percent, 2 * HOUR), limit('seven_day', percent, DAY)])
      const ui = await mount($)

      const labels = (await ui.findAll({ type: 'Text' })).filter(node => node.text === `${percent}%`)
      expect(labels).toHaveLength(2)
      for (const label of labels) expect(label.props.color).toBe(color)
      if (surface === 'desktop') {
        const bar = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === `5h ${percent}%`)
        expect(bar?.props.source).toContain(`fill="${color}"`)
      } else {
        const filled = (await ui.findAll({ type: 'Text' })).find(node => node.text.startsWith('█'))
        expect(filled?.props.color).toBe(color)
      }
    })
  }

  test(`${surface}: 5h·7d 한도와 리셋까지 남은 시간을 표시한다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR, SEVEN_DAY])
    const ui = await mount($)

    expect(await ui.find({ key: 'five_hour' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '38%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2h12' })).toBeDefined()
    expect(await ui.find({ key: 'seven_day' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '33%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1d23h' })).toBeDefined()
  })

  test(`${surface}: 한도 정보가 없으면 한도 칸을 그리지 않는다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42)
    const ui = await mount($)

    expect(await ui.find({ key: 'five_hour' })).toBeUndefined()
    expect(await ui.find({ key: 'seven_day' })).toBeUndefined()
  })

  test(`${surface}: 1분마다 남은 시간을 갱신한다`, async ($, on) => {
    const clock = setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR])
    const ui = await mount($)

    await clock.advance(2 * MINUTE)
    await ui.redraw()

    expect(await ui.find({ type: 'Text', text: '2h10' })).toBeDefined()
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

// 화면에 그려진 Text 중 내용이 정확히 같은 것들
const textsEqual = <T extends { text: string }>(nodes: T[], text: string) => nodes.filter(node => node.text === text)

test('terminal: 한도 막대를 사용(█)·경과 시간(▒)·빈칸(░)으로 그린다', async ($, on) => {
  setup(on)
  // 58칸이면 칸마다 25칸. 5h 칸은 막대 최소 4칸으로 21칸이라 막대 8칸: 38% 사용, 창 경과 56%면 사용 3칸, 빗금 1칸, 빈칸 4칸
  await measure($, 84_000, 42, [FIVE_HOUR])
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 58 },
  })

  const [filled] = textsEqual(await ui.findAll({ type: 'Text' }), '███')
  expect(filled?.props.color).toBe('green')
  expect(textsEqual(await ui.findAll({ type: 'Text' }), '▒')).toHaveLength(1)
  expect(textsEqual(await ui.findAll({ type: 'Text' }), '░░░░')).toHaveLength(1)
})

test('terminal: 칸 폭을 같게 맞추고 남는 만큼 칸마다 막대를 늘린다', async ($, on) => {
  setup(on)
  // 100칸이면 칸마다 (100 - 칸 사이 6 - 닫기 4) / 3 = 30칸. 막대 최소 4칸 기준 5h는 21칸이라 막대 13칸(사용 5·빗금 2·빈칸 6),
  // 7d는 22칸이라 막대 12칸(사용 4·빗금 5·빈칸 3)
  await measure($, 236_287, 50)
  await measure($, 237_000, 50, [FIVE_HOUR, SEVEN_DAY])
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 100 },
  })

  for (const key of ['context', 'five_hour', 'seven_day']) expect((await ui.find({ key }))?.props.minWidth).toBe(30)
  const texts = await ui.findAll({ type: 'Text' })
  for (const bar of ['█████', '▒▒', '░░░░░░', '████', '▒▒▒▒▒', '░░░']) expect(textsEqual(texts, bar)).toHaveLength(1)
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

// 터미널 폭 계산 기준(스파크라인 2칸, 5h·7d, 막대 최소 4칸, 칸 사이·닫기 10칸). 같은 폭이면 가장 넓은 칸 × 3, 내용 폭이면 칸 합계가 든다.
// 같은 폭: 전체 표시와 스파크라인 제외 모두 76칸(가장 넓은 7d 22칸), 리셋·토큰 수 제외 52칸, 막대 제외 37칸
// 내용 폭: 전체 표시 67칸, 스파크라인 제외 64칸, 리셋·토큰 수 제외 44칸, 막대 제외 34칸
// 더 많이 보이는 쪽을 고르고, 같으면 같은 폭으로 그린다
const BAR = /^█+$/
const SPARK = '▁█'
const RESPONSIVE = [
  { columns: 76, shown: [SPARK, BAR, '2h12', '237k'], hidden: [], isEqual: true },
  { columns: 75, shown: [SPARK, BAR, '2h12', '237k'], hidden: [], isEqual: false },
  { columns: 67, shown: [SPARK, BAR, '2h12', '237k'], hidden: [], isEqual: false },
  { columns: 66, shown: [BAR, '2h12', '237k'], hidden: [SPARK], isEqual: false },
  { columns: 64, shown: [BAR, '2h12', '237k'], hidden: [SPARK], isEqual: false },
  { columns: 63, shown: [BAR, '50%', '38%'], hidden: [SPARK, '2h12', '237k'], isEqual: true },
  { columns: 51, shown: [BAR, '50%', '38%'], hidden: [SPARK, '2h12', '237k'], isEqual: false },
  { columns: 44, shown: [BAR, '50%', '38%'], hidden: [SPARK, '2h12', '237k'], isEqual: false },
  { columns: 43, shown: ['50%', '38%', '33%'], hidden: [BAR, '2h12', '237k'], isEqual: true },
  { columns: 30, shown: ['50%', '38%', '33%'], hidden: [BAR, '2h12', '237k'], isEqual: true },
] as const

for (const { columns, shown, hidden, isEqual } of RESPONSIVE) {
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
    expect((await ui.find({ key: 'context' }))?.props.minWidth !== undefined).toBe(isEqual)
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

// 데스크톱 폭 계산 기준(5h·7d, 글자 0.92칸, 칸 안 간격 0.5칸, 간격·닫기·여유 8칸):
// 내용 폭으로 전체 표시는 11.86 + 16.7 + 17.62 + 8 = 54.18칸이라 55칸부터. 앱에서 실측한 밴드 폭은 85칸
for (const { columns, isFull } of [{ columns: 85, isFull: true }, { columns: 55, isFull: true }, { columns: 54, isFull: false }] as const) {
  test(`desktop: ${columns}칸이면 스파크라인을 ${isFull ? '그린다' : '뺀다'}`, async ($, on) => {
    setup(on)
    await measure($, 236_287, 50)
    await measure($, 237_000, 50, [FIVE_HOUR, SEVEN_DAY])
    const ui = await $.ui.mount({
      plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: columns },
    })

    const spark = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Context history')
    expect(spark !== undefined).toBe(isFull)
  })
}

test('desktop: 칸 폭을 같게 맞추고 남는 만큼 한도 막대 SVG를 넓힌다', async ($, on) => {
  setup(on)
  // 85칸이면 칸마다 (85 - 간격·닫기·여유 8) / 3 = 25칸. 막대 최소 12px 기준 5h는 16.7칸이라 8칸(72px)을 더해 12px → 84px
  await measure($, 236_287, 50)
  await measure($, 237_000, 50, [FIVE_HOUR, SEVEN_DAY])
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 85 },
  })

  const bar = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === '5h 38%')
  expect(bar?.props.width).toBe(84)
  expect(bar?.props.source).toContain('width="84"')
  for (const key of ['context', 'five_hour', 'seven_day']) expect((await ui.find({ key }))?.props.minWidth).toBe(25)
})

for (const surface of SURFACES) {
  test(`${surface}: 남는 자투리는 칸을 넓혀 채운다`, async ($, on) => {
    setup(on)
    await measure($, 84_000, 42, [FIVE_HOUR, SEVEN_DAY])
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

    for (const key of ['context', 'five_hour', 'seven_day']) {
      const pill = await ui.find({ key })
      expect(pill?.props.flexGrow).toBe(1)
      expect(pill?.props.justifyContent).toBe('center')
    }
  })
}

// 인수인계 요청: 엔진 자리에서 제출된 프롬프트와 알림을 모은다
const recordHandoff = (on: On) => {
  const prompts: string[] = []
  const notices: string[] = []
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('ui.notify', ($, e) => {
    notices.push(e.text)

    return { value: { isSent: true, channel: 'client' } as const }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return { prompts, notices }
}

const HANDOFF = { options: { autoHandoff: true } }

test('설정이 꺼져 있으면 80%를 넘어도 인수인계를 요청하지 않는다', async ($, on) => {
  setup(on)
  const { prompts } = recordHandoff(on)
  await measure($, 170_000, 85)

  expect(prompts).toHaveLength(0)
})

test('80%를 처음 넘을 때 한 번만 인수인계를 요청한다', HANDOFF, async ($, on) => {
  setup(on)
  const { prompts } = recordHandoff(on)
  await measure($, 158_000, 79)
  expect(prompts).toHaveLength(0)

  await measure($, 160_000, 80)
  await measure($, 170_000, 85)

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('[context-gauge handoff]')
})

test('80% 아래로 내려갔다가 다시 넘으면 다시 요청한다', HANDOFF, async ($, on) => {
  setup(on)
  const { prompts } = recordHandoff(on)
  await measure($, 170_000, 85)
  await measure($, 60_000, 30)
  await measure($, 162_000, 81)

  expect(prompts).toHaveLength(2)
})

test('인수인계 턴이 끝나면 새 세션이나 /clear를 권하는 알림을 보낸다', HANDOFF, async ($, on) => {
  setup(on)
  const { prompts, notices } = recordHandoff(on)
  await measure($, 170_000, 85)

  await $.turn.start({ text: prompts[0] ?? '', turnId: 'handoff' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'handoff', reason: 'answer' })

  expect(notices).toEqual(['Handoff document written. Start a new session or run /clear to free the context.'])
})

test('다른 턴이 끝날 때는 알림을 보내지 않는다', HANDOFF, async ($, on) => {
  setup(on)
  const { notices } = recordHandoff(on)
  await measure($, 170_000, 85)

  await $.turn.start({ text: 'something else', turnId: 'other' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'other', reason: 'answer' })

  expect(notices).toHaveLength(0)
})

test('인수인계 턴이 중단되면 끝나지 않았다고 알린다', HANDOFF, async ($, on) => {
  setup(on)
  const { prompts, notices } = recordHandoff(on)
  await measure($, 170_000, 85)

  await $.turn.start({ text: prompts[0] ?? '', turnId: 'handoff' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'handoff', reason: 'aborted' })

  expect(notices).toEqual(['The handoff document was not finished.'])
})

// 체크리스트: 엔진 자리에서 작업 폴더의 checklist.md를 돌려준다(없으면 실제 파일 시스템으로 넘겨 읽기 실패)
const serveChecklist = (on: On, file: { text: string | null }) =>
  on('fs.read', ($, e, next) =>
    e.path.endsWith('/checklist.md') && file.text !== null ? { value: file.text } : next(e))

const CHECKLIST = [
  '# 작업',
  '- [x] 4-b3 명명 도우미',
  '- [X] 4-b4 재적재 메뉴 제거',
  '  - [ ] 4-c1 명명 규칙 정리',
  '* [ ] 4-c2 검증 화면',
  '- 체크박스 아닌 줄',
].join('\n')

for (const surface of SURFACES) {
  const mount = ($: Engine, props = BAND) =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })

  test(`${surface}: checklist.md가 있으면 완료 수와 다음 항목을 맨 오른쪽에 표시한다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: CHECKLIST })
    await measure($, 84_000, 42, [FIVE_HOUR, SEVEN_DAY])
    const ui = await mount($)

    expect(await ui.find({ key: 'checklist' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '☑' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2/4' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▸ 4-c1 명명 규칙 정리' })).toBeDefined()
    const pills = (await ui.findAll({ type: 'Box' })).filter(box => box.props.flexGrow === 1)
    expect(pills.at(-1)?.key).toBe('checklist')
  })

  test(`${surface}: checklist.md가 없으면 체크리스트 칸을 그리지 않는다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: null })
    await measure($, 84_000, 42)
    const ui = await mount($)

    expect(await ui.find({ key: 'context' })).toBeDefined()
    expect(await ui.find({ key: 'checklist' })).toBeUndefined()
  })

  test(`${surface}: 모두 끝나면 완료 수를 초록으로 표시하고 다음 항목은 뺀다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: '- [x] a\n- [x] b' })
    await measure($, 84_000, 42)
    const ui = await mount($)

    expect((await ui.find({ type: 'Text', text: '2/2' }))?.props.color).toBe('green')
    expect(await ui.find({ type: 'Text', text: /^▸/ })).toBeUndefined()
  })

  test(`${surface}: 1분마다 checklist.md를 다시 읽는다`, async ($, on) => {
    const clock = setup(on)
    const file = { text: CHECKLIST as string | null }
    serveChecklist(on, file)
    await measure($, 84_000, 42)
    const ui = await mount($)

    file.text = CHECKLIST.replace('- [ ] 4-c1', '- [x] 4-c1')
    await clock.advance(MINUTE)
    await ui.redraw()

    expect(await ui.find({ type: 'Text', text: '3/4' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▸ 4-c2 검증 화면' })).toBeDefined()
  })
}

test('terminal: 긴 다음 항목은 말줄임표로 줄인다', async ($, on) => {
  setup(on)
  serveChecklist(on, { text: '- [ ] 아주 긴 작업 이름이 들어가서 칸을 넘치는 항목입니다' })
  await measure($, 84_000, 42)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })

  const next = await ui.find({ type: 'Text', text: /^▸/ })
  expect(next?.text.endsWith('…')).toBe(true)
  expect((next?.text.length ?? 0) < 20).toBe(true)
})

test('terminal: 좁으면 다음 항목, 막대 순으로 빼고 완료 수는 남긴다', async ($, on) => {
  setup(on)
  serveChecklist(on, { text: CHECKLIST })
  await measure($, 84_000, 42, [FIVE_HOUR, SEVEN_DAY])
  const narrow = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 40 },
  })

  expect(await narrow.find({ type: 'Text', text: '2/4' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /^▸/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /░/ })).toBeUndefined()
})

// 체크리스트 창: 엔진 자리에서 창 열기·닫기를 기록한다
const recordPane = (on: On) => {
  const events: string[] = []
  let isOpen = false
  on('ui.open', ($, e) => {
    events.push(`open:${e.id}`)
    isOpen = true

    return { value: { isPlaced: true } as const }
  })
  on('ui.close', ($, e) => {
    events.push(`close:${e.id}`)
    isOpen = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: isOpen ? [{ id: 'checklist', title: 'Checklist', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))

  return events
}

const PANE = {
  title: 'Checklist',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

for (const surface of SURFACES) {
  test(`${surface}: 체크리스트 완료 수를 누르면 창을 열고, 다시 누르면 닫는다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: CHECKLIST })
    const events = recordPane(on)
    await measure($, 84_000, 42)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

    await ui.press({ key: 'checklist-open' })
    await ui.press({ key: 'checklist-open' })

    expect(events).toEqual(['open:checklist', 'close:checklist'])
  })

  test(`${surface}: 체크리스트 창에 제목, 완료(✓)·미완료(○) 항목을 들여쓰기대로 그린다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: CHECKLIST })
    await measure($, 84_000, 42)
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: 'checklist' })

    expect((await pane.find({ type: 'Text', text: '작업' }))?.props.bold).toBe(true)
    expect((await pane.find({ type: 'Text', text: '✓ 4-b3 명명 도우미' }))?.props.dimColor).toBe(true)
    const next = await pane.find({ type: 'Text', text: '  ○ 4-c1 명명 규칙 정리' })
    expect(next?.props.bold).toBe(true)
    expect((await pane.find({ type: 'Text', text: '○ 4-c2 검증 화면' }))?.props.bold).not.toBe(true)
    expect(await pane.find({ type: 'Text', text: /체크박스 아닌 줄/ })).toBeUndefined()
  })

  test(`${surface}: checklist.md가 없으면 창에 안내를 표시한다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: null })
    await measure($, 84_000, 42)
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE, requestId: 'checklist' })

    expect(await pane.find({ type: 'Text', text: /No checklist\.md/ })).toBeDefined()
  })
}

test('desktop: 칸 글자를 가장 작은 크기로 그린다', async ($, on) => {
  setup(on)
  await measure($, 84_000, 42, [FIVE_HOUR])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })

  for (const text of ['84k', '42%', '38%']) expect((await ui.find({ type: 'Text', text }))?.props.size).toBe('caption')
})

for (const surface of SURFACES) {
  test(`${surface}: checklist.md가 있으면 닫기 버튼 옆에 체크리스트 창 버튼을 둔다`, async ($, on) => {
    setup(on)
    serveChecklist(on, { text: CHECKLIST })
    await measure($, 84_000, 42)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(button => button.key)).toEqual(['checklist-open', 'close'])
  })
}

test('terminal: 컨텍스트 칸은 아이콘·토큰 수·스파크라인·퍼센트 순서로 그린다', async ($, on) => {
  setup(on)
  await measure($, 236_287, 50)
  await measure($, 237_000, 50)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })

  const texts = (await ui.findAll({ type: 'Text' })).map(node => node.text)
  expect(texts.slice(0, 4)).toEqual(['⛅', '237k', '▁█', '50%'])
})

test('terminal: 리셋까지 남은 시간 앞에 아이콘을 붙이지 않는다', async ($, on) => {
  setup(on)
  await measure($, 84_000, 42, [FIVE_HOUR])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ type: 'Text', text: /↺/ })).toBeUndefined()
})
