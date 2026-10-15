/* @jsx h */
import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

/** What the engine answers beneath the plugins, for the events the mod hooks. */
const engine = (on: On, current: () => SessionUsage) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: current() }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
}

const NOW = Date.parse('2026-10-14T12:00:00Z')

const usage = (cost: number, tokens: number): SessionUsage => ({
  startedAt: NOW - 60_000,
  context: {
    tokens,
    window: 1_000_000,
    percent: Math.round((tokens / 1_000_000) * 100),
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 8_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: tokens - 8_000, color: 'text', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 200_000 - tokens, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: tokens,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model' as never,
      percentage: Math.round((tokens / 200_000) * 100),
      gridRows: [],
      model: 'claude-opus-5-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 17.5, resetsAt: new Date(NOW + 4 * 86_400_000).toISOString() },
  ],
  cost: { usd: cost },
})

const BAND = (bodyColumns: number) => ({
  plugin: 'session-hud',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('mede como o /context e atribui o custo ao turno', async ($, on) => {
  let current = usage(1, 50_000)
  engine(on, () => current)

  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'arruma o build\nresto', turnId: 't1' })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 12_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 900, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 9_900 },
  })
  current = usage(1.42, 50_000)
  await $.session.measure({ context: current.context, rateLimits: current.rateLimits, cost: current.cost, changed: ['cost'] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND(160), surface })
    // 50k de 200k (janela do /context), não de 1M (janela do modelo)
    expect(await ui.find({ text: '25%' })).toBeDefined()
    expect(await ui.find({ text: /42%/ })).toBeDefined()
    // custo só no painel
    expect(await ui.find({ text: /\$/ })).toBeUndefined()
    expect(await ui.find({ key: 'open' })).toBeDefined()
  }

  const narrow = await $.ui.mount({ ...BAND(50), surface: 'terminal' })
  expect(await narrow.find({ text: '25%' })).toBeDefined()

  const pane = await $.ui.mount({
    plugin: 'session-hud',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'session-hud',
    props: { title: 'Uso', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await pane.find({ type: 'Markdown', text: /arruma o build/ })).toBeDefined()
  expect(await pane.find({ type: 'Markdown', text: /Opus 5\.5/ })).toBeDefined()
  expect(await pane.find({ text: /faltam 117k/ })).toBeDefined()
  expect(await pane.find({ text: '$1,42' })).toBeDefined()
  expect(await pane.find({ text: '$0,42' })).toBeDefined()
})

test('/hud oculta a faixa', async ($, on) => {
  engine(on, () => usage(1, 50_000))
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hud', args: '' } as never)
  const ui = await $.ui.mount({ ...BAND(160), surface: 'terminal' })
  expect(await ui.find({ key: 'open' })).toBeUndefined()
})

test('semanal: faixa mostra quando zera, projeção pela média da semana só no painel', async ($, on) => {
  const u = usage(1, 50_000)
  u.rateLimits = [{ kind: 'seven_day', percentUsed: 60, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() }]
  engine(on, () => u)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND(160), surface })
    expect(await ui.find({ text: /zera em 3d/ })).toBeDefined()
    expect(await ui.find({ text: /acaba|esgota/ })).toBeUndefined()
  }
  const pane = await $.ui.mount({
    plugin: 'session-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-hud',
    props: { title: 'Uso', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  // 60% em 4 dias = 0,6%/h; faltam 40% → ~2d16h, antes do reset em 3d
  expect(await pane.find({ text: /média da semana \+0,6%\/h → chegaria a 100% em ~2d16h/ })).toBeDefined()
})
