import Image from "next/image";
import { buttonClass } from "@/components/ui/button";
import { signOut } from "@/app/(desk)/_actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "No access" };

export default async function NoAccess() {
  // Tell people who have left Grevya apart from accounts that were never linked.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const { data: emp } = userId
    ? await supabase.schema("public").from("employees").select("status").eq("user_id", userId).maybeSingle()
    : { data: null };
  const exited = emp?.status === "exited";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Image src="/grevya-mark.png" alt="" width={56} height={56} className="mx-auto h-14 w-14" />
        <h1 className="mt-5 text-xl font-semibold text-slate-900">
          {exited ? "Your Grevya account is no longer active" : "Your account isn\u2019t linked to an employee profile yet"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {exited
            ? "The Service Desk is for current Grevya employees. If you think this is a mistake, contact your HR team."
            : "The Service Desk uses your People Success account. Ask your HR team to add you in People Success with the same email address you signed in with."}
        </p>
        <form action={signOut} className="mt-6">
          <button className={buttonClass("outline")}>Sign out</button>
        </form>
      </div>
    </div>
  );
}
