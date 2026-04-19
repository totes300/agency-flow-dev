"use client"

import { useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { UserAvatar } from "@/components/user-avatar"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { SearchIcon } from "lucide-react"

const ALL_VALUE = "__all__"

type Member = {
  id: string
  name: string
  imageUrl: string | undefined
}

const BILLING_STATUS_OPTIONS = [
  { value: ALL_VALUE, label: "All" },
  { value: "billable_uninvoiced", label: "Billable · Uninvoiced" },
  { value: "invoiced", label: "Invoiced" },
  { value: "non_billable", label: "Non-billable" },
] as const

export function ProjectTimeFilters({
  availableMembers,
  billingType,
}: {
  availableMembers: Member[]
  billingType: string
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeMember = searchParams.get("member") ?? ""
  const activeBillingStatus = searchParams.get("billingStatus") ?? ""

  // Search stays URL-synced via a shared hook (see invoices-filters).
  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={activeMember || ALL_VALUE}
        onValueChange={(v) => setParam("member", v)}
      >
        <SelectTrigger size="sm" className="w-[200px]">
          <SelectValue placeholder="All members" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_VALUE}>All members</SelectItem>
            {availableMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2">
                  <UserAvatar name={m.name} imageUrl={m.imageUrl} size="sm" />
                  {m.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {billingType === "t_and_m" && (
        <Select
          value={activeBillingStatus || ALL_VALUE}
          onValueChange={(v) => setParam("billingStatus", v)}
        >
          <SelectTrigger size="sm" className="w-[220px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {BILLING_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      <div className="relative ml-auto w-full max-w-xs">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search task or note"
          aria-label="Search time entries"
          className="h-9 pl-8"
        />
      </div>
    </div>
  )
}
