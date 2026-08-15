import { useMemo } from 'react'
import { useEvents, useTrips } from '../app/data'
import {
  categoryTotals, headline, money, monthlySeries, tripStats, wasteLeaders,
} from '../lib/insights'
import { categoryMeta } from '../lib/categories'
import { formatMonth } from '../lib/dates'
import { GroupedBars, IntervalLine, Meter, RankedBars } from '../components/charts'
import { Empty, Section, Stat } from '../components/ui'

export default function Insights({ onOpenSettings }: { onOpenSettings: () => void }) {
  const events = useEvents()
  const trips = useTrips()

  const series = useMemo(() => monthlySeries(events ?? [], 6), [events])
  const head = useMemo(() => headline(series), [series])
  const cats = useMemo(() => categoryTotals(events ?? [], 3), [events])
  const leaders = useMemo(() => wasteLeaders(events ?? [], 6), [events])
  const shopping = useMemo(() => tripStats(trips ?? []), [trips])

  if (!events || !trips) return null

  if (events.length === 0) {
    return (
      <>
        <div className="topbar"><h1>Insights</h1></div>
        <div className="section">
          <Empty emoji="📈" title="No history yet">
            Log prices when you check out a shopping list, and record what gets used or thrown away.
            A few weeks of that turns into real numbers here.
          </Empty>
        </div>
      </>
    )
  }

  const spendDelta = head.spendThisMonth - head.spendLastMonth
  const wasteDelta = head.wasteThisMonth - head.wasteLastMonth

  // The headline framing: what a month of your current waste rate costs per year.
  const annualisedWaste = head.wasteThisMonth * 12
  const worstCategory = [...cats].sort((a, b) => b.waste - a.waste)[0]

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Insights</h1>
          <div className="sub">Everything below comes from what you've logged</div>
        </div>
        <button className="btn ghost sm" onClick={onOpenSettings}>Settings</button>
      </div>

      <section className="section">
        <div className="card card-pad">
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
            Groceries this month
          </div>
          <div className="hero-figure" style={{ marginTop: 8 }}>{money(head.spendThisMonth)}</div>
          <div style={{ fontSize: 13, color: spendDelta > 0 ? 'var(--fresh-expired)' : 'var(--fresh-fresh)', fontWeight: 600, marginTop: 6 }}>
            {spendDelta === 0
              ? 'Level with last month'
              : `${spendDelta > 0 ? '▲' : '▼'} ${money(Math.abs(spendDelta))} vs last month`}
          </div>

          <div style={{ marginTop: 18 }}>
            <Meter
              label="Of that, thrown away"
              pct={head.wasteRate}
              caption={
                <>
                  {money(head.wasteThisMonth)} in the bin this month.
                  {annualisedWaste > 0 && ` At this rate that's ${money(annualisedWaste)} a year.`}
                </>
              }
            />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="grid-2">
          <Stat
            label="Wasted"
            value={money(head.wasteThisMonth)}
            delta={wasteDelta === 0 ? 'same as last month' : `${money(Math.abs(wasteDelta))} ${wasteDelta > 0 ? 'more' : 'less'} than last month`}
            tone={wasteDelta > 0 ? 'up' : 'down'}
          />
          <Stat
            label="Days between shops"
            value={shopping.avgIntervalDays != null ? `${shopping.avgIntervalDays}` : '—'}
            delta={shopping.daysSinceLast != null ? `${shopping.daysSinceLast} since the last one` : undefined}
          />
          <Stat label="Average basket" value={money(shopping.avgBasket)} delta={`${shopping.count} trips logged`} />
          <Stat
            label="Eaten, not binned"
            value={head.spendThisMonth > 0 ? `${Math.round((1 - head.wasteRate) * 100)}%` : '—'}
            delta="of what you bought"
          />
        </div>
      </section>

      <Section title="Spending vs waste" hint="last 6 months">
        <div className="card card-pad">
          <GroupedBars
            data={series.map((s) => ({ label: formatMonth(s.key), a: s.spend, b: s.waste }))}
            seriesA="Spent"
            seriesB="Wasted"
            format={(n) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`)}
          />
        </div>
      </Section>

      <Section title="Where the money goes" hint="last 3 months">
        <div className="card card-pad">
          <RankedBars
            rows={cats.map((c) => ({
              label: categoryMeta(c.category).label,
              value: c.spend,
              swatch: `var(--cat-${categoryMeta(c.category).hue})`,
              note: c.waste > 0 ? `· ${money(c.waste)} wasted` : undefined,
            }))}
            format={money}
            emptyLabel="Log some prices at checkout and this fills in."
          />
        </div>
      </Section>

      <Section title="How often you shop" hint="days between trips">
        <div className="card card-pad">
          <IntervalLine points={shopping.intervals.slice(-14)} average={shopping.avgIntervalDays} />
          {shopping.avgIntervalDays != null && (
            <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 10 }}>
              You shop every <strong style={{ color: 'var(--text-dim)' }}>{shopping.avgIntervalDays} days</strong> —
              about {(30 / Math.max(1, shopping.avgIntervalDays)).toFixed(1)} trips a month at {money(shopping.avgBasket)} each,
              or roughly {money((30 / Math.max(1, shopping.avgIntervalDays)) * shopping.avgBasket)} a month.
              Fewer trips only costs less if the bigger baskets get eaten — stretch the gap and watch the waste
              figure above to see whether it actually worked.
            </p>
          )}
        </div>
      </Section>

      <Section title="What you throw away most" hint="all time">
        <div className="card card-pad">
          <RankedBars
            rows={leaders.map((l) => ({
              label: l.name,
              value: l.value,
              swatch: `var(--cat-${categoryMeta(l.category).hue})`,
              note: `· ${l.times}×`,
            }))}
            format={money}
            emptyLabel="Nothing logged as waste yet. Keep it that way."
          />
          {worstCategory && worstCategory.waste > 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 12 }}>
              <strong style={{ color: 'var(--text-dim)' }}>{categoryMeta(worstCategory.category).label}</strong> is your
              biggest source of waste at {money(worstCategory.waste)}. Buying it in smaller amounts more often
              usually beats buying it in bulk.
            </p>
          )}
        </div>
      </Section>

      {shopping.recent.length > 0 && (
        <Section title="Recent trips">
          <div className="stack" style={{ gap: 6 }}>
            {shopping.recent.map((t) => (
              <div className="item" key={t.id} style={{ padding: '9px 12px' }}>
                <span style={{ fontSize: 17, flex: 'none' }}>🧾</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name" style={{ fontSize: 14 }}>{t.store}</div>
                  <div className="meta"><span>{t.date}</span><span>·</span><span>{t.itemCount} items</span></div>
                </div>
                <div className="qty">{money(t.total)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}
