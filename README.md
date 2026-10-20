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
- Phase 3A วางแผนการผลิตก่อนล็อกรอบ พร้อม blocker/warning ที่อธิบายสิ่งที่ต้องแก้หรือสิ่งที่ยอมรับได้
- แนะนำจำนวนแบตช์และเปิดให้ override พร้อมบังคับบันทึกเหตุผลเมื่อปรับแผนหรือยอมรับการผลิตขาด
- ขยายสูตรเป็นยอดวัตถุดิบและบรรจุภัณฑ์ตามแผน โดยใช้ค่าเผื่อสูญเสียจากสูตรหรือค่าเริ่มต้นของร้าน
- snapshot ราคาที่มีผล ค่าแรง ค่าไฟ/แก๊ส ต้นทุน และข้อมูลออเดอร์ไว้ในแต่ละ generation; ถ้าราคาไม่ครบจะแสดง `ต้นทุนไม่สมบูรณ์` โดยยังเก็บยอดต้นทุนที่ทราบแล้ว
- ล็อกรอบแบบ atomic, ปลดล็อกด้วยเหตุผลและคำยืนยัน, แล้ว re-lock เป็น generation ใหม่ได้ โดยประวัติ generation เก่ายังคงเดิม
- เมื่อรอบถูกล็อก ช่องออเดอร์ที่กระทบการผลิตจะถูก freeze แต่เจ้าของร้านยังอัปเดตยอดชำระและสถานะที่ไม่กระทบการผลิตได้
- ยืนยันยอดสต๊อกจริงจาก Planning Generation ที่ใช้งานอยู่ และปรับยอดคงเหลือด้วย COUNT movement
- คำนวณจำนวนที่ขาดแบบไม่ติดลบ พร้อมแนะนำจำนวนแพ็กที่ควรซื้อจากขนาดหน่วยซื้อ
- บันทึกการซื้อได้หลายครั้งทั้งแบบซื้อบางส่วน ซื้อครบ และซื้อเกิน โดยยอดที่ซื้อทั้งหมดเข้าสมุดสต๊อก
- เก็บ PURCHASE movement และราคาซื้อจริงแต่ละครั้งไว้ในประวัติราคา
- ประวัติการนับสต๊อกและการซื้อของแต่ละ generation ยังคงอ่านได้หลังปลดล็อกและ re-lock
- Production Template ระดับรอบและระดับสินค้า พร้อมกิจกรรมที่กำหนดวัน–เวลาย้อนจากวันส่ง
- Production Timeline ของแต่ละ generation พร้อมแก้ไขงาน สถานะ และงานที่เพิ่มเอง
- Readiness dashboard และ responsive navigation สำหรับมือถือ/เดสก์ท็อป

ออเดอร์ที่ยกเลิกจะยังอยู่ในประวัติ แต่ไม่ถูกนับในยอดของรอบหรือความต้องการผลิต

เส้นทางหลักของรอบคือ `DRAFT → OPEN → LOCKED → IN_PRODUCTION → COMPLETED` โดยสั่ง lock พร้อมสร้าง snapshot ได้เฉพาะรอบ `OPEN` เท่านั้น การปลดล็อกทำได้จาก `LOCKED` หรือ `IN_PRODUCTION` และจะคืนรอบเป็น `OPEN` เพื่อวางแผนใหม่ ส่วน `COMPLETED` และ `CANCELLED` เป็นสถานะปลายทางและปลดล็อกไม่ได้ (`DRAFT`, `OPEN`, `LOCKED` และ `IN_PRODUCTION` ยังเลือกยกเลิกรอบได้ตาม transition ที่ระบบอนุญาต)

## Production Templates และ Timeline

จัดการ Template ที่ `/production/templates` และเปิดดูงานของรอบที่ `/cycles/:id/production` ได้ทั้งบนเดสก์ท็อปและมือถือ Template มี scope ระดับทั้งรอบหรือระดับสินค้า และใช้ active/archive semantics เพื่อรักษาประวัติเดิม

ก่อน lock รอบ สินค้าทุกตัวในแผนต้องมี Product Template ที่เปิดใช้งานและมี active activity อย่างน้อยหนึ่งรายการ ส่วน Cycle Template เป็นตัวเลือก เมื่อ lock สำเร็จระบบจะสร้าง Planning Snapshot และ Cycle Task Generation พร้อมกันใน transaction เดียวกัน งานแต่ละรายการจะเก็บชื่อและข้อมูลต้นทาง รวมถึงวัน–เวลาและจำนวน batch ที่ snapshot ไว้

การปลดล็อกจะทำให้ generation เดิมเป็นประวัติอ่านอย่างเดียว การ re-lock จะสร้าง generation ใหม่จาก Template และแผนล่าสุดโดยไม่คัดลอกการแก้ไขหรืองาน manual จากรุ่นเดิม งาน generated แก้ไขได้เฉพาะ current generation ขณะรอบเป็น `LOCKED` หรือ `IN_PRODUCTION`; งาน manual สถานะ `PENDING` เท่านั้นที่ลบได้แบบ soft delete และ `SKIPPED` ต้องมีเหตุผล

## สิ่งที่ยังอยู่ใน Phase ถัดไป

- การหักสต๊อกจากการใช้จริงระหว่างผลิต รวมถึง movement จากการใช้ ปรับยอด หรือสูญเสีย
- final cost หลังผลิตจริง และรายงานกำไร

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

Phase 3A ใช้ migration ฐาน `0005_phase_3a_planning_snapshots` และ forward-only integrity migrations `0006`–`0010` เพื่อเสริมข้อกำหนดของ snapshot, lineage, เหตุผล override, ข้อมูลการจัดส่งที่คัดลอก และ lifecycle ของรายการออเดอร์ โดยเพิ่มตารางวางแผน 11 ตาราง:

- `cycle_planning_snapshots` — หัว snapshot และ generation ของรอบ
- `cycle_planning_warnings` — warning ที่ยอมรับไว้ตอนล็อก
- `cycle_order_snapshots` — ข้อมูลออเดอร์/ลูกค้าที่คัดลอก
- `cycle_order_item_snapshots` — รายการสินค้าในออเดอร์ที่คัดลอก
- `cycle_recipe_plans` — สูตรและค่าการผลิตที่ใช้จริงใน generation
- `cycle_product_plans` — ยอดสั่ง แบตช์ และผลผลิตตามแผนต่อสินค้า
- `cycle_inventory_price_snapshots` — ราคาวัตถุดิบ/บรรจุภัณฑ์ที่มีผลตอนล็อก
- `cycle_material_requirements` — ปริมาณวัตถุดิบตามแผน
- `cycle_packaging_requirements` — ปริมาณบรรจุภัณฑ์ตามกฎ
- `cycle_product_cost_snapshots` — ต้นทุนรวมรายสินค้า
- `cycle_cost_snapshots` — ต้นทุนรวมทั้งรอบและสถานะความครบถ้วน

Phase 3B ใช้ migration `0011_phase_3b_inventory_shopping` โดยเพิ่มตาราง 3 ตาราง:

- `cycle_inventory_counts` — snapshot ยอดที่นับจริงและ COUNT movement ของแต่ละ planning generation
- `cycle_shopping_items` — จำนวนที่ขาด จำนวนแพ็กแนะนำ และราคาประมาณ ณ ตอนยืนยันสต๊อก
- `cycle_purchase_entries` — การซื้อแต่ละครั้ง ปริมาณรวม ราคาจริง ร้านค้า และการอ้างอิง PURCHASE movement/ประวัติราคา

Phase 4A ใช้ migration `0012_phase_4a_production_timeline` โดยเพิ่มตาราง Production Template, Activity, Task Generation และ Cycle Task พร้อม RLS, owner-scoped foreign keys, immutable generation guards และ lifecycle checks

Phase 4B ใช้ `drizzle/0013_phase_4b_operations.sql`: เพิ่มเวลานัดส่งใน Order และ Planning Snapshot และตาราง `order_item_packing_progress` พร้อม owner-scoped FK, `ON DELETE RESTRICT`, RLS และ integrity triggers สำหรับ Packing, fulfillment และการจบรอบ โดย backfill active items ของออเดอร์ `PACKED | DELIVERED` ก่อนเปิด triggers ไม่แก้ historical snapshot ย้อนหลัง

เมื่อตั้งค่า Supabase แล้ว ให้ใช้ migrations ทั้งหมดตามลำดับด้วยคำสั่งนี้ (รวม migration `0013`):

```bash
pnpm db:migrate
```

ตารางทุกชุดเปิด Row Level Security และไม่มี anonymous Data API policy แอปตรวจ `owner_id` ซ้ำใน application service และ Server Action ทุก mutation

### Apply Phase 4B บน Supabase

ยืนยัน project reference และ database target ว่าเป็น development/test ที่ได้รับอนุญาตก่อนใช้ `SUPABASE_DATABASE_URL` ของเป้าหมายนั้น แล้วรัน `pnpm db:migrate` เพียงครั้งเดียวตาม migration journal ห้ามใช้ฐาน production หรือเป้าหมายที่ระบุไม่ได้ ตรวจ `drizzle.__drizzle_migrations` ว่ารวม 0013, time columns ทั้งสองเป็น nullable `time without time zone`, Packing table เปิด RLS และไม่มี anonymous policy แล้วจึง deploy แอปและรัน authenticated E2E บนข้อมูลแยก namespace

การทดสอบ release ในเครื่องใช้ PostgreSQL ชั่วคราวที่ bind เฉพาะ loopback และ override `SUPABASE_DATABASE_URL` ก่อนโหลด env (ไม่ override กลับ) จึงใช้ Supabase เพียง Authentication เท่านั้น การผ่าน local migration/E2E ไม่ได้แปลว่า apply migration ให้ฐานร้านจริงแล้ว ต้อง apply และตรวจฐาน deployment แยกต่างหากเมื่อได้รับอนุญาต

## Operations Workspace (Phase 4B)

เปิด `/cycles/[id]/operations` จากรายละเอียดรอบหรือ Production Timeline เพื่อทำงานทีละรอบและสลับรอบผ่านตัวเลือกด้านบน งานเลยกำหนด/วันนี้ใช้เวลา `Asia/Bangkok`; งานวันถัดไปพับไว้และแสดงเฉพาะ current Task Generation ประวัติรุ่นเก่ายังคงอ่านได้ใน Production Timeline

เวลานัดส่งเป็น optional `HH:mm` ในวันส่งท้องถิ่น ไม่แปลงเป็น UTC และออเดอร์ที่ระบุเวลาเรียงก่อนออเดอร์ที่ไม่ระบุเวลา การแก้วัน/เวลาหลังล็อกต้อง unlock/re-lock; ค่า null ไม่เปลี่ยน fingerprint ของแผนเก่า

ต้องกดเริ่มรอบผลิตและยืนยัน/เริ่มทำออเดอร์เองตามลำดับ `NEW → CONFIRMED → IN_PRODUCTION → PACKED → DELIVERED` ไม่มี automatic cascade เมื่อ Task เสร็จหรือแพ็กครบ Packing เป็นจำนวนเต็มต่อ active Order Item ตั้งแต่ 0 ถึงจำนวนสั่ง และบันทึกเป็นยอดสะสมแบบ absolute เพื่อไม่เพิ่มซ้ำเมื่อ retry ต้องกด “ยืนยันแพ็กครบ” เอง; หากแก้ก่อนส่งให้ “เปิดแก้ไขการแพ็ก” ก่อน หลังส่ง Packing/fulfillment อ่านอย่างเดียว การส่งหลายออเดอร์รับเฉพาะ `PACKED` และสำเร็จทั้งชุดหรือ rollback ทั้งชุด

Unlock ทำได้ก่อนเริ่ม Order Operations; หลังมีออเดอร์ `IN_PRODUCTION | PACKED | DELIVERED` หรือ Packing มากกว่าศูนย์จะถูกบล็อก การรับเงินอย่างเดียวไม่บล็อก unlock จบรอบได้เมื่อ current Tasks ทุกงาน `DONE | SKIPPED` (ข้ามต้องมีเหตุผล) และทุกออเดอร์ที่ไม่ยกเลิกส่งแล้ว ยอดค้างเป็นคำเตือน ไม่ใช่ตัวบล็อก

Quick Payment รับเพิ่ม/ชำระครบ/แก้ยอดสะสมได้ ห้ามยอดติดลบ เกินยอดรวม หรือเขียนทับ stale amount และยังใช้หลังส่งหรือ Cycle `COMPLETED` ได้ ออเดอร์ `REFUNDED` ใช้ refund/restore เดิมที่ Order detail; Cycle `CANCELLED` อ่านอย่างเดียวใน Operations รอบที่จบแบบเก่าแต่ยังมีงาน/ออเดอร์ค้างแสดง integrity warning โดยไม่เขียนประวัติใหม่

Phase 5 ยังไม่รวมในรุ่นนี้: payment ledger, carrier/tracking API, stock consumption, actual cost/profit, CSV, offline sync, notifications และ multi-user roles

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
pnpm test:e2e
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

E2E ใช้ชื่อข้อมูลที่ไม่ซ้ำในแต่ละรอบและไม่ต้องมีหน้า sign-up สาธารณะ ข้อมูล fixture จะถูกเก็บต่อในฐานข้อมูล จึงต้องใช้ฐาน development/test แยกเฉพาะ (แนะนำ PostgreSQL ชั่วคราวแบบ loopback แล้วลบ container/volume หลังทดสอบ) ห้ามใช้ production project ตั้ง `CI=1` เพื่อบังคับ fresh webserver และตรวจ port 3000 ว่างก่อนเริ่ม อย่าหยุด server ที่ไม่เกี่ยวข้อง เก็บ traces/screenshots ใน private temporary directory เพราะอาจมีข้อมูล login และลบเมื่อเสร็จ
