"use client"

import { useMemo } from "react"
import { useQueries, type RequestForQueries } from "convex/react"
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server"

/**
 * `useQuery` that returns a failure instead of throwing into the error
 * boundary: `{ data }` (undefined while loading or skipped) and `{ error }`.
 * For secondary data a page must survive without — a sidebar badge, the sun
 * state on rows — and for functions a deployment may not have yet.
 */
export function useOptionalQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): { data: FunctionReturnType<Query> | undefined; error: Error | null } {
  // `api.x.y` is a fresh proxy on every access: key the request by name + args.
  const name = getFunctionName(query)
  const argsKey = args === "skip" ? null : JSON.stringify(args)
  const queries = useMemo(
    (): RequestForQueries =>
      argsKey === null ? {} : { value: { query: makeFunctionReference<"query">(name), args: JSON.parse(argsKey) as FunctionArgs<Query> } },
    [argsKey, name],
  )
  const raw = useQueries(queries).value as FunctionReturnType<Query> | Error | undefined
  if (raw instanceof Error) return { data: undefined, error: raw }
  return { data: raw, error: null }
}
