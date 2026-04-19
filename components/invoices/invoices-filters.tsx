"use client"

import { useMemo, useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { SearchIcon } from "lucide-react"

type StatusTab = "all" | "draft" | "invoiced" | "paid"

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
]

const ALL_VALUE = "__all__"

export function InvoicesFilters() {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeStatus = (searchParams.get("status") as StatusTab | null) ?? "all"
  const activeClient = searchParams.get("clientId") ?? ""
  const activeProject = searchParams.get("projectId") ?? ""

  // Search stays URL-synced via a shared hook. Dropdowns use `router.push`
  // so each filter selection creates a history entry users can back out of;
  // the search hook uses `replace` internally so every keystroke doesn't.
  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

  const clients = useQuery(api.clients.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")

  const setParams = useCallback(
    (updates: Array<[string, string | undefined]>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of updates) {
        if (!value || value === ALL_VALUE) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname)
    },
    [searchParams, router, pathname],
  )

  const setParam = useCallback(
    (key: string, value: string | undefined) => setParams([[key, value]]),
    [setParams],
  )

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    if (!activeClient) return projects
    return projects.filter((p) => p.clientId === activeClient)
  }, [projects, activeClient])

  return (
    <div className="flex flex-col gap-3">
      {/* Status tabs — URL-synced via setParam */}
      <Tabs
        value={activeStatus}
        onValueChange={(v) => setParam("status", v === "all" ? undefined : v)}
      >
        <TabsList variant="line">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={activeClient || ALL_VALUE}
          onValueChange={(v) => {
            // Atomically update both params so the second push can't clobber the first.
            const updates: Array<[string, string | undefined]> = [["clientId", v]]
            if (activeProject && projects) {
              const proj = projects.find((p) => p._id === activeProject)
              if (proj && v !== ALL_VALUE && proj.clientId !== v) {
                updates.push(["projectId", undefined])
              }
            }
            setParams(updates)
          }}
        >
          <SelectTrigger size="sm" className="w-[180px]">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_VALUE}>All clients</SelectItem>
              {clients?.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={activeProject || ALL_VALUE}
          onValueChange={(v) => setParam("projectId", v)}
        >
          <SelectTrigger size="sm" className="w-[180px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_VALUE}>All projects</SelectItem>
              {filteredProjects.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="relative ml-auto w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoice number or subject"
            aria-label="Search invoices"
            className="h-9 pl-8"
          />
        </div>
      </div>
    </div>
  )
}
