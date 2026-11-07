import Image from "next/image";
import type { Metadata } from "next";
import { BookOpen, LifeBuoy, Laptop, Timer } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const SHARDS = [
  { c: "#f15a24", x: "8%", y: "14%", w: 120, h: 34, r: -42 },
  { c: "#ffb800", x: "38%", y: "8%", w: 150, h: 40, r: 28 },
  { c: "#00a4ef", x: "70%", y: "22%", w: 110, h: 30, r: -48 },
  { c: "#7fba00", x: "14%", y: "78%", w: 140, h: 36, r: 34 },
  { c: "#00a4ef", x: "62%", y: "84%", w: 160, h: 38, r: -36 },
  { c: "#ffb800", x: "84%", y: "60%", w: 90, h: 26, r: 50 },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const linkError = sp.error === "link";
  return (
    <div className="flex min-h-screen bg-white">
      <section className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-navy-800 via-navy-900 to-navy-950 lg:flex">
        {SHARDS.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-xl opacity-25"
            style={{ left: s.x, top: s.y, width: s.w, height: s.h, background: s.c, transform: `rotate(${s.r}deg)` }}
          />
        ))}
        <div className="relative z-10 m-auto max-w-lg px-12 text-white">
          <div className="inline-flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-2.5">
            <Image src="/grevya-logo.png" alt="Grevya" width={140} height={70} className="h-10 w-auto" priority />
          </div>
          <h1 className="mt-10 text-5xl font-bold leading-tight tracking-tight">Service Desk</h1>
          <p className="mt-4 text-lg text-white/75">Get help from IT and HR — fast. Sign in with your Grevya account.</p>
          <ul className="mt-10 space-y-4 text-white/85">
            {[
              { i: LifeBuoy, t: "Report an issue or request a service in a minute" },
              { i: Timer, t: "Clear response times, tracked for every ticket" },
              { i: BookOpen, t: "Answers to common questions, any time" },
              { i: Laptop, t: "See the laptops and devices assigned to you" },
            ].map(({ i: Icon, t }) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[520px] lg:flex-none">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Image src="/grevya-logo.png" alt="Grevya" width={120} height={60} className="h-10 w-auto" priority />
            <span className="border-l border-slate-200 pl-3 text-sm font-semibold text-slate-600">Service Desk</span>
          </div>
          {linkError && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              That link has expired or was already used. Use <strong>Forgot password?</strong> below to get a new one.
            </div>
          )}
          <LoginForm next={next} showDemo={process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_LOGINS === "true"} />
          <p className="mt-10 text-center text-xs text-slate-400">© {new Date().getFullYear()} Grevya · Service Desk · Same login as People Success</p>
        </div>
      </section>
    </div>
  );
}
