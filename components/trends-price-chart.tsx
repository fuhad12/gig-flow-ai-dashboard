"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Coins } from "lucide-react"

import type { NicheGig } from "@/lib/trends"

interface TrendsPriceChartProps {
  gigs: NicheGig[]
  median: number | null
}

interface Bucket {
  label: string
  min: number
  max: number
  count: number
  midPoint: number
}

const BUCKETS: Omit<Bucket, "count">[] = [
  { label: "$5–25", min: 5, max: 25, midPoint: 15 },
  { label: "$25–50", min: 25, max: 50, midPoint: 37.5 },
  { label: "$50–100", min: 50, max: 100, midPoint: 75 },
  { label: "$100–250", min: 100, max: 250, midPoint: 175 },
  { label: "$250–500", min: 250, max: 500, midPoint: 375 },
  { label: "$500+", min: 500, max: Infinity, midPoint: 750 },
]

export function TrendsPriceChart({ gigs, median }: TrendsPriceChartProps) {
  const data = useMemo<Bucket[]>(() => {
    return BUCKETS.map((b) => {
      const count = gigs.filter(
        (g) => g.price != null && g.price >= b.min && g.price < b.max,
      ).length
      return { ...b, count }
    })
  }, [gigs])

  const hasData = data.some((b) => b.count > 0)
  if (!hasData) return null

  const peakIdx = data.reduce(
    (best, b, i) => (b.count > data[best].count ? i : best),
    0,
  )

  return (
    <Card className="mb-6 border-border bg-card py-0">
      <CardHeader className="px-4 pb-3 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Coins className="size-4 text-violet-400" />
          Price Distribution
          {median != null && (
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              Median ${median}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--accent)", opacity: 0.3 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const b = payload[0].payload as Bucket
                  return (
                    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                      <div className="font-semibold text-foreground">
                        {b.label}
                      </div>
                      <div className="text-muted-foreground">
                        {b.count} gig{b.count === 1 ? "" : "s"}
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} barSize={28}>
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      i === peakIdx ? "var(--emerald)" : "var(--muted-foreground)"
                    }
                    fillOpacity={i === peakIdx ? 1 : 0.3}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The emerald bar shows where most competitors price. Premium gigs
          sitting in the long tail above the peak typically signal under-served
          buyer demand.
        </p>
      </CardContent>
    </Card>
  )
}
