/* @jsx h */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { HudCat, HudCtx, HudLimit, HudSnap, HudTokens, HudTurn } from '../types'
import {
  add,
  byModelMd,
  ctxPercent,
  ctxTone,
  hitRate,
  shortLabel,
  ledgerMd,
  longLabel,
  pie,
  ringSvg,
  ordered,
  pct,
  span,
  tokens,
  tone,
  total,
  untilReset,
  usd,
  usedCats,
  ZERO,
} from './view'
import type { Tone } from './view'

// session-hud: contexto, limites do plano e custo numa faixa acima do prompt,
// e um painel com o detalhe (categorias do contexto, ritmo dos limites, turnos).
// Os números vêm de $.session.usage / session.measure, os mesmos que /context,
// /cost e a status line leem; o estado fica em $.state e sobrevive a reloads.

const COMMAND = 'hud'
const PANE = 'session-hud'
const PANE_TITLE = 'Uso da sessão'
const STORE_SAMPLES = 'samples'
const TICK_MS = 30_000
const MAX_TURNS = 200
const MIN = 60_000
const HOUR = 60 * MIN
const WEEK = 7 * 24 * HOUR

const snapAtom = atom({ plugin: 'session-hud', key: 'snap' } as const, null)
const catsAtom = atom({ plugin: 'session-hud', key: 'cats' } as const, [])
const turnsAtom = atom({ plugin: 'session-hud', key: 'turns' } as const, [])
const hiddenAtom = atom({ plugin: 'session-hud', key: 'isHidden' } as const, false)
const nowAtom = atom({ plugin: 'session-hud', key: 'nowMs' } as const, 0)

type Sample = { atMs: number; p: number; resetsAt?: string }
type Measured = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

/** How far back the pace is read, and the least span it needs, per window. */
const PACE: Record<string, { lookback: number; minSpan: number }> = {
  five_hour: { lookback: HOUR, minSpan: 10 * MIN },
  seven_day: { lookback: 12 * HOUR, minSpan: HOUR },
}
const paceOf = (kind: string) => PACE[kind] ?? { lookback: HOUR, minSpan: 10 * MIN }

let samples: Record<string, Sample[]> = {}

const sameReset = (a?: string, b?: string) =>
  !a || !b || Math.abs(Date.parse(a) - Date.parse(b)) < 10 * MIN

function limitOf(l: SessionRateLimit, nowMs: number): HudLimit {
  const { lookback, minSpan } = paceOf(l.kind)
  let kept = samples[l.kind] ?? []
  const prev = kept.at(-1)
  // a drop or a new reset time is a new window: its pace starts over
  if (prev && (l.percentUsed < prev.p - 0.5 || !sameReset(l.resetsAt, prev.resetsAt))) kept = []
  kept = [...kept.filter(s => nowMs - s.atMs < 2 * lookback), { atMs: nowMs, p: l.percentUsed, resetsAt: l.resetsAt }].slice(-300)
  samples[l.kind] = kept

  const limit: HudLimit = { kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt }
  const reset = untilReset(limit, nowMs)
  if (l.kind === 'seven_day') {
    // a semana inteira, noites e pausas incluídas: o pique de algumas horas
    // projetado por dias exagera
    const elapsed = reset !== undefined ? WEEK - reset : undefined
    if (elapsed === undefined || elapsed < 6 * HOUR || l.percentUsed <= 0) return limit
    limit.perHour = (l.percentUsed / elapsed) * HOUR
  } else {
    const recent = kept.filter(s => nowMs - s.atMs <= lookback)
    const first = recent[0]
    const last = recent.at(-1)
    if (!first || !last || last.atMs - first.atMs < minSpan || last.p <= first.p) return limit
    limit.perHour = ((last.p - first.p) / (last.atMs - first.atMs)) * HOUR
  }
  if (l.percentUsed < 100) {
    const eta = ((100 - l.percentUsed) / limit.perHour) * HOUR
    if (reset === undefined || eta < reset) limit.etaMs = eta
  }
  return limit
}

async function measure($: EngineInterface, m: Measured): Promise<void> {
  const nowMs = await $.clock.now()
  let breakdown
  try {
    breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  } catch {
    /* sem breakdown: a janela do modelo vale */
  }

  const c = m.context
  const used = c.tokens ?? breakdown?.totalTokens
  const max = breakdown?.rawMaxTokens || c.window
  const ctx: HudCtx | null =
    used !== undefined && max > 0
      ? {
          tokens: used,
          max,
          modelWindow: c.window,
          compactAt: breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
        }
      : null

  const limits = m.rateLimits.filter(l => Number.isFinite(l.percentUsed)).map(l => limitOf(l, nowMs))
  if (limits.length) {
    try {
      await $.store.set(STORE_SAMPLES, samples)
    } catch {
      /* o ritmo recomeça depois de reiniciar */
    }
  }

  const snap: HudSnap = { ctx, limits, usd: m.cost ? m.cost.usd : null }
  await update($, snapAtom, prev => ({
    ctx: snap.ctx ?? prev?.ctx ?? null,
    // a medição sem leitura de limites mantém a anterior
    limits: snap.limits.length ? snap.limits : prev?.limits ?? [],
    usd: snap.usd ?? prev?.usd ?? null,
  }))

  if (breakdown) {
    const cats: HudCat[] = breakdown.categories
      .filter((k): k is typeof k & { kind: HudCat['kind'] } => k.kind !== 'deferred' && k.tokens > 0)
      .sort((x, y) => y.tokens - x.tokens)
      .map(k => ({ name: k.name, tokens: k.tokens, kind: k.kind }))
    await update($, catsAtom, () => cats)
  }

  const cost = snap.usd
  if (cost !== null) {
    await update($, turnsAtom, ts => {
      const last = ts.at(-1)
      if (!last || last.usdStart === null) return ts
      return [...ts.slice(0, -1), { ...last, usd: Math.max(0, cost - last.usdStart) }]
    })
  }
  await update($, nowAtom, () => nowMs)
}

async function measureNow($: EngineInterface): Promise<void> {
  try {
    await measure($, await $.session.usage())
  } catch {
    /* a próxima medição traz os números */
  }
}

const tokensOf = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): HudTokens =>
  u
    ? {
        input: u.input_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        output: u.output_tokens,
      }
    : ZERO

const newTurn = (n: number, prompt: string, usdStart: number | null): HudTurn => ({
  n,
  prompt,
  model: '',
  main: ZERO,
  sub: ZERO,
  subRuns: 0,
  ms: 0,
  usdStart,
  usd: null,
  isOpen: true,
  isAborted: false,
})

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: PANE_TITLE })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const stored = await $.store.get(STORE_SAMPLES)
      if (stored && typeof stored === 'object') samples = stored as Record<string, Sample[]>
    } catch {
      /* sem histórico de ritmo */
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Uso da sessão: "/hud" mostra/oculta a faixa, "/hud detalhes" abre o painel',
        argumentHint: '[detalhes]',
      })
    } catch (error) {
      $.ui.log(`session-hud: /${COMMAND} não registrado: ${String(error)}`)
    }
    await measureNow($)
    $.clock.every(TICK_MS, () => {
      void $.clock.now().then(nowMs => update($, nowAtom, () => nowMs))
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await measure($, e)
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    const snap = await read($, snapAtom)
    const prompt = e.text.trim().split('\n')[0] ?? ''
    await update($, turnsAtom, ts => {
      const n = (ts.at(-1)?.n ?? 0) + 1
      const closed = ts.map(t => (t.isOpen ? { ...t, isOpen: false } : t))
      return [...closed, newTurn(n, prompt, snap?.usd ?? null)].slice(-MAX_TURNS)
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const tok = tokensOf(e.usage)
    if (e.agentId !== undefined) {
      // turno de subagente: soma no turno principal em andamento (ou no último)
      await update($, turnsAtom, ts => {
        const last = ts.at(-1)
        if (!last) return ts
        return [...ts.slice(0, -1), { ...last, sub: add(last.sub, tok), subRuns: last.subRuns + 1 }]
      })
      return result
    }
    const snap = await read($, snapAtom)
    await update($, turnsAtom, ts => {
      let last = ts.at(-1)
      let rest = ts.slice(0, -1)
      if (!last || !last.isOpen) {
        // o turno começou antes deste módulo carregar
        if (last) rest = ts
        last = newTurn((ts.at(-1)?.n ?? 0) + 1, '', null)
      }
      const done: HudTurn = {
        ...last,
        model: e.usage?.model ?? last.model,
        main: add(last.main, tok),
        ms: e.durationMs,
        isOpen: false,
        isAborted: e.isAborted,
        usd: last.usdStart !== null && snap?.usd != null ? Math.max(0, snap.usd - last.usdStart) : last.usd,
      }
      return [...rest, done].slice(-MAX_TURNS)
    })
    return result
  })

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, turnsAtom, () => [])
      await update($, catsAtom, () => [])
      await update($, snapAtom, prev => (prev ? { ...prev, ctx: null } : prev))
      void $.clock.after(1000, () => void measureNow($))
    }
    return result
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (['detalhes', 'details', 'd', 'painel'].includes(arg)) {
      await update($, hiddenAtom, () => false)
      await openPane($)
      return { text: 'Painel de uso aberto.' }
    }
    const isHidden = await update($, hiddenAtom, h => !h)
    return { text: isHidden ? 'Faixa de uso oculta. /hud mostra de novo.' : 'Faixa de uso visível.' }
  })

  // ── faixa acima do prompt: uma linha, um anel por medida ───────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return next(e)
    const snap = await read($, snapAtom)
    if (!snap) return next(e)
    const nowMs = (await read($, nowAtom)) || (await $.clock.now())
    const cols = e.props.bodyColumns

    type Item = { key: string; p: number; tone: Tone; mark?: number; name: string; value: string; tail?: string; tailTone?: Tone }
    const items: Item[] = []
    const c = snap.ctx
    if (c) {
      items.push({
        key: 'ctx',
        p: ctxPercent(c),
        tone: ctxTone(c),
        mark: c.compactAt ? (c.compactAt / c.max) * 100 : undefined,
        name: 'Contexto',
        value: pct(ctxPercent(c)),
        tail: `${tokens(c.tokens)}/${tokens(c.max)}`,
      })
    }
    for (const l of ordered(snap.limits).slice(0, 2)) {
      const reset = untilReset(l, nowMs)
      const isReset = reset !== undefined && reset <= 0
      const item: Item = {
        key: `lim-${l.kind}`,
        p: isReset ? 0 : l.percent,
        tone: tone(l.percent),
        name: shortLabel(l.kind),
        value: isReset ? '0%' : pct(l.percent),
      }
      if (isReset) item.tail = 'zerou'
      else if (l.kind === 'five_hour' && l.etaMs !== undefined && l.percent >= 70) {
        // só o de 5h alerta na faixa: o ritmo da última hora vale para as próximas
        item.tail = `⚠ acaba em ~${span(l.etaMs)}`
        item.tailTone = 'warning'
      } else if (reset !== undefined) item.tail = `zera em ${span(reset)}`
      items.push(item)
    }
    if (items.length === 0) return next(e)

    if (e.surface === 'desktop') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const withTail = cols >= 80
      return (
        <Box flexDirection="row" alignItems="center" flexWrap="nowrap" overflow="hidden" columnGap={2}>
          {items.map((it, i) => (
            <Box key={it.key} flexDirection="row" alignItems="center" columnGap={2}>
              {i > 0 ? <Text color="subtle">│</Text> : null}
              <Svg source={ringSvg(it.p, it.tone, 14, it.mark)} alt={`${it.name} ${it.value}`} width={14} height={14} />
              <Text wrap="truncate">
                <Text color="subtle">{`${it.name} `}</Text>
                <Text bold color={it.tone === 'success' ? 'text' : it.tone}>{it.value}</Text>
                {withTail && it.tail ? <Text color={it.tailTone ?? 'subtle'}>{`  ${it.tail}`}</Text> : null}
              </Text>
            </Box>
          ))}
          <Text color="subtle">│</Text>
          <Button key="open" label="Detalhes" plain onPress={() => void openPane($)} />
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      const sep = '  │  '
      const widthOf = (withTail: boolean) =>
        items.reduce((a, it) => a + 2 + it.name.length + 1 + it.value.length + (withTail && it.tail ? 1 + it.tail.length : 0), 0) +
        sep.length * items.length +
        'detalhes'.length
      const withTail = widthOf(true) <= cols - 2
      return (
        <Box flexDirection="row">
          <Text wrap="truncate">
            {items.map((it, i) => (
              <Text key={it.key}>
                {i > 0 ? <Text color="subtle">{sep}</Text> : null}
                <Text color={it.tone}>{`${pie(it.p)} `}</Text>
                <Text color="subtle">{`${it.key === 'ctx' && !withTail ? 'ctx' : it.name} `}</Text>
                <Text bold color={it.tone === 'success' ? 'text' : it.tone}>{it.value}</Text>
                {withTail && it.tail ? <Text color={it.tailTone ?? 'subtle'}>{` ${it.tail}`}</Text> : null}
              </Text>
            ))}
            <Text color="subtle">{sep}</Text>
          </Text>
          <Button key="open" label="detalhes" plain dimColor onPress={() => void openPane($)} />
        </Box>
      )
    }

    return next(e)
  })

  // ── painel de detalhes: um cartão por assunto ───────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Button } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
    const snap = await read($, snapAtom)
    const cats = await read($, catsAtom)
    const turns = await read($, turnsAtom)
    const isHidden = await read($, hiddenAtom)
    const nowMs = (await read($, nowAtom)) || (await $.clock.now())
    const isWide = e.props.bodyColumns >= 90

    const ring = (key: string, p: number, t: Tone, size: number, mark?: number) =>
      Svg ? (
        <Svg key={key} source={ringSvg(p, t, size, mark)} alt={pct(p)} width={size} height={size} />
      ) : (
        <Text key={key} color={t}>
          {pie(p)}
        </Text>
      )
    const strong = (t: Tone) => (t === 'success' ? 'text' : t)
    const card = (key: string, title: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginBottom={1} rowGap={1}>
        <Text bold>{title}</Text>
        {children}
      </Box>
    )

    // Contexto
    const ctxBody: RenderChildren[] = []
    const c = snap?.ctx
    if (c) {
      const p = ctxPercent(c)
      const t = ctxTone(c)
      ctxBody.push(
        <Box key="ctx-head" flexDirection="row" alignItems="center" columnGap={2}>
          {ring('ctx-ring', p, t, 28, c.compactAt ? (c.compactAt / c.max) * 100 : undefined)}
          <Box flexDirection="column">
            <Text>
              <Text bold color={strong(t)}>{pct(p)}</Text>
              <Text color="subtle">{`  ${tokens(c.tokens)} de ${tokens(c.max)} tokens`}</Text>
            </Text>
            <Text color="subtle">
              {c.compactAt
                ? c.tokens >= c.compactAt
                  ? `passou do ponto de compactação (${tokens(c.compactAt)})`
                  : `compacta em ${tokens(c.compactAt)} · faltam ${tokens(c.compactAt - c.tokens)}`
                : 'compactação automática desligada'}
            </Text>
          </Box>
        </Box>,
      )
      if (c.modelWindow && c.modelWindow !== c.max) {
        ctxBody.push(
          <Text key="ctx-model" dimColor>
            {`Janela do modelo ${tokens(c.modelWindow)} — a status line mostra ${pct((c.tokens / c.modelWindow) * 100)}.`}
          </Text>,
        )
      }
      if (usedCats(cats).length) {
        const ordered = [...cats.filter(k => k.kind === 'used'), ...cats.filter(k => k.kind !== 'used')]
        const rows = ordered.map(k =>
          k.kind === 'used'
            ? `| ${k.name} | ${tokens(k.tokens)} | ${pct((k.tokens / c.max) * 100)} |`
            : `| _${k.name}_ | _${tokens(k.tokens)}_ | _${pct((k.tokens / c.max) * 100)}_ |`,
        )
        ctxBody.push(<Markdown key="ctx-cats" text={['| categoria | tokens | % |', '|:--|--:|--:|', ...rows].join('\n')} />)
      }
    } else {
      ctxBody.push(
        <Text key="ctx-none" color="subtle">
          Sem leitura ainda — aparece depois da primeira resposta.
        </Text>,
      )
    }

    // Limites
    const limBody: RenderChildren[] = []
    const limits = ordered(snap?.limits ?? [])
    if (limits.length === 0) {
      limBody.push(
        <Text key="lim-none" color="subtle">
          Sem leitura (fora de assinatura, ou antes da primeira resposta).
        </Text>,
      )
    }
    for (const l of limits) {
      const t = tone(l.percent)
      const reset = untilReset(l, nowMs)
      const isReset = reset !== undefined && reset <= 0
      const pace =
        !isReset && l.perHour !== undefined
          ? `${l.kind === 'seven_day' ? 'média da semana' : 'ritmo da última hora'} +${l.perHour.toFixed(1).replace('.', ',')}%/h → ` +
            (l.etaMs !== undefined
              ? `chegaria a 100% em ~${span(l.etaMs)}, antes de zerar`
              : 'não chega a 100% antes de zerar')
          : undefined
      limBody.push(
        <Box key={`lim-${l.kind}`} flexDirection="row" alignItems="center" columnGap={2}>
          {ring(`lim-ring-${l.kind}`, isReset ? 0 : l.percent, t, 22)}
          <Box flexDirection="column">
            <Text>
              <Text>{`${longLabel(l.kind)}  `}</Text>
              <Text bold color={strong(t)}>{isReset ? '0%' : pct(l.percent)}</Text>
              <Text color="subtle">
                {isReset ? '  zerou · atualiza na próxima resposta' : reset !== undefined ? `  zera em ${span(reset)}` : ''}
              </Text>
            </Text>
            {pace ? <Text color={l.etaMs !== undefined ? 'warning' : 'subtle'}>{pace}</Text> : null}
          </Box>
        </Box>,
      )
    }

    // Custo
    const finished = turns.filter(t => !t.isOpen && t.usd !== null)
    const avg = finished.length ? finished.reduce((a, t) => a + (t.usd ?? 0), 0) / finished.length : null
    const all = turns.reduce((a, t) => add(add(a, t.main), t.sub), ZERO)
    const subAll = turns.reduce((a, t) => add(a, t.sub), ZERO)
    const last = turns.at(-1)
    const stat = (key: string, name: string, value: string) => (
      <Box key={key} flexDirection="column">
        <Text color="subtle">{name}</Text>
        <Text bold>{value}</Text>
      </Box>
    )
    const costBody: RenderChildren[] = [
      <Box key="cost-stats" flexDirection="row" columnGap={4} flexWrap="wrap">
        {stat('s-total', 'Sessão', usd(snap?.usd ?? null))}
        {last && last.usd !== null ? stat('s-last', 'Último turno', usd(last.usd)) : null}
        {avg !== null ? stat('s-avg', 'Média/turno', usd(avg)) : null}
        {total(all) > 0 ? stat('s-cache', 'Lido do cache', pct(hitRate(all) * 100)) : null}
        {total(subAll) > 0
          ? stat('s-sub', 'Subagentes', pct(((total(subAll) + subAll.output) / Math.max(1, total(all) + all.output)) * 100))
          : null}
      </Box>,
      <Text key="cost-note" dimColor>
        Equivalente em preço de API; na assinatura não é cobrado assim.
      </Text>,
    ]
    const models = byModelMd(turns)
    if (models) costBody.push(<Markdown key="models" text={models} />)

    // Turnos
    const turnBody: RenderChildren[] = [
      <Markdown key="ledger" text={ledgerMd(turns, isWide ? 15 : 10, isWide)} />,
      <Text key="ledger-note" dimColor>
        entrada = sem cache + lida + gravada no cache · custo = alta do total da sessão no turno (com subagentes) · ⏳ em
        andamento · ⨯ interrompido
      </Text>,
    ]

    return (
      <Box flexDirection="column">
        {card('c-ctx', 'Contexto', ctxBody)}
        {card('c-lim', 'Limites do plano', limBody)}
        {card('c-cost', 'Custo', costBody)}
        {card('c-turns', 'Turnos', turnBody)}
        <Box key="actions" flexDirection="row" columnGap={2}>
          <Button
            key="toggle"
            label={isHidden ? 'Mostrar faixa' : 'Ocultar faixa'}
            onPress={() => void update($, hiddenAtom, h => !h)}
          />
          <Button key="refresh" label="Atualizar" onPress={() => void measureNow($)} />
        </Box>
      </Box>
    )
  })
}
