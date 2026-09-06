"use client"

import { cn } from "@/lib/utils"

interface GigHealthGaugeProps {
  score: number
  size?: number
}

export function GigHealthGauge({ score, size = 140 }: GigHealthGaugeProps) {
  const radius = (size - 20) / 2
  const circumference = radius * Math.PI
  const offset = circumference - (score / 100) * circumference

  const getColor = (s: number) => {
    if (s >= 80) return "text-emerald"
    if (s >= 50) return "text-warning"
    return "text-danger"
  }

  const getLabel = (s: number) => {
    if (s >= 80) return "Excellent"
    if (s >= 50) return "Needs Work"
    return "Poor"
  }

  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        {/* Background arc */}
        <path
          d={`M 10 ${size / 2 + 10} A ${radius} ${radius} 0 0 1 ${size - 10} ${size / 2 + 10}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          className="text-secondary"
        />
        {/* Score arc */}
        <path
          d={`M 10 ${size / 2 + 10} A ${radius} ${radius} 0 0 1 ${size - 10} ${size / 2 + 10}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("transition-all duration-1000", getColor(score))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
        <span className="text-3xl font-bold text-foreground">{score}</span>
        <span className="text-[11px] text-muted-foreground">{getLabel(score)}</span>
      </div>
    </div>
  )
}
