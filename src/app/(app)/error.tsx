"use client";

export default function AuthenticatedError({
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-5 py-12">
      <h1 className="text-2xl font-bold text-stone-900">
        เปิดข้อมูลไม่สำเร็จ
      </h1>
      <p className="text-stone-600">
        กรุณาลองอีกครั้ง หากยังไม่สำเร็จให้ตรวจการเชื่อมต่อแล้วรีเฟรชหน้า
      </p>
      <button
        className="min-h-11 rounded-xl bg-stone-900 px-5 font-semibold text-white"
        onClick={retry}
        type="button"
      >
        ลองอีกครั้ง
      </button>
    </main>
  );
}
