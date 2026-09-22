# Day Off Dough OS — Phase 4B Operations Workspace Design

**วันที่:** 2026-09-22

**สถานะ:** ส่วนออกแบบได้รับการอนุมัติในบทสนทนาแล้ว รอผู้ใช้ตรวจเอกสารฉบับนี้ก่อนเขียน Implementation Plan

**ฐานที่ใช้:** Phase 4A บน `main` ที่ commit `238fb6f812e8f8b4e5a7e668ed6d9564430b6c55`

**ขอบเขตผู้ใช้:** เจ้าของร้านหนึ่งคน

## 1. เป้าหมาย

เพิ่มหน้าปฏิบัติงานแบบ mobile-first ต่อ Bake Cycle เพื่อให้เจ้าของร้านเห็นงานที่ต้องทำต่อ บันทึกการแพ็ก รับชำระเงิน จัดส่งหลายออเดอร์ และปิดรอบผลิตได้จาก workflow เดียว โดยใช้ Cycle Task Generation ของ Phase 4A เป็นแกนกลาง

Phase 4B ต้องทำให้เจ้าของร้านสามารถ:

1. เปิด Operations Workspace ของ Bake Cycle ทีละรอบและสลับระหว่างรอบที่กำลังทำได้
2. เห็นงานค้างและงานวันนี้เรียงตามเวลา ก่อนรายละเอียดแพ็ก ชำระเงิน และจัดส่ง
3. เริ่มรอบผลิตและเริ่มทำออเดอร์ด้วยการยืนยันอย่างชัดเจน
4. บันทึกจำนวนที่แพ็กแล้วต่อ Order Item และยืนยันว่าออเดอร์แพ็กครบ
5. รับเงินเพิ่มหรือแก้ยอดสะสมอย่างรวดเร็วโดยไม่เกิดยอดซ้ำจากการกดซ้ำ
6. เลือกหลายออเดอร์ที่แพ็กแล้วและยืนยันส่งสำเร็จพร้อมกัน
7. จบรอบได้เมื่อทุกงานและทุกออเดอร์ผ่านเงื่อนไข โดยยอดค้างชำระเป็นคำเตือน ไม่ใช่ตัวบล็อก
8. แก้ข้อมูลแพ็กก่อนส่ง และรับหรือแก้ยอดชำระภายหลังการส่งหรือจบรอบได้

## 2. การตัดสินใจที่อนุมัติแล้ว

- Operations เป็นหน้าแยกต่อ Bake Cycle ไม่รวมหลาย Cycle ไว้ใน Timeline เดียว
- ด้านบนมีตัวสลับ Cycle เพื่อย้ายไปอีกรอบโดยไม่ต้องย้อนหลายหน้า
- ลำดับความสำคัญของหน้าคือ “งานตามเวลา” ก่อน “แพ็ก/ชำระ/จัดส่ง”
- ค่าเริ่มต้นของ Timeline แสดงงานเลยกำหนดและงานวันนี้ทั้งหมด ส่วนวันถัดไปพับไว้
- ทุกการเปลี่ยนสถานะต้องมาจากการยืนยันของเจ้าของ ระบบเสนอ next action และทำแบบกลุ่มได้ แต่ไม่ cascade สถานะอัตโนมัติ
- ต้องกด “เริ่มรอบผลิต” เพื่อเปลี่ยน Cycle จาก `LOCKED` เป็น `IN_PRODUCTION` ก่อนบันทึกการแพ็กหรือจัดส่ง
- การรับชำระเงินทำได้โดยไม่ต้องรอเริ่มผลิต
- Packing progress อยู่ระดับ Order Item และเก็บเป็นจำนวนเต็ม เช่น `6 / 10`
- จำนวนแพ็กต้องอยู่ระหว่างศูนย์ถึงจำนวนที่สั่ง
- ต้องเริ่มทำออเดอร์อย่างชัดเจนก่อนกรอกจำนวนแพ็ก
- เมื่อทุก Order Item แพ็กครบ ระบบแสดง “ยืนยันแพ็กครบ”; สถานะเปลี่ยนเป็น `PACKED` เมื่อเจ้าของกดเท่านั้น
- หากต้องแก้การแพ็กของออเดอร์ `PACKED` เจ้าของต้องกด “เปิดแก้ไขการแพ็ก” ก่อน ระบบจึงย้อนเป็น `IN_PRODUCTION`
- แก้ Packing progress และ fulfillment status ได้จนก่อนออเดอร์เป็น `DELIVERED`; หลังส่งแล้วเป็น read-only
- Quick Payment รองรับเพิ่มยอดที่รับ ปุ่ม “ชำระครบ” และการแก้ยอดสะสม แต่ไม่มี payment transaction ledger ใน Phase 4B
- ยอดสะสมห้ามติดลบหรือเกินยอดรวมออเดอร์
- Payment แก้ได้หลัง `DELIVERED` และหลัง Cycle `COMPLETED` เพื่อรองรับเก็บเงินปลายทางหรือโอนภายหลัง
- Delivery รองรับเลือกหลายออเดอร์ที่ `PACKED` แล้วเปลี่ยนเป็น `DELIVERED` ใน transaction เดียว
- การจบรอบต้องมี Cycle Task ทุกงานเป็น `DONE | SKIPPED` และออเดอร์ที่ไม่ยกเลิกทุกใบเป็น `DELIVERED`
- `SKIPPED` ยังคงต้องมีเหตุผลตาม Phase 4A
- ออเดอร์ `UNPAID | PARTIAL` แสดงคำเตือนและยอดค้างรวม แต่ไม่บล็อกการจบรอบ
- ออเดอร์ `CANCELLED` ไม่รวมในงานค้างหรือ completion gate และแสดงในส่วนพับแยกเพื่อการตรวจสอบ
- รายการออเดอร์เรียงตามวันส่ง เวลานัดส่ง วิธีจัดส่ง และชื่อลูกค้า
- เพิ่มเวลานัดส่งแบบ optional ในออเดอร์ ออเดอร์ที่มีเวลาเรียงก่อนออเดอร์ที่ไม่ระบุเวลาในวันเดียวกัน
- ยังคงอนุญาต unlock/re-lock ตาม Phase 4A จนกว่าจะเริ่มทำออเดอร์แรก เมื่อมีออเดอร์ `IN_PRODUCTION | PACKED | DELIVERED` หรือมี Packing progress มากกว่าศูนย์ ระบบต้องบล็อก unlock
- การรับเงินอย่างเดียวไม่บล็อก unlock เพราะไม่เปลี่ยน production input หรือ packing state
- ใช้ Operations Workspace พร้อม relational packing state แยกจาก Order Item แทนการยัดทุกอย่างไว้ในหน้าเดิมหรือสร้าง event ledger เต็มรูปแบบ

## 3. ขอบเขตที่ทำ

- เพิ่มเวลานัดส่ง optional ใน Order form, Order read model, Planning Snapshot และ Planning fingerprint
- เพิ่ม relational Packing progress ต่อ Order Item
- เพิ่ม Operations query/read model ต่อ Cycle
- เพิ่ม guarded commands สำหรับเริ่มรอบ ยืนยันออเดอร์ เริ่มทำออเดอร์ แก้จำนวนแพ็ก ยืนยันแพ็กครบ เปิดแก้ไข รับเงิน ส่งสำเร็จแบบกลุ่ม และจบรอบ
- ปิด mutation path เดิมที่สามารถข้าม guard ของ Operations ได้
- เพิ่ม unlock guard เมื่อเริ่ม fulfillment/packing แล้ว
- เพิ่มหน้า `/cycles/[id]/operations` แบบ phone-first และ responsive desktop
- เชื่อมทางเข้าจาก Cycle detail, dashboard/รายการรอบที่เกี่ยวข้อง และ Production Timeline
- แสดง current task generation เท่านั้นใน Operations; history ยังคงอยู่หน้า Production เดิม
- Owner-scoped authorization, RLS, composite foreign keys, database integrity guards และ transaction/concurrency handling
- Unit, migration/schema, application integration, component, action/page และ Playwright coverage

## 4. สิ่งที่ไม่ทำ

- Payment transaction ledger, ใบเสร็จ หรือการกระทบยอดธนาคาร
- เชื่อม API ของ KEX, same-day carrier, tracking, label หรือพิมพ์ใบปะหน้า
- ตัด stock จริง, actual ingredient usage, waste, final cost, profit หรือ CSV ซึ่งอยู่ Phase 5
- Offline sync หรือ optimistic queue ข้ามการขาดอินเทอร์เน็ต
- Push notification, reminder หรือ calendar sync
- หลายผู้ใช้, role, assignment หรือ approval chain
- รวมงานจากหลาย Bake Cycle ใน Timeline เดียว
- เปลี่ยน Cycle/Order status อัตโนมัติจากการทำ Task หรือกรอก Packing progress
- เปลี่ยนความหมายของ Production Template, Planning Snapshot หรือ historical Cycle Task Generation ของ Phase 4A

## 5. แนวทางสถาปัตยกรรม

เพิ่ม module `operations` เป็น application orchestration boundary ภายใน modular monolith โดยไม่ย้าย ownership เดิม:

- `production` ยังเป็นเจ้าของ Cycle Task และ Task Generation
- `orders` ยังเป็นเจ้าของ Order, Order Item, fulfillment และ payment fields
- `cycles` ยังเป็นเจ้าของ Bake Cycle lifecycle
- `planning` ยังเป็นเจ้าของ active Planning Snapshot และ unlock/re-lock generation
- `operations` เป็นเจ้าของ Packing progress, Operations read model และ transaction ที่ประสานหลาย module

โครงสร้างนี้ทำให้กฎข้าม module อยู่ใน command เดียวแทนการเรียกหลาย service ต่อกันจาก UI และทำให้ cycle completion ตรวจ Task, Order และ Cycle ภายใต้ transaction เดียวได้

Server Actions มีหน้าที่เพียง:

1. ตรวจ authenticated owner
2. parse FormData ด้วย schema
3. เรียก Operations command
4. map typed error เป็นข้อความภาษาไทย
5. revalidate เส้นทางที่เกี่ยวข้อง

UI และ Server Action ห้ามเขียน `orders`, `bake_cycles` หรือ Packing progress โดยตรงเพื่อหลีกเลี่ยง bypass ของ domain guard

## 6. โมเดลข้อมูล

### 6.1 เวลานัดส่ง

เพิ่มฟิลด์ nullable ต่อไปนี้:

- `orders.confirmed_delivery_time`: `time without time zone`
- `cycle_order_snapshots.confirmed_delivery_time`: `time without time zone`

กติกา:

- รับค่า UI แบบ `HH:mm` และ normalize เป็น local shop time
- วันที่และเวลาเป็นเวลาท้องถิ่น `Asia/Bangkok`; ไม่แปลง time-only เป็น UTC
- ค่า null หมายถึงยังไม่กำหนดเวลานัดส่ง
- เวลานัดส่งเป็น production/planning-relevant input ต้องรวมใน planning source, canonical fingerprint และ snapshot writer
- canonical fingerprint ต้องไม่เพิ่ม key ของเวลานัดส่งเมื่อค่าเป็น null เพื่อให้ fingerprint ของข้อมูลเดิมที่ไม่มีเวลายังคงเสถียร; เมื่อมีเวลาจึงรวมค่า normalized `HH:mm` ใน payload
- เมื่อ Cycle ถูกล็อกแล้ว การแก้เวลานัดส่งต้องใช้ unlock/re-lock เช่นเดียวกับ confirmed delivery date
- historical Planning Snapshot เดิมคงค่า null และไม่ถูกเขียนย้อนหลัง

### 6.2 `order_item_packing_progress`

หนึ่งแถวแทน Packing progress ของ active Order Item หนึ่งรายการ

ฟิลด์หลัก:

- `id`: UUID primary key
- `owner_id`
- `order_item_id`
- `packed_quantity`: integer, default `0`
- `created_at`
- `updated_at`

Constraints และ indexes:

- unique `(owner_id, order_item_id)`
- composite owner foreign key `(owner_id, order_item_id)` ไป `order_items(owner_id, id)` และ `ON DELETE RESTRICT`
- check `packed_quantity >= 0`
- owner-scoped index สำหรับ join และ command lookup
- Packing progress ไม่ถูก hard-deleteจาก application; การแก้กลับเป็นศูนย์คือ correction ของค่าปัจจุบัน ไม่ใช่ event ledger

Database guard ต้องตรวจข้ามตารางว่า:

- Order Item ยัง active และเป็นของ owner/order/cycle เดียวกัน
- `packed_quantity <= order_items.quantity`
- Cycle เป็น `IN_PRODUCTION`
- Order เป็น `IN_PRODUCTION`; Order ที่ `PACKED` ต้องผ่านคำสั่ง “เปิดแก้ไขการแพ็ก” เพื่อย้อนสถานะก่อน
- Order ไม่เป็น `DELIVERED | CANCELLED`

Application command ต้องตรวจเงื่อนไขเดิมภายใต้ row lock ก่อนเขียน Database guard เป็นแนวป้องกันสุดท้ายสำหรับ path ที่ไม่ได้ผ่าน command

เพิ่ม database trigger สำหรับ Order fulfillment transition ด้วย เพื่อบังคับ adjacent transitions, packing completeness, Cycle state และ correction exception แม้มีการเขียนตรงผ่าน Data API ส่วน migration backfill ต้องทำก่อนเปิด trigger นี้

### 6.3 Order และ Payment state

Phase 4B ไม่เพิ่ม payment ledger และไม่ duplicate ยอดเงินใน Operations table ใช้ฟิลด์เดิม:

- `orders.amount_paid_satang`
- `orders.payment_status`

ทุกครั้งที่แก้ยอด ระบบ derive สถานะใหม่:

- `0` = `UNPAID`
- มากกว่าศูนย์แต่น้อยกว่า grand total = `PARTIAL`
- เท่ากับ grand total = `PAID`
- มากกว่า grand total = invalid

Order ที่ `REFUNDED` ไม่รับ Quick Payment และใช้ refund flow เดิมจนกว่าจะมี design ใหม่เกี่ยวกับ payment history

### 6.4 RLS และ ownership

- เปิด RLS บน `order_item_packing_progress`
- browser ไม่เป็นผู้กำหนด `owner_id`; server derive จาก session
- ไม่มี anonymous write policy
- unknown UUID และ UUID ของ owner อื่นต้องให้ผลลัพธ์ state-not-found แบบเดียวกัน
- ทุก join และ mutation ใช้ owner-scoped key ไม่อาศัย UUID เดี่ยวเพื่อ authorize

## 7. Lifecycle และสถานะ

### 7.1 Bake Cycle

- `LOCKED -> IN_PRODUCTION`: ปุ่ม “เริ่มรอบผลิต” และ owner ยืนยัน
- `IN_PRODUCTION -> COMPLETED`: ใช้ guarded completion command เท่านั้น
- คำสั่ง generic `changeStatus` ต้องไม่สามารถเปลี่ยนเป็น `COMPLETED` โดยข้าม Operations completion gate
- `COMPLETED` อ่านข้อมูล production/packing/delivery อย่างเดียว แต่ Payment ยังแก้ได้
- `CANCELLED` อ่านอย่างเดียวใน Operations

### 7.2 Order fulfillment

เส้นทางปกติเป็น adjacent explicit transitions:

`NEW -> CONFIRMED -> IN_PRODUCTION -> PACKED -> DELIVERED`

กติกา:

- `NEW -> CONFIRMED`: เจ้าของยืนยันออเดอร์; ทำทีละใบหรือเป็นกลุ่มได้
- `CONFIRMED -> IN_PRODUCTION`: “เริ่มทำออเดอร์”; Cycle ต้องเป็น `IN_PRODUCTION`
- `IN_PRODUCTION -> PACKED`: Packing progress ของ active items ทุกแถวต้องเท่ากับ quantity และเจ้าของกด “ยืนยันแพ็กครบ”
- `PACKED -> DELIVERED`: เจ้าของเลือกและยืนยัน; ทำเป็นกลุ่มได้
- `PACKED -> IN_PRODUCTION`: backward correction ที่อนุญาตเฉพาะคำสั่ง “เปิดแก้ไขการแพ็ก” ก่อนส่ง
- `DELIVERED` เป็น terminal สำหรับ packing/fulfillment ใน Phase 4B
- `CANCELLED` ไม่เข้ากระแส Operations และไม่ย้อนกลับ
- ห้ามกระโดดข้ามสถานะ เช่น `CONFIRMED -> PACKED` หรือ `IN_PRODUCTION -> DELIVERED`

Service/Action เดิมของหน้า Order detail ต้องเรียก guard เดียวกันหรือจำกัด transition ให้ตรงกฎนี้ มิฉะนั้นหน้าเดิมจะเป็น bypass ของ Operations

### 7.3 Unlock/re-lock

Planning unlock command ต้องล็อก Cycle และตรวจ Order/Packing state ใน transaction เดียวกัน

อนุญาต unlock เมื่อ:

- Cycle อยู่ในสถานะที่ Phase 4A อนุญาต
- ไม่มีออเดอร์ที่ไม่ยกเลิกเป็น `IN_PRODUCTION | PACKED | DELIVERED`
- ไม่มี Packing progress ที่มากกว่าศูนย์

Task status และ Payment อย่างเดียวไม่บล็อก unlock เพื่อรักษาพฤติกรรม generation history ของ Phase 4A และรองรับรับเงินล่วงหน้า

เมื่อ unlock สำเร็จ current Task Generation กลายเป็น history ตามกติกาเดิม Packing progress ที่เป็นศูนย์ไม่ต้องลบ และเมื่อ re-lock Operations ใช้ active Planning Snapshot/Generation ใหม่

### 7.4 Cycle completion

Completion command ต้องล็อกและตรวจซ้ำ:

- Cycle เป็น `IN_PRODUCTION`
- active Planning Snapshot และ current Task Generation ยังเป็นชุดเดียวกับที่ผู้ใช้เห็น
- Cycle Task ที่ไม่ถูก soft-delete ทุกงานเป็น `DONE | SKIPPED`
- ทุก `SKIPPED` มีเหตุผลตาม integrity rule เดิม
- Order ที่ไม่เป็น `CANCELLED` ทุกใบเป็น `DELIVERED`

ยอดค้างชำระไม่บล็อก แต่ confirmation dialog ต้องแสดงอย่างน้อย:

- จำนวนออเดอร์ที่ยัง `UNPAID | PARTIAL`
- ยอดค้างรวม
- ข้อความว่าหลังจบรอบยังรับหรือแก้ยอดชำระได้

คำสั่งต้อง recheck เงื่อนไขใน transaction ไม่เชื่อค่าจาก UI

## 8. Operations Commands

Commands หลัก:

1. `startCycleOperations(ownerId, cycleId)`
2. `confirmOrders(ownerId, cycleId, orderIds)`
3. `startOrders(ownerId, cycleId, orderIds)`
4. `setPackedQuantity(ownerId, cycleId, orderItemId, packedQuantity, expectedPackedQuantity)`
5. `confirmOrderPacked(ownerId, cycleId, orderId)`
6. `reopenOrderPacking(ownerId, cycleId, orderId)`
7. `setOrderAmountPaid(ownerId, orderId, targetAmountPaidSatang, expectedAmountPaidSatang)`
8. `deliverOrders(ownerId, cycleId, orderIds)`
9. `completeCycleOperations(ownerId, cycleId, expectedTaskGenerationId)`

หลักร่วม:

- parse UUID, integer และ money ก่อนเริ่ม transaction
- lock Cycle ก่อน Order และ lock Order ตาม UUID ที่ sort แล้วเพื่อลด deadlock
- batch input ต้อง unique, non-empty และมีขนาดสูงสุดที่กำหนด
- batch command สำเร็จทั้งหมดหรือ rollback ทั้งหมด
- คำสั่งแบบ set ใช้ absolute target จึง retry ค่าเดิมได้โดยไม่เพิ่มซ้ำ
- Payment ใช้ `expectedAmountPaidSatang`; ถ้าค่าปัจจุบันเท่ากับ target แล้วให้ถือว่า exact retry สำเร็จ ถ้าค่าปัจจุบันไม่เท่ากับ expected หรือ target ให้ตอบ stale conflict
- Packing ใช้หลักเดียวกันกับ `expectedPackedQuantity`; progress ที่ยังไม่มีแถวอ่านเป็นศูนย์และ command ล็อก Order Item ก่อนสร้างแถวเพื่อป้องกัน concurrent insert
- State transition exact retry ที่ปลายทางเดิมแล้วคืน success; transition จากสถานะอื่นที่ไม่ใช่ต้นทาง/ปลายทางที่คาดให้ error
- ทุก mutation ตรวจ owner, Cycle membership, current snapshot/generation และ lifecycle ภายใน transaction

### 8.1 การป้องกัน bypass

ต้องปรับ mutation path ปัจจุบันดังนี้:

- Generic Cycle status service ห้าม `IN_PRODUCTION -> COMPLETED` โดยตรง; ต้อง delegate ไป completion command
- Generic Order fulfillment service ห้าม forward jump และต้องใช้ packing guard สำหรับ `PACKED`/`DELIVERED`
- Database trigger ของ `orders.fulfillment_status` ต้องบังคับ transition matrix เดียวกัน เพื่อไม่ให้ Data API เป็น bypass
- Database trigger ของ `bake_cycles.status` ต้องตรวจ completion gate เมื่อเปลี่ยนเป็น `COMPLETED`; generic path จึงไม่สามารถหลบ guarded command ได้แม้เขียนตรง
- Order full-edit path ใน Cycle ที่ locked/production/completed ยังแก้ Payment ได้ แต่แก้ production input หรือเวลานัดส่งไม่ได้
- Quick Payment และ Order full-edit ใช้กฎยอดไม่เกินเดียวกัน
- Planning unlock action ใช้ Operations unlock guard ก่อน supersede snapshot

## 9. Operations Read Model

เพิ่ม `getCycleOperationsView(ownerId, cycleId, now)` ซึ่งประกอบด้วย:

- Cycle header และรายการ Cycle สำหรับ switcher
- active Planning Snapshot และ current Task Generation
- งานเลยกำหนด งานวันนี้ และงานอนาคต
- Orders, active Order Items, Packing progress, customer, delivery method, totals และ payment/fulfillment state
- completion readiness และ blocker/warning summaries

แหล่งข้อมูล:

- ใช้ active Planning Snapshot เป็นขอบเขตของ production generation
- ใช้ live Order/Order Item เฉพาะ mutable fulfillment/payment/packing state และ owner-scoped lineage ที่ snapshot อ้างถึง
- ใช้ current Cycle Task Generation เท่านั้นใน Operations
- Cycle Task Generation เก่าอ่านจาก Production history เดิม
- ออเดอร์ `CANCELLED` ใน Cycle แสดงในส่วนพับแยกและไม่รวมตัวเลข active work

การเรียง Order:

1. `confirmed_delivery_date`, เร็วกว่าก่อน
2. `confirmed_delivery_time`, เวลาที่ระบุก่อน null และเวลาเร็วกว่าก่อน
3. delivery method name
4. customer name
5. order ID เป็น deterministic tie-breaker

เวลา Task และคำว่า “วันนี้/เลยกำหนด” ใช้ `Asia/Bangkok` เท่านั้น และรับ `now` เป็น dependency เพื่อให้ทดสอบขอบวันได้แน่นอน

Cycle switcher แสดง `LOCKED | IN_PRODUCTION` ก่อนตามวันส่ง และเปิดดู Cycle `COMPLETED | CANCELLED` ที่ผู้ใช้เข้ามาโดยตรงได้โดยไม่รวมเข้าคิวงาน active

## 10. UX และโครงสร้างหน้า

เส้นทางหลัก: `/cycles/[id]/operations`

### 10.1 Header

- Cycle switcher
- ชื่อรอบ วันผลิต/วันส่ง และ status badge
- readiness summary แบบสั้น
- ปุ่ม “เริ่มรอบผลิต” เมื่อ `LOCKED`
- ปุ่ม “จบรอบผลิต” เมื่อ `IN_PRODUCTION`; disabled พร้อมเหตุผลถ้ายังไม่พร้อม

### 10.2 ต้องทำอะไรต่อ

- แสดง overdue ก่อน แล้วงานวันนี้ตาม `scheduledAt`
- งานวันถัดไปอยู่ใน disclosure ที่พับเป็นค่าเริ่มต้น
- ใช้ Cycle Task control ของ Phase 4A และ revalidate Operations หลังแก้
- Empty state แยกกรณีไม่มี generation, ไม่มีงานวันนี้ และงานเสร็จทั้งหมด

### 10.3 เตรียมและแพ็กออเดอร์

- Order card แสดงเวลาส่ง วิธีส่ง ลูกค้า payment badge และ fulfillment badge
- `NEW` มี action “ยืนยันออเดอร์”
- `CONFIRMED` มี action “เริ่มทำออเดอร์”
- `IN_PRODUCTION` แสดงรายการสินค้า จำนวนที่สั่ง และ input/stepper จำนวนแพ็ก
- `PACKED` แสดงสรุปครบพร้อม action “เปิดแก้ไขการแพ็ก” และ checkbox สำหรับ delivery selection
- `DELIVERED` แสดง read-only completion state
- จำนวนแพ็กบันทึกเป็น absolute value; ปุ่ม `+/-` เป็นเพียงตัวช่วย UI และต้องไม่ทำ delta write ที่ retry แล้วเพิ่มซ้ำ
- ปุ่ม “ยืนยันแพ็กครบ” ปรากฏเมื่อทุก active item ครบ แต่ status ไม่เปลี่ยนจนกด

### 10.4 รับชำระเงิน

- แสดงยอดรวม รับแล้ว และคงเหลือ
- กรอก “รับเพิ่ม” แล้ว UI คำนวณ target cumulative amount
- ปุ่ม “ชำระครบ” ตั้ง target เท่ากับ grand total
- มี action “แก้ยอดสะสม” สำหรับแก้ข้อมูลผิด รวมถึงหลังส่งหรือจบรอบ
- ไม่รับค่าติดลบ เกินยอดรวม ไม่ใช่จำนวนเต็มสตางค์ หรือ stale expected amount
- Order `REFUNDED` แสดง read-only พร้อมลิงก์ไป Order detail

### 10.5 พร้อมจัดส่ง

- แสดงเฉพาะ `PACKED`
- เลือกหลายออเดอร์และกด “ยืนยันส่งสำเร็จ”
- Confirmation แสดงจำนวนออเดอร์ ลูกค้า วิธีส่ง และคำเตือนยอดค้าง โดยยอดค้างไม่บล็อก
- หาก order ใดเปลี่ยนสถานะก่อนยืนยัน transaction ทั้งชุด rollback และ UI ระบุให้ refresh

### 10.6 จบรอบและสถานะปลายทาง

- Dialog จบรอบแสดง task/order readiness และ payment warning
- หลังสำเร็จ packing/task/delivery เป็น read-only
- Quick Payment ยังคง active สำหรับ order ที่ไม่ `REFUNDED`
- cancelled orders อยู่ใน disclosure “ออเดอร์ที่ยกเลิก”

บนโทรศัพท์ primary action ของ section ที่กำลังทำใช้ sticky bottom action เฉพาะเมื่อไม่บัง field/error และทุก control ต้องมี label, focus state และ touch target ที่เหมาะสม

## 11. Concurrency และความถูกต้อง

ลำดับ lock มาตรฐาน:

1. Bake Cycle
2. active Planning Snapshot/current Task Generation เมื่อคำสั่งเกี่ยวข้อง
3. Orders เรียง UUID
4. Order Items เรียง UUID
5. Packing progress

กรณีสำคัญ:

- `confirmOrderPacked` ล็อก Order, active items และ progress แล้วตรวจครบก่อนเปลี่ยนสถานะ
- `reopenOrderPacking` ล็อก Order และอนุญาตเฉพาะ `PACKED`
- `deliverOrders` ล็อกทุก Order ตามลำดับและยอมรับเฉพาะ `PACKED` หรือ exact retry ที่ `DELIVERED`
- `completeCycleOperations` ล็อก Cycle ก่อน Task/Order เพื่อตัด race กับ task edit, delivery และ unlock
- `setOrderAmountPaid` อนุญาตเมื่อ Cycle terminal ได้ แต่ยังใช้ compare-and-set กับยอดเดิม
- unlock ล็อก Cycle แล้วตรวจ fulfillment/packing ก่อน supersede snapshot
- cross-owner และ unknown IDs ต้องไม่เปิดเผยว่าข้อมูลมีอยู่จริง

## 12. Validation และ Error UX

Typed application errors อย่างน้อย:

- `NOT_FOUND`
- `STALE_DATA`
- `INVALID_CYCLE_STATE`
- `INVALID_ORDER_STATE`
- `PACKING_INCOMPLETE`
- `PACKED_QUANTITY_OUT_OF_RANGE`
- `PAYMENT_OUT_OF_RANGE`
- `UNLOCK_BLOCKED_BY_OPERATIONS`
- `CYCLE_COMPLETION_BLOCKED`

UI map เป็นข้อความไทยที่บอกสิ่งที่แก้ได้ เช่น:

- “จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึง 10”
- “ออเดอร์นี้มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด”
- “ยังจบรอบไม่ได้: มีงานค้าง 2 งาน และออเดอร์ยังไม่ส่ง 1 ใบ”
- “ปลดล็อกรอบไม่ได้ เพราะเริ่มทำออเดอร์แล้ว”

เมื่อ request ล้มเหลว:

- ค่าที่กรอกต้องไม่หาย
- checkbox selection ที่ยัง valid คงอยู่
- แสดงปุ่มลองใหม่หรือ refresh ตามชนิด error
- ไม่แสดง success toast ก่อน server ยืนยัน

## 13. Migration และข้อมูลเดิม

Migration ถัดไปต้อง:

1. เพิ่ม `confirmed_delivery_time` แบบ nullable ใน `orders` และ `cycle_order_snapshots`
2. สร้าง `order_item_packing_progress`, indexes, FK และ RLS โดยยังไม่เปิด operational-state trigger
3. backfill Packing progress ของ active items ใน Order ที่เป็น `PACKED | DELIVERED` ให้เท่ากับ quantity เพื่อให้ข้อมูลเดิมสอดคล้องกับสถานะ
4. เปิด Packing, Order fulfillment และ Cycle completion integrity triggers หลัง backfill เสร็จ
5. ไม่ backfill Order ที่ `NEW | CONFIRMED | IN_PRODUCTION | CANCELLED`; query ใช้ `0` เมื่อไม่มี progress row
6. ไม่แก้ historical Planning Snapshot เดิม; `confirmed_delivery_time` เป็น null
7. เพิ่ม schema exports และ migration integrity tests

Cycle `COMPLETED` ที่มี Order ยังไม่ `DELIVERED` จาก behavior เดิมไม่ถูกเขียนประวัติย้อนหลัง Operations แสดง read-only พร้อม integrity warning ส่วน completion gate ใหม่ใช้กับการ complete หลัง deploy เท่านั้น

Deploy ลำดับ:

1. ทดสอบ migration ด้วย PGlite และฐาน test
2. apply migration ไป Supabase development/test
3. deploy application ที่รองรับทั้ง time null และ progress row ที่ยังไม่มี
4. รัน authenticated E2E บนข้อมูลแยก namespace
5. ตรวจ cleanup และ RLS หลัง E2E

## 14. กลยุทธ์การทดสอบ

### 14.1 Domain tests

- packed quantity boundaries
- order transition matrix และ correction exception
- payment target/derived status/no-overpayment
- order sorting ที่มี/ไม่มีเวลา
- Bangkok today/overdue boundary
- completion readiness และ payment warning
- unlock blocking predicate

### 14.2 Migration/schema integrity

- owner-scoped FK และ RLS
- packing quantity ไม่ติดลบและไม่เกิน order quantity
- ห้ามเขียน packing ให้ item inactive, owner อื่น, Cycle/Order state ผิด
- backfill `PACKED | DELIVERED` ถูกต้องและ rerun-safe ตาม migration contract
- historical rows ที่ time null อ่านได้

### 14.3 Application integration

- command success path และ exact retry
- stale compare-and-set สำหรับ packing/payment
- unknown กับ cross-owner ให้ error kind/message เดียวกัน
- batch transition all-or-nothing, duplicate IDs และ deterministic lock order
- ห้าม transition jump และห้าม bypass จาก service เดิม
- current generation guard หลัง unlock/re-lock
- unlock ก่อนเริ่ม operations สำเร็จ แต่หลังเริ่ม order/progress ถูกบล็อก
- completion แข่งกับ task edit, delivery, unlock และ order status change
- Payment หลัง `DELIVERED | COMPLETED` สำเร็จ แต่ refunded ถูกปฏิเสธ

### 14.4 Component/action/page tests

- default แสดง overdue + today และพับ future
- cycle switcher ไม่รวม timeline ข้ามรอบ
- Order card actions ตามสถานะ
- packing input เก็บค่าหลัง error และไม่เกิน quantity
- confirm packed ปรากฏเฉพาะเมื่อครบ
- bulk delivery confirmation และ error recovery
- completion blockers กับ unpaid warning
- completed page read-only ยกเว้น Payment
- server actions ตรวจ auth, parse, error mapping และ revalidation paths

### 14.5 E2E

Phone และ desktop ต้องครอบคลุมอย่างน้อย:

1. สร้าง Order พร้อมเวลานัดส่งและ lock Cycle
2. เปิด Operations และเริ่มรอบผลิต
3. ยืนยัน/เริ่มทำออเดอร์
4. แพ็กบางส่วนแล้วแพ็กครบ
5. รับเงินบางส่วนหรือชำระครบ
6. ยืนยันแพ็กครบและส่งหลายออเดอร์
7. ทำ Task ให้ครบ/skip พร้อมเหตุผล
8. จบรอบพร้อม payment warning
9. รับเงินที่เหลือหลัง Cycle completed
10. พิสูจน์ว่า unlock ถูกบล็อกหลังเริ่มทำ Order

ก่อนส่งมอบต้องผ่าน focused suites, full test suite, typecheck, lint, production build และ authenticated Playwright โดยไม่ทิ้งข้อมูล E2E

## 15. Acceptance Criteria

Phase 4B ถือว่าเสร็จเมื่อ:

- เจ้าของเปิด Operations ของ Cycle เดียวและสลับรอบได้
- Timeline แสดง overdue/today ถูกต้องใน Bangkok timezone
- Packing progress ระดับ item ถูกต้อง ป้องกัน overpack และ retry ไม่เพิ่มซ้ำ
- Fulfillment ทุกขั้นต้องยืนยันและข้ามสถานะไม่ได้
- แพ็กผิดแก้ได้ก่อนส่ง แต่แก้ไม่ได้หลังส่ง
- Quick Payment ไม่ติดลบ/เกิน/เพิ่มซ้ำ และยังใช้ได้หลังส่งหรือจบรอบ
- Bulk Delivery เป็น atomic และรับเฉพาะ packed orders
- Cycle complete ไม่ผ่านหากมี Task หรือ Delivery ค้าง แต่ unpaid เป็นเพียงคำเตือน
- unlock ถูกบล็อกหลังเริ่ม order operations และยังทำได้ก่อนจุดนั้น
- Order detail, Cycle detail และ path เดิมไม่สามารถ bypass guard ใหม่
- ข้อมูล owner อื่นไม่อ่านหรือเขียนได้ และ unknown/cross-owner ไม่เปิดเผยข้อมูล
- historical Planning/Task generations ยังคง immutable
- phone/desktop E2E และ verification suite ผ่าน

## 16. ผลต่อ Phase 5

Phase 5 สามารถใช้ Operations state ต่อเพื่อ:

- บันทึก actual ingredient/packaging consumption
- สร้าง final cost snapshot เมื่อ Cycle completed
- คำนวณ actual profit โดยแยกยอดค้างชำระออกจากต้นทุน
- export CSV และ recovery workflow

Phase 4B ไม่ควรผูก Packing progress กับ inventory movement โดยตรง เพื่อให้ Phase 5 ออกแบบ consumption และ correction semantics แยกต่างหาก
