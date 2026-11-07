import Image from "next/image";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Label } from "@/components/ui/form";
import { updatePassword } from "@/app/login/actions";

export const metadata = { title: "Choose a new password" };

export default function ResetPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Image src="/grevya-logo.png" alt="Grevya" width={120} height={60} className="h-10 w-auto" />
        <h1 className="mt-6 text-xl font-semibold text-slate-900">Choose a new password</h1>
        <ActionForm action={updatePassword} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" minLength={8} required />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" name="confirm" type="password" minLength={8} required />
          </div>
          <SubmitButton className="w-full">Update password</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
