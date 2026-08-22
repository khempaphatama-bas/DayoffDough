export default function AuthenticatedLoading() {
  return (
    <main className="mx-auto grid max-w-6xl gap-4 px-5 py-10">
      <div
        aria-live="polite"
        className="rounded-3xl border border-stone-200 bg-white p-6 text-stone-600 shadow-sm"
        role="status"
      >
        <span
          aria-hidden="true"
          className="mr-3 inline-block h-3 w-3 animate-pulse rounded-full bg-amber-700"
        />
        กำลังโหลดข้อมูล
      </div>
    </main>
  );
}
