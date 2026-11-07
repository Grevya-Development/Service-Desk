"use client";

import { useState } from "react";
import { Eye, EyeOff, Mail, Lock, ArrowLeft } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Label } from "@/components/ui/form";
import { signIn, requestPasswordReset } from "./actions";

const DEMO = [
  { label: "Employee", email: "priya@grevya.com" },
  { label: "Manager", email: "kavin@grevya.com" },
  { label: "IT agent", email: "manoj@grevya.com" },
  { label: "IT lead", email: "arvind@grevya.com" },
  { label: "HR lead", email: "hr@grevya.com" },
  { label: "Admin", email: "admin@grevya.com" },
];

export function LoginForm({ next, showDemo }: { next?: string; showDemo: boolean }) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (mode === "reset") {
    return (
      <div>
        <button type="button" onClick={() => setMode("signin")} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </button>
        <h2 className="text-xl font-semibold text-slate-900">Reset your password</h2>
        <p className="mt-1 text-sm text-slate-500">We&apos;ll email you a link to choose a new password.</p>
        <ActionForm action={requestPasswordReset} className="mt-6 space-y-4" resetOnSuccess={false}>
          <div>
            <Label htmlFor="reset-email">Work email</Label>
            <Input id="reset-email" name="email" type="email" required defaultValue={email} placeholder="you@grevya.com" />
          </div>
          <SubmitButton className="w-full" size="lg">
            Send reset link
          </SubmitButton>
        </ActionForm>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
      <p className="mt-1 text-sm text-slate-500">Use your Grevya work account.</p>
      <ActionForm action={signIn} className="mt-6 space-y-4" resetOnSuccess={false}>
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <Label htmlFor="email">Work email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@grevya.com" className="h-11 pl-9" />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button type="button" onClick={() => setMode("reset")} className="mb-1.5 text-xs font-medium text-primary-600 hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 pl-9 pr-10"
            />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-600" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <SubmitButton className="w-full" size="lg">
          Sign in
        </SubmitButton>
      </ActionForm>

      {showDemo && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Demo accounts · password Grevya@123</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => {
                  setEmail(d.email);
                  setPassword("Grevya@123");
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:border-primary-300 hover:text-primary-700"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
