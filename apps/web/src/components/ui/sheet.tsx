"use client"

import * as React from "react"
import { cn } from "cn"
import { X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

/**
 * Painel lateral (gaveta). No desktop entra pela direita; no celular ocupa a tela toda por baixo, com o conteúdo rolando
 * dentro e o cabeçalho fixo. O foco fica preso nele e Esc fecha (Radix).
 */
const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close

function SheetContent({
  className,
  children,
  closeLabel = "Fechar",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-2xl border bg-background shadow-xl outline-none",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-[30rem] sm:rounded-none sm:rounded-l-2xl sm:border-r-0",
          "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom sm:data-[state=closed]:slide-out-to-right",
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:data-[state=open]:slide-in-from-right",
          "duration-200",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={closeLabel}
        >
          <X aria-hidden className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

const SheetTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("text-lg leading-tight font-semibold tracking-tight", className)} {...props} />
)
const SheetDescription = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
)

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription }
