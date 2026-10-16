import * as React from "react"
import { cn } from "cn"

/** Tecla de atalho em linha de texto: "<Kbd>Enter</Kbd> próximo preço". */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[0.7rem] font-medium text-muted-foreground select-none", className)}
      {...props}
    />
  )
}

export { Kbd }
