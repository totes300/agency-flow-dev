"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useConvexAuth, useMutation, useQueries, type RequestForQueries } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskViewSpec, TaskViewSurface } from "@/convex/tasks/model"
import { toastError } from "@/lib/toast-helpers"
import {
  SEARCH_PARAM,
  buildViewOptions,
  draftFromSearchParams,
  draftSpec,
  displayOf,
  baseChipsOf,
  isDraftModified,
  listViewQueryFor,
  paramsForView,
  resolveView,
  toSearchString,
  writeViewParams,
  viewParamFor,
  type DisplaySpec,
  type ListFilter,
  type ViewDraft,
  type ViewOption,
} from "@/components/task-view/view-state"

type SavedViews = (typeof api.tasks.views.list)["_returnType"]

/**
 * The view state of a task surface, bound to the URL and the saved views
 * (§4.4, §6.1): `view` from `?view=` (My Tasks: `?tab=`), `draft` = that view + the URL
 * overrides, `modified` when they differ. Switching views pushes a history
 * entry and drops the previous view's overrides and search; display and
 * filter changes replace the entry.
 *
 * Saved views come from `api.tasks.views.list`. A failure there (e.g. a
 * deployment without the views module) degrades to the system views instead
 * of breaking the list.
 */
export function useViewState(surface: TaskViewSurface) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated } = useConvexAuth()

  const queries = useMemo(
    (): RequestForQueries => (isAuthenticated ? { saved: { query: api.tasks.views.list, args: { surface } } } : {}),
    [isAuthenticated, surface],
  )
  const raw = useQueries(queries).saved as SavedViews | Error | undefined
  const saved = raw instanceof Error ? null : raw
  /** Saved views are known (or failed) — `?view=<id>` can be resolved. */
  const ready = raw !== undefined

  const options = useMemo(
    () => buildViewOptions(surface, saved?.views, saved?.defaults),
    [saved, surface],
  )
  const paramsKey = searchParams.toString()
  const view = resolveView(options, surface, searchParams.get(viewParamFor(surface)))
  const draft = useMemo(() => draftFromSearchParams(new URLSearchParams(paramsKey), view), [paramsKey, view])
  const spec = useMemo(() => draftSpec(view, draft), [view, draft])
  const modified = isDraftModified(draft, view)
  const search = searchParams.get(SEARCH_PARAM) ?? ""
  const listQuery = useMemo(() => listViewQueryFor(view, draft), [view, draft])

  const navigate = useCallback(
    (next: URLSearchParams, mode: "push" | "replace") => {
      const href = `${pathname}${toSearchString(next)}`
      if (mode === "push") router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router],
  )

  const writeDraft = useCallback(
    (next: ViewDraft) => navigate(writeViewParams(new URLSearchParams(paramsKey), surface, view, next), "replace"),
    [navigate, paramsKey, surface, view],
  )

  /** Opens a view untouched (also one that is about to appear, e.g. right after creating it). */
  const setView = useCallback(
    (key: string) => {
      if (key === view.key && !modified && !search) return
      navigate(paramsForView(new URLSearchParams(paramsKey), surface, key), "push")
    },
    [modified, navigate, paramsKey, search, surface, view.key],
  )

  const updateDisplay = useCallback(
    (patch: Partial<DisplaySpec>) => writeDraft({ ...draft, display: { ...draft.display, ...patch } }),
    [draft, writeDraft],
  )

  const setChips = useCallback((chips: ListFilter[]) => writeDraft({ ...draft, chips }), [draft, writeDraft])

  const reset = useCallback(
    () => writeDraft({ display: displayOf(view.spec), chips: baseChipsOf(view) }),
    [view, writeDraft],
  )

  const setSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(paramsKey)
      if (value) params.set(SEARCH_PARAM, value)
      else params.delete(SEARCH_PARAM)
      navigate(params, "replace")
    },
    [navigate, paramsKey],
  )

  return {
    surface,
    ready,
    /** Saved views could not be loaded; only system views are offered. */
    savedViewsUnavailable: raw instanceof Error,
    canManageWorkspace: saved?.canManageWorkspace ?? false,
    customizedDefaults: saved?.customizedDefaults ?? [],
    options,
    view,
    draft,
    spec,
    modified,
    search,
    listQuery,
    setView,
    updateDisplay,
    setChips,
    reset,
    setSearch,
  }
}

export type ViewState = ReturnType<typeof useViewState>

/**
 * Saved-view writes (`api.tasks.views.*`). The server enforces who may
 * change what (personal = owner, workspace = admin); refusals toast.
 */
export function useViewActions(state: ViewState) {
  const createView = useMutation(api.tasks.views.create)
  const updateView = useMutation(api.tasks.views.update)
  const removeView = useMutation(api.tasks.views.remove)
  const reorderView = useMutation(api.tasks.views.reorder)
  const setDefault = useMutation(api.tasks.views.setDefault)
  const resetDefault = useMutation(api.tasks.views.resetDefault)
  const { surface, view, spec, setView, reset } = state

  /** Saves the current state into the selected saved view. */
  const save = useCallback(async () => {
    try {
      await updateView({ viewId: view.key as Id<"taskViews">, spec })
      reset()
      toast.success(`Saved “${view.name}”`)
    } catch (err) {
      toastError(err, "Failed to save the view")
    }
  }, [reset, spec, updateView, view])

  /** Creates a view from the current state and switches to it. */
  const saveAsNew = useCallback(
    async (name: string, scope: "personal" | "workspace", fromSpec: TaskViewSpec = spec) => {
      try {
        const id = await createView({ surface, name, scope, spec: fromSpec })
        setView(id)
        toast.success(`View “${name.trim()}” created`)
        return id
      } catch (err) {
        toastError(err, "Failed to create the view")
        return null
      }
    },
    [createView, setView, spec, surface],
  )

  const rename = useCallback(
    async (target: ViewOption, name: string) => {
      try {
        await updateView({ viewId: target.key as Id<"taskViews">, name })
      } catch (err) {
        toastError(err, "Failed to rename the view")
      }
    },
    [updateView],
  )

  const remove = useCallback(
    async (target: ViewOption) => {
      try {
        if (target.key === view.key) setView(state.options[0].key)
        await removeView({ viewId: target.key as Id<"taskViews"> })
        toast.success(`Deleted “${target.name}”`)
      } catch (err) {
        toastError(err, "Failed to delete the view")
      }
    },
    [removeView, setView, state.options, view.key],
  )

  /** Moves `target` right after `afterKey` inside its group (null = first). */
  const move = useCallback(
    async (target: ViewOption, afterKey: string | null) => {
      try {
        await reorderView({ viewId: target.key as Id<"taskViews">, afterId: afterKey as Id<"taskViews"> | null })
      } catch (err) {
        toastError(err, "Failed to reorder the view")
      }
    },
    [reorderView],
  )

  /**
   * "Set default for everyone" (admin, U6): a system view stores its display
   * settings in `viewDefaults`; a workspace view is saved in place.
   */
  const setDefaultForEveryone = useCallback(async () => {
    try {
      if (view.scope === "system") await setDefault({ surface, systemViewKey: view.key, spec })
      else await updateView({ viewId: view.key as Id<"taskViews">, spec })
      reset()
      toast.success(`Default for everyone updated · ${view.name}`)
    } catch (err) {
      toastError(err, "Failed to set the default")
    }
  }, [reset, setDefault, spec, surface, updateView, view])

  const resetDefaultForEveryone = useCallback(
    async (target: ViewOption) => {
      try {
        await resetDefault({ surface, systemViewKey: target.key })
        toast.success(`${target.name} restored to its original default`)
      } catch (err) {
        toastError(err, "Failed to reset the default")
      }
    },
    [resetDefault, surface],
  )

  return useMemo(
    () => ({ save, saveAsNew, rename, remove, move, setDefaultForEveryone, resetDefaultForEveryone }),
    [move, remove, rename, resetDefaultForEveryone, save, saveAsNew, setDefaultForEveryone],
  )
}

export type ViewActions = ReturnType<typeof useViewActions>
