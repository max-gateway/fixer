import * as React from "react"
import { cn } from "cn"

/**
 * Rótulo + controle + dica/erro. O erro substitui a dica e é anunciado por leitores de tela (role="alert");
 * `htmlFor` liga o rótulo ao controle, e o controle aponta para a mensagem via `aria-describedby`.
 */
function Field({
  id,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  hint?: React.ReactNode
  error?: string | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">opcional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Atributos de acessibilidade do controle de um Field. */
const describedBy = (id: string, error?: string | null, hint?: unknown) =>
  ({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? `${id}-msg` : undefined }) as const

export { Field, describedBy }
