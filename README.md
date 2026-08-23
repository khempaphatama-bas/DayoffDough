# Day Off Dough OS

เว็บหลังร้านสำหรับเจ้าของร้านเบเกอรี่หนึ่งคน ใช้จัดการข้อมูลตั้งต้น รับออเดอร์ และวางแผนการผลิตในแต่ละ Bake Cycle

## ฟีเจอร์ปัจจุบัน

- Owner-only authentication ผ่าน Supabase
- ตั้งค่าค่าแรง ค่าเผื่อสูญเสีย เขตเวลา และสกุลเงิน
- วัตถุดิบ/บรรจุภัณฑ์ ประวัติราคา และการนับสต๊อกจริง
- สินค้า สูตรแบบแยกเวอร์ชัน และการเปิดใช้สูตร
- วิธีส่ง กฎบรรจุภัณฑ์ และการคัดลอกค่าส่ง/ต้นทุน/สถานที่ส่งเข้าออเดอร์เพื่อเก็บประวัติ
- ลูกค้า พร้อมช่องทางติดต่อและค่าเริ่มต้นการจัดส่ง
- Bake Cycle สำหรับวันปิดรับออเดอร์ วันผลิต วันส่งหลัก และสถานะรอบ
- ออเดอร์หลายรายการสินค้า พร้อมยอดสินค้า ส่วนลด ค่าส่ง ยอดสุทธิ ยอดชำระ และยอดคงเหลือ
- การติดตามสถานะการชำระเงินและการจัดเตรียมแยกจากกัน รวมถึงการคืนเงินและยกเลิกออเดอร์
- ความต้องการผลิตรวมแบบสดต่อ Bake Cycle โดยรวมสินค้าซ้ำและตัดออเดอร์ที่ยกเลิกออก
- Readiness dashboard และ responsive navigation สำหรับมือถือ/เดสก์ท็อป

ออเดอร์ที่ยกเลิกจะยังอยู่ในประวัติ แต่ไม่ถูกนับในยอดของรอบหรือความต้องการผลิต

## Phase ถัดไป

- Lock/Snapshot รอบผลิต
- การคำนวณวัตถุดิบและ shopping list
- production timeline
- รายงานกำไร

## Runtime

- Node.js 24.x
- pnpm 11.x

ใน Codex workspace นี้สามารถเพิ่ม bundled runtime เข้า `PATH` ได้ด้วย:

```bash
export PATH="/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/aekkapom/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
```

## ตั้งค่า Supabase

1. สร้าง Supabase project สำหรับ development หรือเปิด local Supabase project
2. สร้างผู้ใช้เจ้าของร้านใน Supabase Authentication ล่วงหน้า ระบบไม่มี public sign-up
3. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าจริง:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_DATABASE_URL=postgresql://...
OWNER_EMAIL=owner@example.com
E2E_OWNER_EMAIL=owner@example.com
E2E_OWNER_PASSWORD=ใช้เฉพาะบัญชีทดสอบและห้าม commit
```

`OWNER_EMAIL` ต้องตรงกับ email ของผู้ใช้ที่สร้างไว้ การเชื่อมต่อฐานข้อมูลใช้ server-side connection string เท่านั้น ห้ามนำ service-role key หรือ database URL ไปไว้ในตัวแปร `NEXT_PUBLIC_*`

ใช้ migrations ที่ commit ไว้ทั้งหมด:

```bash
pnpm db:migrate
```

คำสั่งนี้รวม migration `0004_phase_2_orders` ซึ่งเพิ่มตาราง Phase 2:

- `customers` — ข้อมูลลูกค้าและค่าเริ่มต้นการจัดส่ง
- `bake_cycles` — รอบรับออเดอร์และการผลิต
- `orders` — หัวออเดอร์ ยอดเงิน และสถานะ
- `order_items` — รายการสินค้าแต่ละบรรทัดของออเดอร์

ตารางทุกชุดเปิด Row Level Security และไม่มี anonymous Data API policy แอปตรวจ `owner_id` ซ้ำใน application service และ Server Action ทุก mutation

## พัฒนา

```bash
pnpm install
pnpm dev
```

เปิด `http://localhost:3000` แล้วเข้าสู่ระบบด้วยบัญชี `OWNER_EMAIL`

## ตรวจสอบ

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

Playwright รองรับสองโหมด:

1. Local Supabase ที่มี user ตรงกับ `OWNER_EMAIL`
2. Remote development Supabase ด้วย credentials ที่ไม่ใช่ production

หลังใส่ `E2E_OWNER_EMAIL` และ `E2E_OWNER_PASSWORD`:

```bash
pnpm exec playwright install chromium
pnpm test:e2e --project=phone
pnpm test:e2e --project=desktop
```

E2E ใช้ชื่อข้อมูลที่ไม่ซ้ำในแต่ละรอบและไม่ต้องมีหน้า sign-up สาธารณะ
