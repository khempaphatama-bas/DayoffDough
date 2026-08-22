"use client";

import { useActionState } from "react";
import { loginOwner, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginOwner, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-5">
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        อีเมล
        <input
          autoComplete="email"
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        รหัสผ่าน
        <input
          autoComplete="current-password"
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-200"
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white transition hover:bg-stone-700 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
