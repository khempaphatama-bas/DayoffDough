import { APP_NAME } from "@/lib/app-meta";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f3ec] px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9">
        <p className="mb-3 text-sm font-semibold tracking-wide text-amber-800">
          {APP_NAME}
        </p>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-stone-900">
          เข้าสู่ระบบ
        </h1>
        <p className="mb-8 text-sm leading-6 text-stone-600">
          พื้นที่จัดการหลังร้านสำหรับเจ้าของร้าน
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
