"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Search,
  BarChart3,
  TrendingUp,
  Clock,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  LogOut,
  Loader2,
  Wand2,
  Target,
  Radar,
  GitCompare,
  Crown,
  Briefcase,
  UserRound,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { createSupabaseBrowser } from "@/lib/supabase/browser"

type View =
  | "landing"
  | "auditor"
  | "history"
  | "trends"
  | "generator"
  | "predict"
  | "proposal"
  | "profile"
  | "tracker"
  | "tracker-detail"
  | "compare"
  | "recover"
  | "help"
  | "settings"

interface AppSidebarProps {
  currentView: View
  onViewChange: (view: View) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  user: { id: string; email: string }
  isPremium?: boolean
  /** When true, show a link to /admin (env allowlist). */
  isAdmin?: boolean
  /**
   * Mobile drawer state. When provided, the sidebar also renders inside a
   * `Sheet` that the dashboard topbar can open via the hamburger button.
   */
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
}

interface NavItem {
  id: View
  label: string
  icon: typeof Search
  description: string
  /** Renders a Pro badge next to the label. */
  premiumLocked?: boolean
}

const navItems: NavItem[] = [
  { id: "landing", label: "Analyze", icon: Search, description: "Gig Analyzer" },
  { id: "predict", label: "Predict", icon: Target, description: "Conversion forecast" },
  { id: "generator", label: "Generate", icon: Wand2, description: "AI Gig Generator" },
  { id: "proposal", label: "Upwork", icon: Briefcase, description: "Proposal writer" },
  { id: "profile", label: "Profiles", icon: UserRound, description: "Fiverr & Upwork profile rewrite" },
  { id: "compare", label: "Compare", icon: GitCompare, description: "Side-by-side vs competitors", premiumLocked: true },
  { id: "tracker", label: "Tracker", icon: Radar, description: "Competitor monitoring" },
  { id: "history", label: "My Gigs", icon: Clock, description: "Analysis history" },
  { id: "trends", label: "Trends", icon: TrendingUp, description: "Trend Intel" },
  { id: "recover", label: "Recover", icon: LifeBuoy, description: "De-rank SOS + 28-day timer" },
]

const bottomItems = [
  { id: "help" as View, label: "Help", icon: HelpCircle },
  { id: "settings" as View, label: "Settings", icon: Settings },
]

export function AppSidebar({
  currentView,
  onViewChange,
  collapsed,
  onCollapsedChange,
  user,
  isPremium = false,
  isAdmin = false,
  mobileOpen = false,
  onMobileOpenChange,
}: AppSidebarProps) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut()
      router.refresh()
      router.replace("/auth")
    } finally {
      setSigningOut(false)
    }
  }

  const userInitial = user.email ? user.email[0]?.toUpperCase() : "?"

  // The mobile drawer always renders in its uncollapsed form so the labels
  // are visible (collapsed mode is a desktop-only space saver).
  const renderBody = (forceExpanded: boolean) => {
    const isCollapsed = forceExpanded ? false : collapsed
    return (
      <>
        {/* Logo */}
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
              <BarChart3 className="size-4" />
            </div>
            {!isCollapsed && (
              <span className="text-sm font-semibold tracking-tight text-sidebar-foreground whitespace-nowrap">
                JobFlow AI
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <div className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                currentView === item.id ||
                (item.id === "tracker" && currentView === "tracker-detail")
              const showLock = item.premiumLocked && !isPremium
              const handleClick = () => {
                onViewChange(item.id)
                onMobileOpenChange?.(false)
              }
              const btn = (
                <button
                  key={item.id}
                  onClick={handleClick}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-emerald"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className={cn("size-4 shrink-0", isActive && "text-emerald")} />
                  {!isCollapsed && (
                    <span className="flex flex-1 items-center gap-1.5 truncate">
                      <span className="truncate">{item.label}</span>
                      {showLock && (
                        <Crown className="size-3 shrink-0 text-amber-400" />
                      )}
                    </span>
                  )}
                </button>
              )

              if (isCollapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" className="bg-popover text-popover-foreground">
                      {item.description}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return btn
            })}
          </div>
        </nav>

        {/* Bottom items */}
        <div className="border-t border-sidebar-border px-2 py-3">
          <div className="flex flex-col gap-1">
            {bottomItems.map((item) => {
              const isActive = currentView === item.id
              const handleClick = () => {
                onViewChange(item.id)
                onMobileOpenChange?.(false)
              }
              const btn = (
                <button
                  key={item.id}
                  onClick={handleClick}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-emerald"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className={cn("size-4 shrink-0", isActive && "text-emerald")} />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              )

              if (isCollapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" className="bg-popover text-popover-foreground">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return btn
            })}
            {isAdmin && (
              isCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href="/admin"
                      className="flex w-full items-center justify-center rounded-md px-2.5 py-2 text-muted-foreground hover:bg-sidebar-accent hover:text-emerald"
                      onClick={() => onMobileOpenChange?.(false)}
                    >
                      <Shield className="size-4 shrink-0" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-popover text-popover-foreground">
                    Admin
                  </TooltipContent>
                </Tooltip>
              ) : (
                <a
                  href="/admin"
                  onClick={() => onMobileOpenChange?.(false)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-emerald"
                >
                  <Shield className="size-4 shrink-0" />
                  <span className="truncate">Admin</span>
                </a>
              )
            )}
          </div>
        </div>

        {/* User block */}
        <div className="border-t border-sidebar-border p-2">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex size-8 items-center justify-center rounded-full bg-emerald/15 text-xs font-semibold text-emerald">
                    {userInitial}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-popover text-popover-foreground">
                  {user.email}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-danger"
                    onClick={handleSignOut}
                    disabled={signingOut}
                  >
                    {signingOut ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LogOut className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-popover text-popover-foreground">
                  Sign out
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-xs font-semibold text-emerald">
                {userInitial}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium text-sidebar-foreground">
                  {user.email}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {isAdmin ? "Admin" : "Signed in"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-danger"
                onClick={handleSignOut}
                disabled={signingOut}
                title="Sign out"
              >
                {signingOut ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LogOut className="size-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Collapse toggle (desktop only) */}
        {!forceExpanded && (
          <div className="border-t border-sidebar-border p-2">
            <Button
              variant="ghost"
              size="icon"
              className="w-full text-muted-foreground hover:text-sidebar-foreground"
              onClick={() => onCollapsedChange(!collapsed)}
            >
              {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      {/* Desktop aside */}
      <aside
        className={cn(
          "hidden md:flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
          collapsed ? "w-16" : "w-56"
        )}
      >
        {renderBody(false)}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="w-64 max-w-[80vw] border-r border-sidebar-border bg-sidebar p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Main navigation menu</SheetDescription>
          </SheetHeader>
          <div className="flex h-full flex-col">{renderBody(true)}</div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
