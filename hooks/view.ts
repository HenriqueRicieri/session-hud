// Formatting: plain data in, strings out. Nothing here touches `$`.

import type { HudCat, HudCtx, HudLimit, HudTokens, HudTurn } from '../types'

export const tokens = (n: number): string => {
  const a = Math.abs(n)
  if (a < 1000) return String(Math.round(n))
  if (a < 1_000_000) return `${(n / 1000).toFixed(a < 10_000 ? 1 : 0)}k`
  return `${String(+(n / 1_000_000).toFixed(a < 10_000_000 ? 2 : 1))}M`
}

export const usd = (n: number | null): string => {
  if (n === null) return '—'
  if (n > 0 && n < 0.01) return '<$0,01'
  return `$${n.toFixed(2).replace('.', ',')}`
}

/** "45min", "2h10", "3d4h". */
export const span = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return h % 24 ? `${Math.floor(h / 24)}d${h % 24}h` : `${h / 24}d`
}

export const seconds = (ms: number): string =>
  ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : span(ms)

export const pct = (n: number): string => `${Math.round(n)}%`

/** "claude-opus-5-5" → "Opus 5.5"; "claude-3-5-sonnet-20241022" → "Sonnet 3.5". */
export const modelName = (id: string): string => {
  const s = id.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  const a = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(s)
  if (a?.[1]) return `${cap(a[1])} ${a[2]}${a[3] ? `.${a[3]}` : ''}`
  const b = /^claude-(\d+)(?:-(\d+))?-([a-z]+)$/.exec(s)
  if (b?.[3]) return `${cap(b[3])} ${b[1]}${b[2] ? `.${b[2]}` : ''}`
  return s.replace(/^claude-/, '')
}
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'Semana', spend_limit: 'Gasto' }
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const LONG: Record<string, string> = {
  five_hour: 'Janela de 5 horas',
  seven_day: 'Semanal (7 dias)',
  spend_limit: 'Limite de gasto',
}
const ORDER = ['five_hour', 'seven_day', 'spend_limit']

export const label = (kind: string): string => LABEL[kind] ?? kind.replace(/_/g, ' ')
export const shortLabel = (kind: string): string => SHORT[kind] ?? label(kind)
export const longLabel = (kind: string): string => LONG[kind] ?? label(kind)

export const ordered = (limits: HudLimit[]): HudLimit[] =>
  [...limits].sort((a, b) => {
    const ia = ORDER.indexOf(a.kind)
    const ib = ORDER.indexOf(b.kind)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

export type Tone = 'success' | 'warning' | 'error'

export const tone = (p: number): Tone => (p >= 90 ? 'error' : p >= 70 ? 'warning' : 'success')

/** Context fill, judged against where it compacts (or the window, with compaction off). */
export const ctxPercent = (c: HudCtx): number => (c.tokens / Math.max(1, c.max)) * 100
export const ctxTone = (c: HudCtx): Tone => tone((c.tokens / Math.max(1, c.compactAt ?? c.max)) * 100)

/** Ms until the window resets, or undefined; negative once it has. */
export const untilReset = (l: HudLimit, nowMs: number): number | undefined => {
  if (!l.resetsAt) return undefined
  const at = Date.parse(l.resetsAt)
  return Number.isFinite(at) ? at - nowMs : undefined
}

const HEX: Record<Tone, string> = { success: '#2f9e6a', warning: '#d99a1e', error: '#e5534b' }

/**
 * A progress ring as an SVG image: mid-tone arc on a translucent track, so it
 * reads on light and dark alike; `mark` draws a tick (the compaction point).
 */
export function ringSvg(p: number, t: Tone, size: number, mark?: number): string {
  const sw = Math.max(2, size / 6)
  const r = (size - sw) / 2
  const c = size / 2
  const len = 2 * Math.PI * r
  const on = Math.max(0, Math.min(100, p)) / 100 * len
  const arc = on > 0
    ? `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${HEX[t]}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${on.toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
    : ''
  let tick = ''
  if (mark !== undefined && mark > 0 && mark < 100) {
    const a = (mark / 100) * 2 * Math.PI - Math.PI / 2
    const x1 = c + (r - sw / 2) * Math.cos(a), y1 = c + (r - sw / 2) * Math.sin(a)
    const x2 = c + (r + sw / 2) * Math.cos(a), y2 = c + (r + sw / 2) * Math.sin(a)
    tick = `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#888" stroke-width="1.5"/>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="#8886" stroke-width="${sw}"/>${arc}${tick}</svg>`
  )
}

/** A pie glyph for a fill level, the terminal's ring. */
export const pie = (p: number): string =>
  p < 12.5 ? '○' : p < 37.5 ? '◔' : p < 62.5 ? '◑' : p < 87.5 ? '◕' : '●'

export const total = (t: HudTokens): number => t.input + t.cacheRead + t.cacheWrite

export const hitRate = (t: HudTokens): number => {
  const all = total(t)
  return all > 0 ? t.cacheRead / all : 0
}

export const add = (a: HudTokens, b: HudTokens): HudTokens => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
})

export const ZERO: HudTokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')

/** The ledger of the last `rows` main turns as a Markdown table. */
export function ledgerMd(turns: HudTurn[], rows: number, isWide: boolean): string {
  const shown = turns.slice(-rows).reverse()
  if (shown.length === 0) return '_Nenhum turno ainda._'
  const head = isWide
    ? ['#', 'pedido', 'modelo', 'entrada', 'cache', 'saída', 'subagentes', 'tempo', 'custo']
    : ['#', 'modelo', 'entrada', 'cache', 'saída', 'tempo', 'custo']
  const align = isWide
    ? ['--:', ':--', ':--', '--:', '--:', '--:', '--:', '--:', '--:']
    : ['--:', ':--', '--:', '--:', '--:', '--:', '--:']
  const md = [`| ${head.join(' | ')} |`, `|${align.join('|')}|`]
  for (const t of shown) {
    const prompt = t.prompt.length > 28 ? `${t.prompt.slice(0, 27)}…` : t.prompt
    const flag = t.isOpen ? ' ⏳' : t.isAborted ? ' ⨯' : ''
    const cost = t.usd === null ? '—' : usd(t.usd)
    const sub = t.subRuns > 0 ? `${t.subRuns}× · ${tokens(total(t.sub) + t.sub.output)}` : '—'
    const row = isWide
      ? [
          `${t.n}${flag}`,
          cell(prompt || '—'),
          t.model ? modelName(t.model) : '—',
          tokens(total(t.main)),
          pct(hitRate(t.main) * 100),
          tokens(t.main.output),
          sub,
          seconds(t.ms),
          cost,
        ]
      : [
          `${t.n}${flag}`,
          t.model ? modelName(t.model) : '—',
          tokens(total(t.main)),
          pct(hitRate(t.main) * 100),
          tokens(t.main.output),
          seconds(t.ms),
          cost,
        ]
    md.push(`| ${row.join(' | ')} |`)
  }
  if (turns.length > rows) md.push('', `_mostrando ${rows} de ${turns.length} turnos_`)
  return md.join('\n')
}

/** Tokens and cost per model, main loop and subagents together. */
export function byModelMd(turns: HudTurn[]): string {
  const sums = new Map<string, { tok: HudTokens; turns: number }>()
  for (const t of turns) {
    const key = t.model ? modelName(t.model) : '—'
    const cur = sums.get(key) ?? { tok: ZERO, turns: 0 }
    sums.set(key, { tok: add(cur.tok, t.main), turns: cur.turns + 1 })
  }
  if (sums.size === 0) return ''
  const md = ['| modelo | turnos | entrada | cache | saída |', '|:--|--:|--:|--:|--:|']
  for (const [name, s] of [...sums].sort((a, b) => total(b[1].tok) - total(a[1].tok))) {
    md.push(`| ${name} | ${s.turns} | ${tokens(total(s.tok))} | ${pct(hitRate(s.tok) * 100)} | ${tokens(s.tok.output)} |`)
  }
  return md.join('\n')
}

export const usedCats = (cats: HudCat[]): HudCat[] => cats.filter(c => c.kind === 'used')
