import * as React from "react"
import { cn } from "cn"

const control =
  "w-full min-w-0 rounded-[var(--radius-control)] border border-input bg-surface px-3.5 text-sm text-foreground shadow-xs transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/75 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted-foreground disabled:opacity-80 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/15"

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(control, "h-10", className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(control, "min-h-24 resize-y py-3 leading-6", className)}
      {...props}
    />
  )
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(control, "h-10 cursor-pointer pr-9", className)}
      {...props}
    />
  )
}

export { Input, Textarea, Select }
