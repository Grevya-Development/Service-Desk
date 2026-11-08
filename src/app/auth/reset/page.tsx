import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Label } from "@/components/ui/form";
import { updatePassword } from "@/app/login/actions";
import { signOut } from "@/app/(desk)/_actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const first = (await searchParams).first === "1";
  // Only reachable with a session: a reset link signs you in first, or HR's temporary password.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Image src="/grevya-logo.png" alt="Grevya" width={120} height={60} className="h-10 w-auto" />
        <h1 className="mt-6 text-xl font-semibold text-slate-900">{first ? "Choose your own password" : "Choose a new password"}</h1>
        {first && (
          <p className="mt-1 text-sm text-slate-500">
            You signed in with a temporary password from HR. Pick a new one to continue. It works for People Success too.
          </p>
        )}
        <ActionForm action={updatePassword} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" required />
            <p className="mt-1 text-xs text-slate-500">At least 8 characters, with letters and numbers.</p>
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" name="confirm" type="password" minLength={8} maxLength={72} autoComplete="new-password" required />
          </div>
          <SubmitButton className="w-full">{first ? "Save and continue" : "Update password"}</SubmitButton>
        </ActionForm>
        <form action={signOut} className="mt-4 text-center">
          <button type="submit" className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
