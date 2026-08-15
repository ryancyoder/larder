import { type ReactNode } from 'react'

/**
 * Hand-rolled SVG charts. Categorical hues come from the validated two-slot
 * palette (--viz-1 / --viz-2) in fixed order; magnitude comparisons use a single
 * sequential hue. One axis per chart, legends whenever there are two series,
 * and every chart ships a table view underneath.
 */

const W = 360

function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.max(0, Math.min(r, h, w / 2))
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ')
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / mag) * mag
}

export function TableView({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-mute)', fontWeight: 600 }}>
        Show the numbers
      </summary>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '5px 8px', color: 'var(--text-mute)', fontWeight: 700, borderBottom: '1px solid var(--line)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="tabular" style={{ textAlign: ci === 0 ? 'left' : 'right', padding: '5px 8px', borderBottom: '1px solid var(--line)', color: ci === 0 ? 'var(--text-dim)' : 'var(--text)' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
      {items.map((i) => (
        <span key={i.label} className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: i.color, display: 'inline-block' }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export interface GroupedPoint {
  label: string
  a: number
  b: number
}

/** Two series, side by side, one axis. A 2px surface gap separates the pair. */
export function GroupedBars({
  data, seriesA, seriesB, format,
}: {
  data: GroupedPoint[]
  seriesA: string
  seriesB: string
  format: (n: number) => string
}) {
  const H = 176
  const padL = 40, padR = 10, padT = 16, padB = 24
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.a, d.b])))
  const band = plotW / Math.max(1, data.length)
  const barW = Math.min(18, (band * 0.62 - 2) / 2)
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const last = data.length - 1

  return (
    <div>
      <Legend items={[{ label: seriesA, color: 'var(--viz-1)' }, { label: seriesB, color: 'var(--viz-2)' }]} />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`${seriesA} and ${seriesB} by month`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={padT + plotH * t} y2={padT + plotH * t} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={padL - 7} y={padT + plotH * t + 3.5} textAnchor="end" fontSize="9.5" fill="var(--text-mute)">
              {format(max * (1 - t))}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = padL + band * i + band / 2
          const xa = cx - barW - 1
          const xb = cx + 1
          return (
            <g key={d.label}>
              <path d={barPath(xa, y(d.a), barW, padT + plotH - y(d.a))} fill="var(--viz-1)">
                <title>{`${d.label} — ${seriesA}: ${format(d.a)}`}</title>
              </path>
              <path d={barPath(xb, y(d.b), barW, padT + plotH - y(d.b))} fill="var(--viz-2)">
                <title>{`${d.label} — ${seriesB}: ${format(d.b)}`}</title>
              </path>
              {i === last && (
                <>
                  <text x={xa + barW / 2} y={y(d.a) - 5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--text-dim)">{format(d.a)}</text>
                  <text x={xb + barW / 2} y={y(d.b) - 5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--text-dim)">{format(d.b)}</text>
                </>
              )}
              <text x={cx} y={H - 7} textAnchor="middle" fontSize="10" fill="var(--text-mute)">{d.label}</text>
            </g>
          )
        })}
      </svg>
      <TableView
        headers={['Month', seriesA, seriesB]}
        rows={data.map((d) => [d.label, format(d.a), format(d.b)])}
      />
    </div>
  )
}

export interface RankedRow {
  label: string
  value: number
  /** Optional swatch shown beside the label — identity, not the bar's encoding. */
  swatch?: string
  note?: string
}

/** Magnitude comparison: horizontal bars, one sequential hue, darker = more. */
export function RankedBars({
  rows, format, emptyLabel,
}: {
  rows: RankedRow[]
  format: (n: number) => string
  emptyLabel: string
}) {
  if (!rows.length) return <p style={{ fontSize: 13, color: 'var(--text-mute)' }}>{emptyLabel}</p>
  const max = Math.max(...rows.map((r) => r.value)) || 1

  return (
    <div>
      <div className="stack" style={{ gap: 9 }}>
        {rows.map((r) => {
          const share = r.value / max
          // One hue, light→dark with magnitude — never a rainbow.
          const fill = `color-mix(in srgb, var(--viz-seq-400) ${Math.round(30 + share * 70)}%, var(--viz-seq-100))`
          return (
            <div key={r.label} title={`${r.label}: ${format(r.value)}`}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                <span className="row" style={{ gap: 6, color: 'var(--text-dim)', fontWeight: 600 }}>
                  {r.swatch && <span className="cat-dot" style={{ background: r.swatch }} />}
                  {r.label}
                  {r.note && <span style={{ color: 'var(--text-mute)', fontWeight: 500 }}>{r.note}</span>}
                </span>
                <span className="tabular" style={{ fontWeight: 700 }}>{format(r.value)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-3)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(2, share * 100)}%`, height: '100%', borderRadius: 99, background: fill, transition: 'width 0.6s var(--ease)' }} />
              </div>
            </div>
          )
        })}
      </div>
      <TableView headers={['Item', 'Amount']} rows={rows.map((r) => [r.label, format(r.value)])} />
    </div>
  )
}

/** Single series over time — how many days you went between shops. */
export function IntervalLine({ points, average }: { points: Array<{ date: string; days: number }>; average: number | null }) {
  if (points.length < 2) {
    return <p style={{ fontSize: 13, color: 'var(--text-mute)' }}>Two or more shopping trips will draw the trend here.</p>
  }
  const H = 132
  const padL = 26, padR = 10, padT = 14, padB = 20
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const max = niceMax(Math.max(...points.map((p) => p.days)))
  const x = (i: number) => padL + (plotW * i) / (points.length - 1)
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.days)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${padT + plotH} L${padL},${padT + plotH} Z`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Days between shopping trips">
        <defs>
          <linearGradient id="intervalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--viz-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={padT + plotH * t} y2={padT + plotH * t} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={padL - 6} y={padT + plotH * t + 3.5} textAnchor="end" fontSize="9.5" fill="var(--text-mute)">{Math.round(max * (1 - t))}</text>
          </g>
        ))}

        {average != null && (
          <>
            <line x1={padL} x2={W - padR} y1={y(average)} y2={y(average)} stroke="var(--text-mute)" strokeWidth="1" strokeDasharray="3 4" />
            <text x={W - padR} y={y(average) - 5} textAnchor="end" fontSize="9.5" fill="var(--text-mute)">avg {average}d</text>
          </>
        )}

        <path d={area} fill="url(#intervalFill)" />
        <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <circle key={p.date + i} cx={x(i)} cy={y(p.days)} r="4" fill="var(--viz-1)" stroke="var(--bg-1)" strokeWidth="2">
            <title>{`${p.date} — ${p.days} days since the previous trip`}</title>
          </circle>
        ))}

        <text x={padL} y={H - 5} fontSize="9.5" fill="var(--text-mute)">{points[0].date.slice(5)}</text>
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9.5" fill="var(--text-mute)">{points[points.length - 1].date.slice(5)}</text>
      </svg>
      <TableView headers={['Trip date', 'Days since previous']} rows={points.map((p) => [p.date, p.days])} />
    </div>
  )
}

/** A single ratio against a limit — same-ramp track, not a two-slice pie. */
export function Meter({ label, pct, caption }: { label: string; pct: number; caption?: ReactNode }) {
  const clamped = Math.max(0, Math.min(1, pct))
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 600 }}>{label}</span>
        <span className="tabular" style={{ fontWeight: 700 }}>{Math.round(clamped * 100)}%</span>
      </div>
      <div className="meter"><span style={{ width: `${Math.max(1.5, clamped * 100)}%` }} /></div>
      {caption && <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 7 }}>{caption}</p>}
    </div>
  )
}
