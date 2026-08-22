import Link from "next/link";

const MORE_DESTINATIONS = [
  {
    href: "/customers",
    label: "ลูกค้า",
    description: "ข้อมูลติดต่อและค่าเริ่มต้นการจัดส่ง",
  },
  {
    href: "/products",
    label: "สินค้าและสูตร",
    description: "ราคาขาย สูตร และบรรจุภัณฑ์",
  },
  {
    href: "/delivery",
    label: "การจัดส่ง",
    description: "วิธีส่ง ค่าบริการ และต้นทุน",
  },
  {
    href: "/settings",
    label: "ตั้งค่าร้าน",
    description: "ข้อมูลพื้นฐานของ Day Off Dough",
  },
] as const;

export default function MorePage() {
  return (
    <main className="mx-auto grid max-w-4xl gap-7 px-5 py-8">
      <header>
        <p className="mb-2 text-sm font-semibold text-amber-800">
          จัดการข้อมูลร้าน
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">
          เพิ่มเติม
        </h1>
        <p className="mt-2 text-stone-600">
          เมนูสำหรับข้อมูลลูกค้า สินค้า การจัดส่ง และการตั้งค่าร้าน
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {MORE_DESTINATIONS.map((destination) => (
          <Link
            aria-label={destination.label}
            className="group flex min-h-11 flex-col justify-between rounded-3xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
            href={destination.href}
            key={destination.href}
          >
            <h2 className="text-lg font-bold text-stone-900">
              {destination.label}
            </h2>
            <div className="mt-5 flex items-end justify-between gap-4">
              <p className="text-sm leading-6 text-stone-600">
                {destination.description}
              </p>
              <span
                aria-hidden="true"
                className="text-stone-400 transition group-hover:translate-x-1 group-hover:text-amber-800"
              >
                →
              </span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
