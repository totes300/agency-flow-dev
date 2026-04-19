import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Base layout + chrome (shared across all input types)
        "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none",
        "placeholder:text-muted-foreground",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        // Number-input spinner suppression — scoped to `type=number` so text
        // inputs (search, email, etc.) keep their native chrome.
        "[&[type=number]]:[appearance:textfield]",
        "[&[type=number]::-webkit-inner-spin-button]:appearance-none",
        "[&[type=number]::-webkit-outer-spin-button]:appearance-none",
        // Neutralize Chrome's yellow autofill background without losing the
        // typed value.
        "autofill:shadow-[inset_0_0_0_1000px_transparent] [&:-webkit-autofill]:[transition:background-color_5000s_ease-in-out_0s]",
        "md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
