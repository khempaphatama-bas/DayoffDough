# Day Off Dough OS — Phase 4A Production Templates and Cycle Tasks Design

**วันที่:** 2026-09-12

**สถานะ:** ผู้ใช้ตรวจและอนุมัติ Design Spec แล้ว

**ฐานที่ใช้:** Phase 3B บน `main` ที่ commit `62c6a00`

**ขอบเขตผู้ใช้:** เจ้าของร้านหนึ่งคน

## 1. เป้าหมาย

เพิ่ม Production Timeline ที่เปลี่ยน Planning Generation ของ Bake Cycle ให้เป็นรายการงานลงวันที่และเวลา เจ้าของร้านต้องสามารถกำหนดขั้นตอนมาตรฐานระดับทั้งรอบและระดับสินค้า แล้วใช้รายการงานจริงระหว่างเตรียมและผลิตได้โดยไม่เปลี่ยน Template ต้นทาง

Phase 4A ต้องทำให้เจ้าของร้านสามารถ:

1. สร้าง Cycle Template และ Product Template พร้อมกิจกรรมที่อ้างอิงวันส่งหลัก
2. ล็อกรอบแล้วได้งานครบจาก Template ที่เปิดใช้งานใน transaction เดียวกับ Planning Snapshot
3. เห็นจำนวน batch ที่เลือกไว้ใน Phase 3A บนงานของแต่ละสินค้า
4. แก้ข้อมูลงานของ generation ปัจจุบันได้โดยไม่แก้ Template
5. เพิ่มงานเฉพาะกิจและเปลี่ยนสถานะงานโดยไม่ต้องปลดล็อกรอบ
6. ปลดล็อกและ re-lock แล้วได้งาน generation ใหม่ โดยชุดเก่าเป็นประวัติอ่านอย่างเดียว

## 2. การตัดสินใจที่อนุมัติแล้ว

- รองรับ Template สองขอบเขต: `CYCLE` และ `PRODUCT`
- มี Cycle Template ที่เปิดใช้งานได้ไม่เกินหนึ่งชุดต่อ owner และมี Product Template ที่เปิดใช้งานได้หนึ่งชุดต่อสินค้า
- Cycle Template ไม่บังคับ แต่สินค้าทุกตัวในแผนต้องมี Product Template ที่เปิดใช้งานและพร้อมใช้ จึงจะล็อกรอบได้
- ถ้าสินค้าใดไม่มี Product Template ระบบต้องบล็อกการล็อกรอบและแสดงรายชื่อสินค้าที่ต้องแก้
- งานจาก Product Template สร้างแยกต่อกิจกรรมและต่อสินค้า ไม่รวมงานข้ามสินค้า แม้ชื่อกิจกรรมเหมือนกัน
- หากสินค้าต้องผลิตหลาย batch จะสร้างหนึ่งงานต่อกิจกรรม/สินค้าและแสดงจำนวน batch รวมบนงาน ไม่สร้างหนึ่งงานต่อ batch
- งานที่ชื่อเหมือนกันจัดกลุ่มให้อยู่ใกล้กันใน UI ตามวันและเวลา แต่ยังเป็นคนละ record
- งานที่สร้างแล้วแก้ข้อมูลทางธุรกิจที่มองเห็นได้ทั้งหมด รวมชื่อกิจกรรม สินค้าที่อ้างอิง จำนวน batch วัน–เวลา ระยะเวลา โน้ต และสถานะ
- ระบบเก็บ Template, Activity และ Product ต้นทางแยกจากค่าปัจจุบันของงานเพื่อ audit
- เจ้าของร้านเพิ่ม manual task เฉพาะ generation ปัจจุบันได้ โดยไม่แก้ Template
- สถานะงานคือ `PENDING | IN_PROGRESS | DONE | SKIPPED`; `SKIPPED` ต้องมีเหตุผล
- สถานะเปลี่ยนไปมาได้เพื่อแก้ข้อมูลผิด และต้องล้างเหตุผลข้ามเมื่อออกจาก `SKIPPED`
- งานจาก Template ลบไม่ได้ ให้ใช้ `SKIPPED`; manual task ที่ยัง `PENDING` เท่านั้นที่ลบแบบ soft delete ได้
- เมื่อ unlock งาน generation เดิมหยุดแก้ไขทันทีและคงเป็นประวัติ เมื่อ re-lock จะสร้าง task generation ใหม่
- ใช้ normalized relational rows และ immutable generation history ไม่ใช้ JSON document หรือคำนวณ Timeline สดจาก Template

การอนุมัติให้แก้ทุกฟิลด์ของ Cycle Task ในสเปกนี้แทนที่ข้อกำหนดเดิมใน MVP Design §7.6 ที่ระบุเพียงเวลา หมายเหตุ และสถานะ ส่วนหลักการ snapshot ที่ไม่แก้ Template ยังคงเดิม

## 3. ขอบเขตที่ทำ

- สร้างและแก้ Production Template/Activity โดยใช้ deactivate หรือ archive แทน hard-delete
- เปิด/ปิดใช้งานและทำสำเนา Template
- เรียงลำดับ Template Activity
- ตรวจความพร้อมของ Product Template ในหน้า planning preview และ lock command
- รวม Template data ใน planning input fingerprint
- สร้าง Cycle Task Generation และ Cycle Tasks ใน transaction ล็อกรอบเดิม
- อ่าน current และ historical task generations
- แก้ Cycle Task generation ปัจจุบัน
- เพิ่มและ soft-delete manual task ตามกติกา
- เปลี่ยนสถานะงานโดยไม่ unlock
- UI สำหรับ Template และงานของ Bake Cycle ที่ responsive บน phone และ desktop
- Owner-scoped authorization, composite foreign keys, RLS และ database integrity guards
- Unit, schema, application, component และ Playwright coverage

## 4. สิ่งที่ไม่ทำ

- Dependency graph ระหว่างงาน
- การเลื่อนงานอื่นอัตโนมัติเมื่องานหนึ่งล่าช้า
- Resource, oven, mixer หรือพนักงาน scheduling
- งานซ้ำหนึ่ง record ต่อ batch
- Push notification, reminder, calendar sync หรือ external integration
- การตัด stock จากการทำ Cycle Task
- Actual ingredient usage หรือ actual waste
- การเริ่ม `IN_PROGRESS` แล้วเปลี่ยนสถานะ Bake Cycle อัตโนมัติ
- การทำงานครบแล้วปิด Bake Cycle อัตโนมัติ
- หน้าปฏิบัติงานรวม production, packing, payment และ delivery แบบแตะเร็ว ซึ่งเป็น Phase 4B

## 5. แนวทางสถาปัตยกรรม

เพิ่ม module `production` เป็นขอบเขตใหม่ใน modular monolith:

- domain functions ตรวจข้อมูล Template คำนวณวัน–เวลา สร้าง task draft และตรวจ task mutation โดยไม่เข้าฐานข้อมูล
- query services โหลด Template list, editor data, current generation และ history
- command services ดูแล Template activation, task edits, manual tasks และ concurrency
- planning preview โหลด active Template เป็น production-relevant input
- planning lock command เรียก task generation writer ภายใน transaction เดิม หลังสร้าง Planning Snapshot และก่อนเปลี่ยน Bake Cycle เป็น `LOCKED`
- Server Actions ตรวจ owner session, แปลง error เป็นข้อความไทย และ revalidate route ที่เกี่ยวข้อง
- UI แยกหน้าจัดการ Template ออกจากหน้ารายการงานจริงของ Bake Cycle

`cycle_planning_snapshots` ยังคงเป็นเจ้าของ lifecycle ของ generation ส่วน `cycle_task_generations` เป็นลูกแบบหนึ่งต่อหนึ่ง ไม่เก็บสถานะ `ACTIVE/SUPERSEDED` ซ้ำ การแก้ไขได้หรือไม่ derive จาก Planning Snapshot และ Bake Cycle เพื่อไม่ให้เกิดสองแหล่งความจริง

## 6. โมเดลข้อมูล

ทุกตารางใหม่ใช้ UUID primary key, `owner_id`, timestamps, owner-scoped indexes, composite owner foreign keys และ RLS ตาม conventions ของโมดูลปัจจุบัน

### 6.1 `production_templates`

หนึ่งแถวแทน Template หนึ่งชุด

ฟิลด์หลัก:

- `id`
- `owner_id`
- `name`
- `scope`: `CYCLE | PRODUCT`
- `product_id`, nullable เฉพาะ `CYCLE`
- `active`
- `created_at`
- `updated_at`

Constraints:

- `CYCLE` ต้องไม่มี `product_id`
- `PRODUCT` ต้องมี `product_id`
- partial unique index อนุญาต active `CYCLE` Template ได้หนึ่งชุดต่อ owner
- partial unique index อนุญาต active `PRODUCT` Template ได้หนึ่งชุดต่อ owner/product
- product foreign key ต้อง owner-scoped และ `ON DELETE RESTRICT`
- Template ไม่มี hard-delete command ใน Phase 4A; ใช้ deactivate เพื่อรักษา lineage

Cycle Template เป็น optional Product Template เป็น required lock input สำหรับทุก product plan

### 6.2 `production_template_activities`

หนึ่งแถวแทนกิจกรรมหนึ่งขั้นใน Template

ฟิลด์หลัก:

- `id`
- `owner_id`
- `production_template_id`
- `name`
- `offset_days_from_delivery`, integer; ค่าลบคือก่อนส่ง ศูนย์คือวันส่ง และค่าบวกคือหลังส่ง
- `default_time`, เวลา local ของร้าน
- `estimated_duration_minutes`, positive integer
- `sequence`, positive integer
- `notes`, nullable
- `active`; false หมายถึงถูกนำออกจากขั้นตอนปัจจุบันแต่ยังเก็บ lineage
- `created_at`
- `updated_at`

Constraints:

- partial unique owner/template/sequence เฉพาะ Activity ที่ active
- owner-scoped Template foreign key และ `ON DELETE RESTRICT`
- ชื่อหลัง trim ต้องไม่ว่าง
- duration และ sequence ต้องเป็นจำนวนเต็มบวก
- ไม่มี hard-delete command; การนำ Activity ออกจาก Template คือเปลี่ยนเป็น inactive
- command ต้องไม่อนุญาต activate Template ที่ไม่มี active Activity และไม่อนุญาต archive active Activity สุดท้ายจาก Template ที่ active

การแก้ Template หรือ Activity หลังมี task generation แล้วไม่เปลี่ยนงานเก่า

### 6.3 `cycle_task_generations`

หนึ่งแถวต่อ Planning Snapshot หนึ่ง generation

ฟิลด์หลัก:

- `id`
- `owner_id`
- `bake_cycle_id`
- `planning_snapshot_id`
- `generation`, ต้องเท่ากับ Planning Snapshot generation
- `primary_delivery_date` ที่คัดลอกจาก Planning Snapshot
- `timezone` ที่คัดลอกจาก Planning Snapshot
- `created_at`

Constraints:

- unique owner/planning snapshot
- unique owner/cycle/generation
- composite owner/cycle/planning-snapshot foreign key ป้องกันการผูกข้ามรอบ
- PostgreSQL insert trigger ตรวจว่า generation, primary delivery date และ timezone ตรงกับ Planning Snapshot ที่อ้างถึง
- `ON DELETE RESTRICT`

สถานะของ task generation derive ดังนี้:

- Planning Snapshot `ACTIVE` และ cycle `LOCKED | IN_PRODUCTION` = current และแก้ได้
- Planning Snapshot `SUPERSEDED` หรือ cycle `COMPLETED | CANCELLED` = history และอ่านอย่างเดียว

### 6.4 `cycle_tasks`

หนึ่งแถวแทนงานจริงหนึ่งรายการ

ฟิลด์ lineage ที่แก้ไม่ได้:

- `id`
- `owner_id`
- `cycle_task_generation_id`
- `origin`: `TEMPLATE | MANUAL`
- `source_template_id`, nullable สำหรับ manual task
- `source_activity_id`, nullable สำหรับ manual task
- `source_template_scope`, nullable สำหรับ manual task
- `source_product_id`, nullable สำหรับ cycle-level และ manual task
- `source_template_name`, nullable สำหรับ manual task
- `source_activity_name`, nullable สำหรับ manual task
- `source_product_name`, nullable สำหรับ cycle-level และ manual task
- `creation_request_id`, client-generated UUID สำหรับ idempotent manual create; nullable สำหรับ generated task

ฟิลด์ทางธุรกิจที่แก้ได้ใน current generation:

- `title`
- `product_id`, nullable เพื่อแทนงานระดับทั้งรอบ
- `product_name`, nullable และคัดลอกใหม่เมื่อเปลี่ยน product
- `batch_count`, positive decimal หรือ nullable
- `scheduled_at`, timestamp with time zone
- `estimated_duration_minutes`, positive integer
- `notes`, nullable
- `sequence`, positive integer ใช้เป็น tie-breaker เมื่อเวลาเท่ากัน
- `status`: `PENDING | IN_PROGRESS | DONE | SKIPPED`
- `skip_reason`, nullable
- `deleted_at`, nullable และใช้เฉพาะ manual task ที่ยัง `PENDING`
- `created_at`
- `updated_at`

Constraints:

- `TEMPLATE` ต้องมี source Template, Activity และชื่อ snapshot; `MANUAL` ต้องไม่มี source lineage
- source scope `CYCLE` ต้องไม่มี source product ส่วน `PRODUCT` ต้องมี source product และชื่อ source product
- `creation_request_id` ต้องมีเฉพาะ manual task และ unique ต่อ owner
- `product_id` และ `product_name` ต้องเป็น null พร้อมกันหรือมีค่าพร้อมกัน
- `batch_count` เป็น null หรือมากกว่าศูนย์
- `SKIPPED` ต้องมี `skip_reason` หลัง trim; สถานะอื่นต้องไม่มีเหตุผลข้าม
- `deleted_at` มีค่าได้เมื่อ `origin = MANUAL` และ `status = PENDING` เท่านั้น
- current product foreign key และทุก source foreign key ต้อง owner-scoped
- source lineage และ generation foreign key เปลี่ยนไม่ได้หลัง insert
- ไม่มี hard-delete path สำหรับ Cycle Task

PostgreSQL trigger ต้องปฏิเสธ Cycle Task insert/update เมื่อ parent Planning Snapshot ไม่ `ACTIVE` และปฏิเสธ update เมื่อ Bake Cycle ไม่ใช่ `LOCKED | IN_PRODUCTION` การ insert งานจาก Template ระหว่าง lock transaction อนุญาตขณะ cycle ยัง `OPEN`; manual insert ต้องใช้ cycle ที่ `LOCKED | IN_PRODUCTION` Trigger ต้องปฏิเสธ hard-delete ทุกกรณีและป้องกันการแก้ source lineage หรือ generation foreign key หลัง insert

### 6.5 RLS และ indexes

- เปิด RLS บนทุกตารางใหม่
- Browser ไม่ส่ง `owner_id`; server derive จาก authenticated owner
- ไม่มี anonymous Data API write policy
- index owner/scope/active, owner/product/active, owner/template/sequence, owner/cycle/generation และ owner/task-generation/scheduled-at
- ทุก cross-table relationship ใช้ composite owner foreign key
- ใช้ `ON DELETE RESTRICT` กับข้อมูลที่เป็น lineage หรือ history

## 7. กฎการสร้างงาน

### 7.1 Template selection

ต่อหนึ่ง lock attempt ระบบโหลด:

- active Cycle Template ศูนย์หรือหนึ่งชุด
- active Product Template หนึ่งชุดสำหรับทุก `cycle_product_plan`

Product Template ที่ไม่มี active Activity หรือไม่ active ถือว่าไม่พร้อมใช้และเป็น blocker เช่นเดียวกับไม่มี Template ส่วน inactive Activities ไม่เข้าการสร้างงาน

### 7.2 Task expansion

- สร้าง Cycle Task หนึ่งงานต่อ Activity ใน active Cycle Template โดย `product_id` และ `batch_count` เริ่มเป็น null
- สร้าง Cycle Task หนึ่งงานต่อ Product Template Activity ต่อ Product Plan
- Product task คัดลอก `source_product_id`, product name และ `selected_batch_count` จาก immutable Planning Snapshot
- ไม่รวม task record แม้ชื่อ เวลา หรือกิจกรรมเหมือนกัน
- UI อาจจัดงานชื่อเดียวกันให้อยู่ใกล้กัน แต่การแก้สถานะของงานหนึ่งไม่เปลี่ยนงานอื่น

### 7.3 Date and time

สำหรับทุก generated task:

```text
scheduledLocalDate = primaryDeliveryDate + offsetDaysFromDelivery
scheduledLocalDateTime = scheduledLocalDate + defaultTime
scheduledAt = convert scheduledLocalDateTime from snapshotted timezone to UTC
```

การบวกวันใช้ calendar date ใน timezone ของ Planning Snapshot ไม่ใช้การบวก 24 ชั่วโมงกับ UTC timestamp

ลำดับแสดงผลคือ `scheduled_at`, Activity `sequence`, product name และ stable task ID เพื่อให้ผล deterministic

### 7.4 Snapshot behavior

ชื่อ Template, Activity, source product, วันส่งหลัก, timezone, batch count, schedule, duration, sequence และ notes ถูกคัดลอกตอน lock การแก้ Template, Product หรือแผนหลักภายหลังไม่เปลี่ยน Cycle Task ที่สร้างแล้ว

เมื่อเจ้าของแก้ฟิลด์ทางธุรกิจของ Cycle Task ระบบเปลี่ยนเฉพาะ task record ไม่เปลี่ยน source lineage, Template หรือ Planning Snapshot

## 8. Planning Preview และ Lock Data Flow

### 8.1 Preview

`buildPlanningPreview` ต้องโหลด active Production Templates หลังรู้ product plans แล้วเพิ่ม blocker ต่อสินค้าที่ไม่มี Product Template พร้อมใช้ Blocker ต้องมี code คงที่, product ID, ชื่อสินค้าที่คัดลอก และข้อความไทยที่ลิงก์ไปยังการสร้างหรือเปิด Template ได้

ข้อมูล Template ที่มีผลต่อ generation ต้องเข้าการสร้าง planning input fingerprint ได้แก่:

- Template ID, scope, product ID และ active state ที่ถูกเลือก
- active Activity ID, name, offset, default time, duration, sequence และ notes

การเปลี่ยน Template ระหว่าง preview กับ confirm lock จึงทำให้ fingerprint เปลี่ยนและคืน flow `ข้อมูลรอบเปลี่ยนแล้ว กรุณาตรวจสอบแผนอีกครั้ง` โดยไม่สร้าง snapshot

### 8.2 Confirm lock

ขยาย repeatable-read lock transaction เดิมตามลำดับ:

1. verify owner และ lock Bake Cycle row
2. ใช้ `lock_request_id` เดิมเพื่อ idempotency
3. re-read planning และ Template inputs
4. ตรวจ blockers, warnings และ fingerprint
5. สร้าง Planning Snapshot และ normalized child rows เดิม
6. สร้าง Cycle Task Generation ที่อ้างถึง Planning Snapshot
7. expand Template Activities และ insert Cycle Tasks
8. เปลี่ยน Bake Cycle เป็น `LOCKED` และตั้ง active planning pointer
9. commit

ถ้าขั้นตอนใดล้มเหลว ต้อง rollback Planning Snapshot, Cycle Task Generation, Cycle Tasks และ cycle state ทั้งหมด

`lock_request_id` ที่ retry สำเร็จแล้วคืน generation เดิม Task Generation unique ต่อ Planning Snapshot จึงไม่สร้างงานซ้ำ

### 8.3 Unlock and re-lock

ใช้ unlock transaction เดิมของ Phase 3A เมื่อ Planning Snapshot เปลี่ยนเป็น `SUPERSEDED` งานของ generation นั้นจะอ่านอย่างเดียวทันทีโดยไม่ต้อง update ทุก task

re-lock โหลด Template และ Product Plan ล่าสุด สร้าง Planning Generation และ Task Generation ใหม่ทั้งหมด ไม่คัดลอก task edits หรือ manual tasks จาก generation เก่า และไม่ลบชุดเก่า

## 9. Application Contracts

ชื่อจริงอาจปรับตาม conventions ระหว่างทำ Implementation Plan แต่ขอบเขตต้องคงดังนี้

### 9.1 Template queries and commands

- list Template พร้อม activity count และ active state
- load Template editor พร้อม Activities ตาม sequence
- create/update Template และ Activities ภายใต้ owner scope
- duplicate Template เป็น inactive copy
- activate Template ใน transaction โดย deactivate Template เดิมใน scope เดียวกันก่อนเปิดชุดใหม่; UI ต้องยืนยันเมื่อเป็นการสลับชุด
- deactivate Template โดยไม่กระทบ task generations เดิม

การ activate ต้องตรวจ Template มีอย่างน้อยหนึ่ง Activity และ Product Template อ้างถึง active Product record ที่ owner เข้าถึงได้

### 9.2 Cycle task query

query รับ owner, cycle และ optional generation แล้วคืนหนึ่งในสาม mode:

- `CURRENT`: active generation พร้อม mutation controls
- `HISTORY`: superseded หรือ terminal generation แบบ read-only
- `NO_GENERATION`: cycle ยังไม่เคยมี Timeline หรือเป็น legacy planning generation

ผลลัพธ์รวม generation summaries สำหรับ history selector และ task rows ที่ sort แบบ deterministic

### 9.3 Task mutations

- update ฟิลด์ทางธุรกิจของ task ใน current generation
- เปลี่ยน status ใดไป status ใดได้ภายใต้ validation ของ `SKIPPED`
- create manual task พร้อม `creation_request_id`; retry payload เดิมคืน task เดิม
- soft-delete ได้เฉพาะ manual task ที่ `PENDING`

ทุก mutation ต้อง lock Cycle row แล้ว task row ตามลำดับ ตรวจ active planning pointer และ Planning Snapshot status ภายใน transaction ห้ามเชื่อถือ disabled UI

## 10. Lifecycle

- `DRAFT | OPEN`: ไม่มี current editable task generation
- lock จาก `OPEN`: สร้าง Planning Snapshot และ Task Generation ใน transaction เดียว
- `LOCKED | IN_PRODUCTION`: current generation แก้ task, เพิ่ม manual task และเปลี่ยน status ได้โดยไม่ unlock
- unlock: active Planning Snapshot เป็น `SUPERSEDED`; task generation เดิมอ่านอย่างเดียว
- re-lock: สร้าง generation ใหม่จาก Template และแผนล่าสุด
- `COMPLETED | CANCELLED`: task history อ่านอย่างเดียว

การเปลี่ยน Task เป็น `IN_PROGRESS` ไม่เปลี่ยน Bake Cycle status และการที่ทุก Task เป็น `DONE/SKIPPED` ไม่ปิดรอบอัตโนมัติ

## 11. UX และ Routes

### 11.1 Production Templates

เพิ่ม route หลัก:

```text
/production/templates
/production/templates/new
/production/templates/[id]
```

หน้ารวม:

- แยก Cycle Template กับ Product Template
- แสดง active/inactive และสินค้า
- มี action สร้าง แก้ ทำสำเนา เปิดและปิดใช้งาน
- แสดงสินค้าที่ active แต่ยังไม่มี active Product Template เพื่อเตรียมข้อมูลก่อน lock

หน้า editor:

- กรอกชื่อ scope และ product
- เพิ่ม archive/restore และลากเรียง Activity โดยไม่ hard-delete lineage
- กำหนด offset แบบก่อน/วันเดียวกัน/หลังวันส่ง, เวลา, ระยะเวลา และ notes
- แสดงตัวอย่างวันที่เชิงสัมพัทธ์โดยไม่ผูกกับ Bake Cycle
- ป้องกันการ activate จนกว่าข้อมูลครบ

เพิ่มทางเข้าจากเมนู `เพิ่มเติม` ตาม navigation ปัจจุบัน

### 11.2 Cycle production tasks

เพิ่ม route:

```text
/cycles/[id]/production
/cycles/[id]/production?generation=N
```

current generation view:

- header แสดง Bake Cycle, Planning Generation และวันส่งหลัก
- task cards เรียงตามวันและเวลา แบ่ง section ต่อวัน
- งานชื่อเดียวกันอยู่ใกล้กัน แต่ card แสดงสินค้าแยกชัด
- card แสดงชื่อ สินค้า batch เวลา duration notes และ status
- edit form แก้ทุก business field ที่อนุมัติแล้ว
- quick status controls รองรับ phone
- manual task action อยู่ใน generation ปัจจุบัน
- soft-deleted manual tasks ไม่แสดงในรายการปกติแต่ยังเก็บไว้เพื่อ audit
- `SKIPPED` เปิดช่องเหตุผลและห้ามบันทึกถ้าว่าง

history view:

- generation selector ใช้รูปแบบเดียวกับ Planning และ Shopping pages
- แสดงเหตุผลและเวลาที่ unlock จาก Planning Snapshot
- ไม่มี mutation controls และ server/database ปฏิเสธ mutation แม้ยิง request โดยตรง

หน้า planning preview แสดง Product Template blockers ด้านบนและมีลิงก์ไป Template screen Blockers ปิดปุ่ม lock ตาม pattern ปัจจุบัน

Phase 4A ต้อง responsive และไม่มี dense table เป็นทางเดียวในการทำงาน ส่วนการปรับ flow ปฏิบัติงานรวมหลายสถานะให้แตะน้อยที่สุดอยู่ใน Phase 4B

## 12. Validation และ Error Handling

### 12.1 Template validation

- name ต้องไม่ว่างและอยู่ในขนาดเดียวกับ master-data names ปัจจุบัน
- scope/product pairing ต้องถูกต้อง
- offset ต้องเป็น integer
- default time ต้องเป็น local time ที่ parse ได้
- duration และ sequence ต้องเป็น positive integer
- Activity name ต้องไม่ว่าง
- active Template ต้องมีอย่างน้อยหนึ่ง Activity
- unique indexes เป็น authoritative guard สำหรับ concurrent activation

### 12.2 Lock blockers

- product ไม่มี active Product Template
- active Product Template ไม่มีกิจกรรมพร้อมใช้
- Template data ผิด constraint หรือไม่อยู่ใน owner scope

Blocker message ต้องระบุชื่อสินค้าและการแก้ ห้ามแสดง internal IDs เป็นคำอธิบายหลัก

### 12.3 Task validation

- mutation ต้องอ้าง current Task Generation และ current active Planning Snapshot
- title ต้องไม่ว่าง
- selected product ต้องอยู่ใน owner scope; การเลือก product ใหม่ต้องคัดลอกชื่อปัจจุบันเข้า task
- batch count เป็น null หรือ positive decimal
- schedule ต้อง parse ได้และเก็บเป็น UTC timestamp
- duration และ sequence เป็น positive integer
- `SKIPPED` ต้องมีเหตุผล; ออกจาก `SKIPPED` ต้องล้างเหตุผล
- soft-delete ต้องเป็น manual `PENDING`

Field errors แสดงใกล้ input และรักษาค่า form ข้อความผิดพลาดภาษาไทยที่ปลอดภัยใช้กับ concurrency หรือ database failures; diagnostics เต็มอยู่ server-side และไม่มี credentials

## 13. Concurrency และ Idempotency

- Template activation ใช้ transaction และ database unique indexes
- planning fingerprint ตรวจ stale Template edits ก่อน lock
- lock transaction ใช้ cycle row lock และ existing `lock_request_id`
- manual task creation ใช้ `creation_request_id`; retry payload เดิมคืน task เดิม ส่วน request ID เดิมกับ payload ต่างกันต้องปฏิเสธ
- task update และ soft-delete lock cycle ก่อน task เพื่อใช้ lock order คงที่
- ถ้า generation ถูก supersede ระหว่างเปิด form กับ submit ให้ปฏิเสธด้วยข้อความ `แผนงานชุดนี้ถูกแทนที่แล้ว กรุณาเปิดรุ่นปัจจุบัน`
- double submit ต้องไม่สร้าง task generation หรือ manual task ซ้ำ

## 14. Security และ Integrity

- ทุก route, query และ command ต้องผ่าน verified owner session และ configured owner email
- `owner_id` derive server-side เสมอ
- ทุก query และ mutation owner-scoped
- composite owner foreign keys ป้องกัน cross-owner references
- RLS เป็น defense in depth และ browser ไม่มี write access โดยตรง
- Template source lineage และ task generation relationship แก้ไม่ได้หลัง insert
- database integrity guard ป้องกันการเขียน task history แม้ bypass UI
- error response ไม่เผย database URL, service-role key, SQL หรือ cross-owner existence
- inaccessible ID คืน not-found outcome เดียวกับ ID ที่ไม่มีอยู่

## 15. Migration และข้อมูลเดิม

Migration เพิ่ม enums, tables, constraints, indexes, RLS และ integrity guards แบบ additive ไม่เปลี่ยน Planning หรือ Shopping snapshot เก่า

Planning Snapshot ที่สร้างก่อน Phase 4A จะไม่มี Task Generation และแสดง `รอบรุ่นนี้ยังไม่มี Production Timeline`:

- ถ้า cycle เป็น `LOCKED | IN_PRODUCTION` เจ้าของสามารถ unlock และ re-lock เพื่อสร้าง Timeline ตาม Template ปัจจุบัน
- ถ้า cycle เป็น `COMPLETED | CANCELLED` ให้คงเป็นประวัติโดยไม่ backfill

ห้าม backfill งานจาก Template ปัจจุบันเข้า generation เก่า เพราะจะทำให้ประวัติดูเหมือนเป็นข้อมูลที่มีอยู่ตอน lock ทั้งที่ไม่ใช่

## 16. การทดสอบ

### 16.1 Domain tests

- date offset ก่อน วันเดียวกัน และหลังวันส่งใน snapshotted timezone
- calendar-date calculation ไม่เลื่อนวันจาก UTC conversion
- Cycle Template ขยายหนึ่งงานต่อ Activity
- Product Template ขยายหนึ่งงานต่อ Activity/Product Plan
- selected decimal batch count ถูกคัดลอกโดยไม่สร้าง task ต่อ batch
- task sort deterministic และไม่มีการ merge ชื่อซ้ำ
- status/skip reason transitions
- manual soft-delete rules

### 16.2 Schema and integrity tests

- scope/product check
- active Cycle และ Product Template uniqueness
- owner-scoped foreign keys และ cross-owner rejection
- Cycle Task lineage constraints
- Task Generation trigger ปฏิเสธ generation, primary delivery date หรือ timezone ที่ไม่ตรง Planning Snapshot
- manual request id uniqueness
- historical task mutation rejection
- RLS enabled และไม่มี unintended Data API policies
- migration SQL ตรงกับ Drizzle schema

### 16.3 Application tests

- lock blocker ระบุสินค้าที่ขาด Template ครบ
- Template activity changes เปลี่ยน fingerprint
- lock สร้าง Planning Snapshot, Task Generation และ Tasks ทั้งชุด
- failure ระหว่าง task insert rollback ทุกอย่าง
- retry lock request ไม่สร้างงานซ้ำ
- task edit เปลี่ยนเฉพาะ Cycle Task ไม่เปลี่ยน Template หรือ source lineage
- manual create idempotent
- unlock ทำให้ task generation เดิม read-only
- re-lock สร้าง generation ใหม่โดยไม่คัดลอก manual tasks หรือ task edits

### 16.4 Component and E2E tests

- Template list/editor ใช้งานได้บน desktop และ phone viewport
- blocker link พาไปแก้ Product Template ที่ขาด
- flow: สร้าง Template → วางแผนสินค้า → lock → เห็น task ครบ
- แก้ title/product/batch/schedule/duration/notes/status โดยไม่ unlock
- เพิ่มและลบ manual `PENDING` task
- `SKIPPED` บังคับเหตุผล
- unlock → re-lock → generation เก่าอ่านอย่างเดียวและ generation ใหม่ใช้ Template/plan ล่าสุด
- legacy generation แสดง empty state ที่ถูกต้อง

ก่อนปิด Phase 4A ต้องรัน lint, typecheck, unit/component tests, schema integrity tests และ relevant Playwright suites โดยไม่ทำให้ Phase 1–3 regressions ล้มเหลว

## 17. Acceptance Criteria

Phase 4A ผ่านเมื่อ:

1. เจ้าของสร้างและเปิดใช้ Cycle/Product Templates พร้อมกิจกรรมได้
2. สินค้าทุกตัวต้องมี Product Template พร้อมใช้ก่อน lock
3. lock สร้าง Planning Snapshot และ dated Cycle Tasks แบบ atomic และ idempotent
4. งาน Product แสดง batch count ที่เลือกไว้และไม่แตกหนึ่งงานต่อ batch
5. generated tasks เป็น snapshot และแก้ business fields ได้โดยไม่เปลี่ยน Template
6. เจ้าของเพิ่ม manual task และใช้ `PENDING | IN_PROGRESS | DONE | SKIPPED` ได้โดยไม่ unlock
7. `SKIPPED` ต้องมีเหตุผล และ generated task ลบไม่ได้
8. unlock/re-lock สร้าง generation ใหม่และเก็บชุดเก่าอ่านอย่างเดียว
9. current และ history views ใช้งานบน phone ได้โดยไม่พึ่ง dense table
10. owner scope, RLS, database integrity, concurrency และ automated tests ครบตามสเปกนี้

## 18. Phase 4B Handoff

Phase 4B จะใช้ current Cycle Task Generation จาก Phase 4A เป็นแกนของหน้าปฏิบัติงานบนมือถือ แล้วเพิ่มหรือเชื่อมสถานะ production, packing, payment และ delivery ที่เปลี่ยนได้โดยไม่ unlock

Phase 4B ต้องไม่เปลี่ยน Template snapshot semantics, generation history หรือการแก้ Task ที่กำหนดใน Phase 4A เว้นแต่มี design review ใหม่
