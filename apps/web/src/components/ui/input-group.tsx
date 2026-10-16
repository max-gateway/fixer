import * as React from "react"
import { cn } from "cn"

/**
 * Campo com unidade visível ("R$" antes, "%" depois): evita confundir valor com percentual. O foco aparece no conjunto,
 * e o erro (`aria-invalid` no input) pinta a borda toda. O input continua sendo um <input> comum.
 */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] has-[:disabled]:opacity-60 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

function InputGroupAddon({ className, align = "start", ...props }: React.ComponentProps<"span"> & { align?: "start" | "end" }) {
  return (
    <span
      data-slot="input-group-addon"
      data-align={align}
      className={cn("flex h-full shrink-0 items-center bg-muted/60 px-2.5 text-sm text-muted-foreground select-none data-[align=end]:order-last data-[align=end]:border-l data-[align=start]:border-r", className)}
      {...props}
    />
  )
}

function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input-group-input" className={cn("tabular h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed", className)} {...props} />
}

export { InputGroup, InputGroupAddon, InputGroupInput }
