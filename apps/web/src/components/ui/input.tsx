import * as React from "react"
import { cn } from "cn"

const control =
  "w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(control, "h-9", className)} {...props} />
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(control, "min-h-20 py-2", className)} {...props} />
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(control, "h-9 pr-8", className)} {...props} />
}

export { Input, Textarea, Select }
