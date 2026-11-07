"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";

export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email");
  const password = str(fd, "password");
  const next = str(fd, "next");
  if (!email || !password) return fail("Enter your email and password");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(error.message === "Invalid login credentials" ? "Incorrect email or password" : error.message);
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  return ok("Welcome back!", safeNext);
}

export async function requestPasswordReset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, "email");
  if (!email) return fail("Enter your work email");
  const h = await headers();
  const origin = h.get("origin") ?? `http://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/reset` });
  if (error) return fail(error.message);
  return ok("If that email has an account, a reset link is on its way.");
}

export async function updatePassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const password = str(fd, "password");
  const confirm = str(fd, "confirm");
  if (!password || password.length < 8) return fail("Password must be at least 8 characters");
  if (password !== confirm) return fail("Passwords don't match");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(error.message);
  return ok("Password updated", "/home");
}
