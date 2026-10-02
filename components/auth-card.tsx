import type { ReactNode } from "react";

/** The centered card shared by setup, sign-in and invitation pages. */
export default function AuthCard({
  brand,
  title,
  subtitle,
  children,
}: {
  brand: string;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold text-foreground">{brand}</p>
          {title && <h1 className="mt-3 text-lg font-semibold text-foreground">{title}</h1>}
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}
        </div>
        <div className="panel rounded p-8">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        className="w-full rounded border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none"
        {...input}
      />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="submit"
      className="inline-flex w-full items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
      {message}
    </p>
  );
}
