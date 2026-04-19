"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"

type FormModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"

const sizeClasses: Record<FormModalSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
}

/**
 * Props forwarded to the underlying `DialogContent`. Everything except
 * `className` (merged via `contentClassName`), `showCloseButton` (always
 * `false` inside a form modal — use a Cancel button in the footer instead),
 * and `children` is passthrough — callers typically reach for
 * `onEscapeKeyDown` / `onInteractOutside` to guard dismissal while saving.
 */
type ForwardedContentProps = Omit<
  React.ComponentProps<typeof DialogContent>,
  "className" | "showCloseButton" | "children"
>

type FormModalProps = React.ComponentProps<typeof Dialog> & {
  size?: FormModalSize
  contentClassName?: string
  innerClassName?: string
  contentProps?: ForwardedContentProps
}

function FormModal({
  size = "xl",
  contentClassName,
  innerClassName,
  contentProps,
  children,
  ...props
}: FormModalProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        showCloseButton={false}
        // The 85vh cap lives on the outer content; the inner uses `min-h-0`
        // so `overflow-y-auto` resolves against the bounded grid cell.
        className={cn("max-h-[85vh] gap-0 p-0", sizeClasses[size], contentClassName)}
        {...contentProps}
      >
        <div
          data-slot="form-modal-inner"
          className={cn("min-h-0 overflow-y-auto p-8", innerClassName)}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type FormModalHeaderProps = React.ComponentProps<typeof DialogHeader> & {
  align?: "center" | "start"
  /**
   * Optional element rendered before the title block (e.g. a back button on
   * multi-step forms). When provided, the header switches to a row layout
   * and `align` is ignored — the title stack sits to the right of `leading`.
   */
  leading?: React.ReactNode
}

function FormModalHeader({
  align = "center",
  leading,
  className,
  children,
  ...props
}: FormModalHeaderProps) {
  if (leading) {
    return (
      <DialogHeader
        data-slot="form-modal-header"
        className={cn("mb-8 flex-row items-center gap-3", className)}
        {...props}
      >
        {leading}
        <div className="flex flex-col gap-2">{children}</div>
      </DialogHeader>
    )
  }

  return (
    <DialogHeader
      data-slot="form-modal-header"
      className={cn(
        "mb-8",
        align === "center" && "items-center text-center",
        className,
      )}
      {...props}
    >
      {children}
    </DialogHeader>
  )
}

function FormModalTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      data-slot="form-modal-title"
      className={cn("text-2xl font-semibold", className)}
      {...props}
    />
  )
}

function FormModalDescription({
  srOnly,
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription> & { srOnly?: boolean }) {
  return (
    <DialogDescription
      data-slot="form-modal-description"
      className={cn(srOnly && "sr-only", className)}
      {...props}
    />
  )
}

function FormModalBody({
  className,
  ...props
}: React.ComponentProps<typeof FieldGroup>) {
  return (
    <FieldGroup
      data-slot="form-modal-body"
      className={cn("gap-6 sm:gap-7", className)}
      {...props}
    />
  )
}

function FormModalFooter({
  align = "stack",
  className,
  ...props
}: React.ComponentProps<"div"> & { align?: "stack" | "row" }) {
  return (
    <div
      data-slot="form-modal-footer"
      className={cn(
        "mt-8",
        align === "stack" && "flex flex-col items-center gap-3",
        align === "row" && "flex items-center justify-end gap-3",
        className,
      )}
      {...props}
    />
  )
}

export {
  FormModal,
  FormModalHeader,
  FormModalTitle,
  FormModalDescription,
  FormModalBody,
  FormModalFooter,
}
