# Day Off Dough OS — Phase 5A Consumption Design

- วันที่: 2026-10-24 (Asia/Bangkok)
- สถานะ: **เจ้าของร้านอนุมัติเอกสารแล้วเมื่อ 2026-10-24; ขั้นถัดไปเขียน implementation plan และให้ตรวจแผนก่อนเริ่ม implementation**
- ฐานโค้ด: `main` ที่ `d1e13f0217708f1dadc1a11e61c7451ddae15778` (Phase 4B รวมแล้ว)
- เอกสารอ้างอิง: MVP design, delivery roadmap, Phase 3A/3B/4A/4B designs ในโฟลเดอร์นี้

## 1. Intent และสิ่งที่เจ้าของร้านตัดสินใจแล้ว

ร้านมีเจ้าของใช้คนเดียว ผลิตตามยอดพรีออร์เดอร์ เช็กของเมื่อทราบยอดแล้ว ซื้อเติมเมื่อไม่พอ ไม่ตุนมาก และปัจจุบันไม่ได้บันทึกจำนวนใช้จริงหลังผลิต

Phase 5A ต้องช่วยปิดยอดใช้ของแต่ละรอบโดยไม่บังคับชั่งของทุกครั้ง ยอดคงเหลือระหว่างการนับเป็นยอดตามการบันทึก ไม่รับรองว่าเท่าของจริงเสมอ

| เรื่อง | คำตอบที่ได้รับจากเจ้าของร้าน |
| --- | --- |
| หลายรอบคาบเกี่ยว | ไม่มี ไม่เพิ่ม reservation หรือการจัดคิวการผลิตร่วมกัน |
| เวลาใช้ของ | ยืนยันหลังผลิตเสร็จ แยกจากการส่งครบหรือกดจบรอบ |
| ค่าเริ่มต้น | ใช้ยอดตามแผนสูตรของรอบ แก้ยอดเฉพาะกรณีที่ต่างได้ |
| การตัด | ต้องยืนยันเองก่อนหัก ห้ามสต็อกติดลบ; ถ้าไม่พอต้องบันทึกซื้อหรือแก้ยอดนับให้ถูกก่อน |
| การนับใหม่ | เคลียร์ยอดใช้ของรอบเก่าที่เกี่ยวข้องก่อนนับรอบใหม่ |
| การแก้หลังยืนยัน | มีเหตุผลและประวัติ; ถ้านับรอบใหม่แล้วไม่คืน/หักยอดเก่าย้อนหลังอัตโนมัติ ให้ปรับจากยอดปัจจุบัน |
| ยกเลิกหลังใช้ของ | บันทึกเฉพาะจำนวนที่ใช้ไปจริง |
| นอกแผน | ยังไม่เพิ่มรายการที่อยู่นอกแผนในรุ่นนี้ |
| รอบเก่า | ไม่ตัดย้อนหลัง เริ่มเฉพาะรอบใหม่หลังเปิดฟีเจอร์ |

ข้อในหัวข้อ “ข้อเสนอของผู้ออกแบบ” ด้านล่างเป็นรายละเอียดที่ผู้พัฒนาเสนอเพื่อให้คำตอบเหล่านี้ทำงานได้ ไม่ใช่การอ้างว่าเจ้าของร้านเลือกโครงสร้างฐานข้อมูลหรือกติกาที่ยังไม่ได้เห็น

## 2. Approaches และขนาดงาน

1. **ใช้แผนเป็นค่าเริ่มต้น + เจ้าของยืนยัน/แก้ข้อยกเว้น — แนวทางที่เจ้าของร้านเลือก** งานบันทึกน้อย แต่ปริมาณที่ไม่ได้ตรวจจริงต้องติดป้ายตามแผน/ประมาณการ และใช้นับจริงรอบถัดไปปรับความคลาดเคลื่อน
2. ชั่ง/นับเพื่อหาการใช้จริงทุกรอบ: ได้ข้อมูลจริงมากขึ้น แต่เพิ่มงานที่ร้านไม่ได้ทำอยู่ จึงไม่ใช้เป็นขั้นตอนบังคับ
3. ใช้เฉพาะการนับใหม่โดยไม่บันทึกการใช้รายรอบ: เรียบง่าย แต่ไม่บรรลุ consumption/history gate ของ roadmap จึงไม่ใช้แทน Phase 5A

นี่เป็นงานขนาดโครงการ ต้องมี design และ implementation plan แยกกัน หลัง builder check ประเมินประมาณ 12–14 งานหลัก จากเดิม 10–12 งาน เพราะต้องครอบ count barrier และทางเคลียร์กรณีนับของเหลือหลังผลิตด้วย จำนวนงานจริงให้แตกใน implementation plan ไม่ประเมินชั่วโมง/token แบบรับประกัน

### ขอบเขตงานสำหรับประเมิน (ยังไม่ใช่ implementation plan)

1. กำหนดรอบเก่า/รอบใหม่และ migration ที่ไม่เปลี่ยนยอดเก่า
2. รวมรายการใช้จากแผนเดิม ตรวจจำนวน หน่วย และแหล่งที่มาของข้อมูล
3. เก็บยอดใช้ ประวัติแก้ และหลักฐานการกดซ้ำโดยไม่หักซ้ำ
4. เก็บลำดับการนับของใหม่และป้องกันแก้ทับประวัติ stock
5. เชื่อมการเริ่มผลิต จบรอบ และปลดล็อกแผน
6. ยืนยันยอดใช้ปกติ และกรณียกเลิกหลังใช้ของ
7. แก้ยอดใช้พร้อมเหตุผลและกฎก่อน/หลังนับของใหม่
8. ป้องกันการนับใหม่ทุกช่องทางขณะที่ยอดใช้เกี่ยวข้องยังค้าง
9. เคลียร์ยอดค้างด้วยการนับของเหลือเฉพาะรายการที่เลือก
10. ข้อมูลหน้าจอ การตรวจสิทธิ์ และข้อความผิดพลาดที่ปลอดภัย
11. หน้ายืนยัน/แก้/ประวัติ/การนับเคลียร์ยอด รองรับมือถือ
12. ตรวจ migration, การเขียนพร้อมกัน, เส้นทางใช้งานจริง และ regression ของระบบเดิม

งานที่ 9 และ 11 อาจแยกเพิ่มเป็น 14 งานตามขนาดจริง; ทุกงานต้องมี focused tests/TDD ของตัวเอง ไม่รอทดสอบทั้งหมดในงานสุดท้าย Final cost/กำไรและ CSV ไม่รวมในจำนวนนี้

## 3. Goals, non-goals และ anti-goals

### Goals

- ยอดใช้ ingredient/packaging/consumable จาก active immutable Planning Snapshot เดียวกับรอบ
- ยืนยันใช้หลังผลิตโดยไม่เปลี่ยน Task, Order, Packing, Payment หรือ Cycle status อัตโนมัติ
- บันทึกใช้จริงเมื่อเจ้าของแก้/ยืนยันว่าเป็นข้อมูลจริง พร้อมเหตุผลเมื่อเปลี่ยนจากแผน
- Ledger และประวัติการแก้ตรวจย้อนหลังได้ กดซ้ำไม่หักซ้ำ ทุก batch สำเร็จทั้งหมดหรือ rollback ทั้งหมด
- ป้องกัน COUNT ที่ทำให้หักการใช้รอบเก่าซ้ำ และแก้กรณี count/consumption ส่งพร้อมกันได้อย่างปลอดภัย
- รอบยกเลิกบันทึกใช้ไปแล้วได้ โดยไม่คืนสต็อกเพียงเพราะเปลี่ยนสถานะ
- เก็บ provenance เพียงพอให้ Phase 5B ใช้จำนวน/แหล่งข้อมูลได้โดยไม่เขียนประวัติใหม่

### Non-goals

- Final cost snapshot, การเลือก actual-price valuation, รายงานกำไร, CSV และ backup/restore UI อยู่ Phase 5B/5C
- ไม่เพิ่มรายการนอกแผน, waste ledger แยก, lot/FIFO/expiry, inventory reservation, multi-user หรือ offline sync
- ไม่เปลี่ยนราคา/สูตร/Planning Snapshot/Task Generation เก่าย้อนหลัง ไม่คำนวณแผนใหม่จาก master data
- ไม่ใช่การ deploy, push หรืออนุญาต migration บนฐานร้านจริง

### Anti-goals

- ไม่อ้างว่า quantity ตามสูตรเป็น actual เพียงเพราะกดยืนยัน
- ไม่หักทั้งหมดที่ซื้อ; ของซื้อเกินยังอยู่ใน stock balance
- ไม่หักตามจำนวนออเดอร์/แพ็กซ้ำ เพราะสูตรรวม batch rounding และ waste buffer แล้ว
- ไม่ใช้ COUNT ของเหลือหลังผลิตเป็นยอดก่อนใช้แล้วหักสูตรอีกครั้ง
- ไม่แก้ทับ/ลบ movement หรือ revision เก่า ไม่แก้ timestamps เพื่อทำให้ยอดดูถูก

## 4. Current code และขอบเขตที่ต้องเชื่อม

- `inventoryMovements` มี `COUNT | PURCHASE | CONSUMPTION | CORRECTION` อยู่แล้ว แต่ application ปัจจุบันสร้าง COUNT/PURCHASE เท่านั้น ยอดมาจาก SUM ของ quantity delta
- `inventory.recordCount` ล็อก Inventory Item ก่อนคำนวณ COUNT delta; `confirmCycleStock` และ `recordCyclePurchase` ล็อก Cycle ก่อน Inventory Items
- `cycleInventoryCounts`/Shopping ของแต่ละ generation immutable; terminal Cycles อ่านอย่างเดียว ห้ามแก้กติกานี้เพื่อบันทึกซื้อย้อนหลังเงียบ ๆ
- `loadShoppingSource` รวม material/packaging จาก snapshot ได้อยู่แล้ว ให้ reuse pure aggregation/source logic ไม่ duplicate calculation ทั้งก้อน
- Operations start/complete ล็อก Cycle/current generation; complete ปัจจุบันตรวจ Tasks/Delivery แต่ยังไม่เขียน consumption
- Generic Cycle service ปฏิเสธการเริ่ม/จบรอบที่ต้องผ่าน Operations แต่ยังยกเลิกรอบได้ รวมถึงจาก IN_PRODUCTION
- Physical COUNT ที่ inventory detail และ COUNT ของรอบต้องใช้ guard เดียวกัน ไม่ป้องกันเพียงหน้าจอใหม่

## 5. ข้อเสนอของผู้ออกแบบ: eligibility และ lifecycle

### 5.1 Cutover โดยไม่เดาจากวันที่ย้อนหลัง

เพิ่ม policy ที่ Cycle แบบ immutable: รอบที่มีอยู่ตอน migration เป็น `LEGACY`; รอบที่สร้างใหม่เป็น `CONSUMPTION_V1` จาก server/DB default Browser กำหนด policy หรือ opt out เองไม่ได้

- Migration เปลี่ยนเฉพาะ metadata ของรอบเดิม ไม่สร้าง CONSUMPTION/COUNT/CORRECTION ให้รอบเก่า
- LEGACY รวมถึงรอบเดิมที่ยัง OPEN/LOCKED/IN_PRODUCTION: ใช้ lifecycle เดิม และไม่มีการหักย้อนหลังอัตโนมัติ
- ไม่ใช้ `occurredAt`, `createdAt` หรือวันที่ส่งเป็นตัวอนุมานว่าหักของไปแล้วหรือยัง
- New policy ไม่ถูกล้างเมื่อแก้ Cycle metadata/re-lock; context ของการใช้ผูกกับ Planning Snapshot/generation จริง

### 5.2 Pending-use context

เมื่อเริ่มรอบ `CONSUMPTION_V1` เข้า IN_PRODUCTION ให้สร้าง context และ exact set ของรายการจาก active Planning Snapshot ใน transaction เดียวกันกับการเริ่มรอบ รายการนี้คือขอบเขตการเคลียร์ยอดใช้ ไม่ใช่การจอง stock

**ข้อเสนอเพิ่มเติม:** รอบ V1 ต้องยืนยัน initial stock check ของ generation ปัจจุบันก่อนเริ่มผลิต (ถ้าไม่มี required item ถือว่าไม่มีรายการต้องนับ) ตรงกับพฤติกรรมเช็กของก่อนผลิตของร้าน และทำให้ไม่นับของตั้งต้นหลังสร้าง pending-use โดยไม่ตั้งใจ

- เริ่มซ้ำด้วย current context เดิมไม่สร้างชุดใหม่
- Context ที่ยังไม่เคยยืนยันใช้เป็น `PENDING_USE` และบล็อก ordinary COUNT ของ inventory items ที่เกี่ยวข้อง
- สิทธิ์ยืนยันใช้เริ่มที่ IN_PRODUCTION ไม่ต้องรอ Order DELIVERED หรือ Cycle COMPLETED และไม่อนุมานว่าผลิตเสร็จจาก Task status
- เจ้าของต้องยืนยันว่าของในรายการถูกนำออกใช้แล้ว ถ้ายังไม่ใช้บางรายการรวมถึงบรรจุภัณฑ์ ให้แก้ยอดรายการนั้นตามจริงก่อนยืนยัน; Packing progress ไม่สร้าง movement เอง
- เมื่อมี initial revision ที่ครบทั้งชุด context เป็น `RECORDED` การแก้ครั้งต่อไปเป็น revision ใหม่เท่านั้น
- New V1 complete เพิ่ม guard ว่าบันทึกยอดใช้แล้วก่อนจบรอบ; Tasks/Delivery gates และ unpaid-warning-only เดิมยังอยู่ LEGACY ใช้กฎเดิม

### 5.3 Unlock และ generation history

- PENDING_USE ต้องยืนยันว่าไม่ใช้ของ (ทุกยอดเป็นศูนย์ พร้อมเหตุผล) ก่อน unlock เพื่อไม่ให้การ replan ซ่อนยอดใช้ที่ยังค้าง
- หาก context เคยมี recorded used quantity มากกว่าศูนย์ ไม่อนุญาต unlock แม้ต่อมาแก้กลับศูนย์ เป็นข้อเสนอ conservative เพื่อคง lineage หลังเริ่มใช้ของ การแก้ stock ยังทำได้ตามกฎ correction ไม่ใช่การเปิดแผนใหม่
- กรณีไม่เคยมี positive use และผ่าน guard Operations เดิม อนุญาต unlock; context ของ generation เก่าเป็นประวัติอ่านอย่างเดียว Re-lock/start สร้าง context ของ snapshot ใหม่ ไม่คัดลอกยอดใช้เก่า
- ไม่เปลี่ยน historical Planning/Tasks/Shopping snapshot หรือโยก movement ไป generation ใหม่

### 5.4 CANCELLED และ COMPLETED

- Cancel ก่อนเริ่มผลิต: ไม่สร้างการใช้ตามสูตร ไม่มี context ให้เคลียร์
- Cancel หลังเริ่มผลิต: คง pending context; เจ้าของยังเปิด Consumption เพื่อยืนยันเฉพาะที่ใช้จริงได้ แม้ Cycle เป็น CANCELLED ค่าเริ่มต้นต้องว่าง ไม่เติมเต็มสูตร และต้องตัดสินใจทุกบรรทัด (ศูนย์ใช้ได้)
- ถ้ายืนยันใช้แล้วจึง cancel ไม่มีการคืน stock อัตโนมัติ
- Correction ของ recorded use ยังทำผ่าน Consumption หลัง CANCELLED/COMPLETED ได้ตาม count-fence rules ไม่เปิดแก้ commercial/Task/fulfillment history
- Operations ของ CANCELLED ยังคง read-only ตาม Phase 4B; exception นี้อยู่ใน consumption/stock workflow ไม่คืนสิทธิ์ mutation ให้ Operations เดิม

## 6. Quantities และ source-of-truth

- รวม requirements จาก snapshot ต่อ inventoryItemId ใช้ planned ingredient quantity **ที่รวม waste allowance อยู่แล้ว** และ planned packaging quantity; ไม่บวก waste ซ้ำ
- ไม่ใช้ batch ที่แก้เฉพาะ Task, ราคาใหม่, สูตรใหม่ หรือ Packing quantity มาคำนวณ quantity นี้ใหม่
- แสดงชื่อ/category/base unit ที่ snapshot ไว้ แม้ master item จะถูก deactivate; source item ต้องยังเป็น owned item ที่อ้างอิงได้
- ฟอร์มส่ง exact item set ห้ามขาด/เกิน/ซ้ำ ไม่รับรายการนอกแผน จำนวน non-negative exact decimal สูงสุด 6 ตำแหน่ง อยู่ใน numeric(18,6) และ sum ที่รองรับ ไม่ใช้ float หรือปัดเงียบ
- ทุกบรรทัดมี absolute `usedQuantity` และ basis `PLANNED` หรือ `OWNER_REPORTED` ตามที่เจ้าของยืนยัน ไม่เปลี่ยน basis เพียงเพราะรูปเขียน `1`/`1.000000` ต่างกัน
- Normal initial use เติมค่าตามแผนเป็น PLANNED ถ้าแก้จำนวนต้อง OWNER_REPORTED พร้อมเหตุผล จะยืนยัน actual เท่ากับแผนก็ได้ถ้าเจ้าของระบุเอง
- CANCELLED initial use บังคับ OWNER_REPORTED ไม่ถือว่ายอดซื้อเท่ากับยอดใช้
- อนุญาต zero use พร้อมเหตุผล; initial ชุดว่างต้องมี explicit confirmation ว่าไม่มี required item เพื่อไม่ปล่อย complete ค้างถาวร
- ราคาหายไม่บล็อกการบันทึกปริมาณ; Phase 5A ไม่เขียนราคาหรือต้นทุนเป็นศูนย์ และไม่อ้างว่าได้ final cost แล้ว

## 7. Ledger, COUNT fence และ correction

### 7.1 Logical records (ชื่อ physical ให้ implementation plan กำหนด)

1. Cycle policy marker ตาม cutover
2. Consumption context ต่อ owner/Cycle/Planning Snapshot พร้อม current revision pointer และ source generation identity
3. Context items: exact inventory IDs, copied labels/units/planned quantities และ snapshot lineage
4. Operation receipt: owner-scoped unique request UUID, canonical full-command manifest และ immutable result references ครบทั้ง operation รวมกรณีหลาย context/COUNT; logical grouping นี้อาจรวมกับ revision ได้ในคำสั่ง context เดียว
5. Append-only revisions: initial/correction/count-settlement, owned operation link, expected predecessor, reason, confirmed server time
6. Revision items: absolute recorded use/basis, stock-effect delta/mode, owned movement references และ initial count-fence provenance
7. Per-item ledger metadata: monotonic revision และ latest applied COUNT movement identity; **ไม่เก็บ balance ซ้ำกับ SUM ledger**

Owned composite FKs, owner-scoped unique keys, ON DELETE RESTRICT, RLS โดยไม่มี anonymous policies ต้องครอบทุก record และ movement link

### 7.2 Normal initial confirmation

สำหรับทุก item ภายใต้ locks:

`stockEffect = -usedQuantity`

ถ้า latest balance ไม่พอแม้รายการเดียว ให้ reject ทั้งชุด แสดงรายการ/จำนวนที่ขาด ไม่มี movement, revision หรือ Cycle status เปลี่ยนบางส่วน ห้าม auto top-up, auto purchase หรือ silently clamp

สร้าง CONSUMPTION movement และเก็บ owner/item/revision linkage แม้ usedQuantity เป็นศูนย์ก็มี zero-delta audit row ได้ Quantity ที่ใช้จริงต้องอ่านจาก revision item ไม่อนุมานจาก movement เพียงอย่างเดียว

### 7.3 หลังนับใหม่ ห้ามหักยอดเก่าซ้ำ

Ledger metadata อัปเดตภายใต้ Inventory Item lock สำหรับทุก movement INSERT; ทุก COUNT เปลี่ยน count identity ส่วน PURCHASE/CONSUMPTION/CORRECTION เปลี่ยน ledger revision แต่ไม่เปลี่ยน count identity

- จับ initial count fence ของ item เมื่อ first use ถูกบันทึก และไม่ reset fence นี้เมื่อสร้าง correction
- Bootstrap ledger metadata ของข้อมูลเก่าไม่ต้องเดาลำดับจากเวลาหรือ UUID ให้มี baseline token ที่ชัดเจนและนับ revision จาก cutover
- ใช้ applied sequence/metadata ไม่ใช้ user-entered occurredAt หรือ transaction-createdAt เป็นตัวตัดสินว่ามี COUNT เกิดภายหลัง
- Ledger append-only: write paths ปัจจุบันมีแต่ INSERT; forward guard ปฏิเสธ UPDATE/DELETE ที่จะทำให้ประวัติ/metadata ไม่ตรงกัน การแก้ใช้ movement ใหม่

Correction เป็น absolute replacement target ไม่ใช่การกดเพิ่ม/ลดสะสม:

| กรณีต่อ item | Stock effect ของ correction |
| --- | --- |
| ไม่มี COUNT หลัง first use | `previousUsed - newUsed` ผ่าน CORRECTION movement; ยังคงห้าม balance ติดลบ |
| มี COUNT หลัง first useแล้ว | `0` แบบ HISTORY_ONLY; แก้ประวัติยอดใช้/เหตุผล ไม่คืน/หัก stock เก่า |

ตัวอย่าง: used 100 แก้เป็น 90 ก่อนนับใหม่ จะคืน 10; หากมี COUNT ของเหลือเป็น 25 ไปแล้ว แก้ 100 เป็น 90 ต้องคง balance 25 ไม่เพิ่มเป็น 35 เจ้าของใช้การนับ/ปรับยอดปัจจุบันแยกต่างหากถ้าของจริงไม่ตรง

ถ้าในชุดเดียวบาง item ถูกนับใหม่แล้ว ให้แสดง mode/delta ของแต่ละรายการให้ยืนยันชัดเจน ห้ามเปลี่ยน DIRECT เป็น HISTORY_ONLY เงียบ ๆ เพราะ COUNT ที่มาระหว่าง preview/save ต้องคืน STALE และให้ refresh ก่อน

### 7.4 Pending barrier ของ ordinary COUNT

- Generic inventory.recordCount และ cycle stock confirmation ต้องตรวจ pending-use ที่เกี่ยวข้องทั้งหมดหลังได้ item locks; หากค้างให้ reject ทั้ง COUNT batch พร้อมลิงก์ Cycle ที่ต้องเคลียร์
- บล็อกเฉพาะ items ที่เกี่ยวข้องกับ pending use ไม่บล็อกการนับ item อื่นหรือรอบ LEGACY
- PURCHASE ยังบันทึกได้ตาม lifecycle เดิม ไม่ถือเป็น COUNT และไม่ปลด pending barrier
- ไม่มีการถือ item lock แล้วค่อยไปขอ Cycle lock: อ่าน pending เพื่อแจ้ง blocker ได้ แต่ถ้าต้อง mutate หลาย Cycle ต้องหา candidate ก่อน แล้วกลับมาล็อก Cycle IDs ที่ sort ก่อน item locks และ recheck exact set

### 7.5 ข้อเสนอทางเทคนิค: นับของเหลือหลังผลิตเพื่อเคลียร์ยอดค้าง

จำเป็นต้องมีทางแก้กรณีเจ้าของผลิตไปแล้ว พบว่ายอดก่อนใช้ใน ledger ไม่พอ และไม่มี purchase ที่ถูกต้องให้บันทึกผ่าน Shopping (เช่นไม่มี shortfall row หรือ Cycle ยกเลิกแล้ว) ห้ามให้ใส่ “ยอดของเหลือ” ลง ordinary COUNT แล้วหักสูตรซ้ำ

เสนอ explicit **count-backed settlement** ใน Consumption/Stock:

- **ข้อเสนอของผู้ออกแบบหลัง builder check:** เลือก counted item IDs เป็น subset ที่ไม่ว่างและไม่ซ้ำ ไม่บังคับชั่ง/นับทุก item ของทั้งรอบ เพื่อคงภาระงานต่ำตามแนวทางที่ร้านเลือก
- เจ้าของยืนยัน usedQuantity/basis ของ **ทุก item ในทุก context ที่ต้องเคลียร์** ตาม exact set ของ context และกรอก physical quantity ที่เหลือ **หลังการใช้เหล่านั้น** พร้อมเหตุผลสำหรับทุก counted item; ขาดยอดนับของ selected item ใดให้ reject
- ชุดนี้ต้องเคลียร์ pending contexts ทั้งหมดที่เกี่ยวข้องกับ **counted items** แบบ exact set ใน transaction เดียว แม้ปกติร้านไม่มีรอบซ้อน ให้ discover candidate contexts ก่อนล็อก Cycle และ recheck exact pending set ของ counted items หลังได้ item locks; stale/incomplete set ให้ reject/retry ไม่เพิ่มรอบใหม่เข้า command เงียบ ๆ
- เฉพาะ revision items ที่อยู่ใน counted subset ใช้ mode COUNT_SETTLED และ CONSUMPTION audit movement delta **0** เพราะผลต่อ stock จะถูกสะท้อนด้วย COUNT แทน ไม่ใช่การอ้างว่าใช้ของเป็นศูนย์
- สร้าง COUNT movement ของ counted items จาก current ledger balance ไป physical remaining ที่เจ้าของกรอก (non-negative) เก็บ owned links ระหว่าง revision/COUNT/zero-delta consumption
- Items อื่นใน affected contexts ที่ไม่ได้เลือกนับต้องบันทึกใน initial revision เดียวกันด้วย mode DIRECT และ delta `-usedQuantity` ตามกฎ normal use รวม no-negative validation; ไม่ให้ zero stock effect เพียงเพราะใช้ form settlement
- ล็อก inventory items ทั้ง counted subset และ uncounted items ของ affected contexts ทุกตัว หาก DIRECT item ใดมี stock ไม่พอ ให้ rollback ทั้ง usage/COUNT/receipt ไม่สำเร็จเพียงบางรายการ เจ้าของเพิ่มรายการนั้นเข้า counted subset แล้ว refresh preview ได้
- ไม่ขยายชุดแบบ recursive ไปทุก context ที่แชร์เฉพาะ uncounted DIRECT item: context เหล่านั้นยัง pending และบล็อก COUNT ของ item นั้นตามเดิม เพราะ command นี้ไม่ได้นับ item นั้น
- ไม่แก้ immutable initial cycleInventoryCounts/Shopping ของ generation เก่า ไม่สร้าง purchase/price ปลอม และไม่คำนวณจำนวนใช้จริงจากผลต่างการนับเอง
- ลงทั้งชุดหรือไม่ลงเลย ผลสุดท้ายของ counted item ต้องเท่าของเหลือที่กรอก ไม่ใช่ physicalRemaining - usedQuantity ส่วน uncounted item เท่ากับ balance ก่อน command ลบยอด DIRECT ที่ใช้
- COUNT นี้ถือว่ามาหลัง first use ดังนั้น correction ของ counted items ภายหลังเป็น HISTORY_ONLY โดยธรรมชาติ; uncounted DIRECT items ยังคงใช้ initial count fence ของตัวเองตาม §7.3
- เป็นการยืนยันเคลียร์ยอดเก่าพร้อมปรับยอดนับในธุรกรรมเดียว ไม่ใช่ปุ่มข้าม shortage หรือ COUNT guard ทั่วไป; ordinary COUNT ที่ไม่มีการยืนยันนี้ยังถูกบล็อก

ตัวอย่าง: รอบใช้แป้งและกล่อง แต่ต้องแก้ยอดแป้งหลังผลิตเท่านั้น เจ้าของกรอกยอดใช้ครบทั้งแป้ง/กล่อง และนับแป้งที่เหลือ แป้งลง COUNT_SETTLED + COUNT ของเหลือ ส่วนกล่องหัก DIRECT ตามจำนวนใช้ ทั้งสองส่วนต้องสำเร็จพร้อมกัน Preview ต้องแสดงแต่ละ mode/delta ชัดเจนก่อนยืนยัน

นี่เป็นการตีความของผู้ออกแบบเพื่อให้ “แก้ยอดนับก่อนยืนยัน” ทำงานถูกเมื่อร้านไม่ได้เก็บยอดก่อนใช้ เจ้าของต้องเห็นและอนุมัติใน design นี้ก่อน implement

## 8. Commands, idempotency และ concurrency

### Read model

ต่อ Cycle แสดง LEGACY/NO_PLAN/NOT_STARTED/PENDING_USE/RECORDED/HISTORY พร้อม immutable source, current revision/history, current stock, count-fence และ opaque expected ledger tokens สำหรับ preview ข้อมูล owner อื่นไม่เปิดเผย

### Commands เชิงธุรกิจ

- Confirm normal use: full item set, basis/quantity/reasons, current source identity, request UUID และ expected revision/ledger tokens
- Correct recorded use: full absolute target, expected current revision และ reason; explicit per-item DIRECT/HISTORY_ONLY preview
- Settle pending use with physical count: explicit nonempty counted subset, exact pending Cycle/context set สำหรับ counted items, full used quantities/bases ของทุก affected context และ physical remaining ครบ counted subset; preview COUNT_SETTLED/DIRECT ของแต่ละ item
- Current physical count: ใช้ existing stock path และ guard ร่วม ไม่ derive current adjustment จากการแก้เลขรอบเก่า

### Binding contracts

- ทุก action เรียก requireOwner ภายใน ก่อนอ่าน/เขียน Browser ไม่มี authority กำหนด owner/policy/fence/movement delta
- Unknown และ cross-owner IDs คืน safe error kind/message เดียวกัน
- ปริมาณ/decimal payload canonical เชิงค่า จัด Cycle/context/item IDs ให้ลำดับคงที่ ตรวจ full-payload idempotency รวม basis, reason, source, expected tokens, counted subset และ count values ตาม intent ไม่เปรียบเทียบ numeric text ตรง ๆ
- หนึ่ง request UUID ผูกกับ operation ทั้งชุดภายใต้ owner ไม่ใช่นำ UUID เดียวไปใช้เป็น request อิสระต่อ context; receipt/result ต้องครอบทุก revision/COUNT ของ settlement
- ตรวจ existing owned request หลังล็อก owned Cycles ที่อยู่ใน submitted manifest แต่ก่อน lifecycle/stale/pending-discovery gates: exact retry คืนผล operation เดิมแม้ Cycle terminal หรือมี COUNT/การแก้ภายหลัง ไม่หักซ้ำ เปลี่ยน payload ด้วย request เดิมต้อง reject
- Idempotent response อ้าง immutable revisions/COUNT results ที่เคยบันทึก ไม่อ้างว่าเป็น latest current revision ถ้ามีคนแก้ต่อแล้ว
- App locks: Cycle IDs sorted → current source snapshots/contexts → Inventory Items sorted → ledger metadata/context revision rows → INSERT movements/links; commands ที่ไม่แตะ Cycle ใช้ item-first ได้แต่ห้ามขอ Cycle ภายหลัง
- Recompute balance, pending sets, exact source membership, count fences และ predecessor ภายใน transaction; ไม่เชื่อยอด preview จาก client
- ทุก write ทั้ง batch atomic รวม forced rollback และ constraint failure; ไม่มี partial revision/current-pointer/movement/count settlement
- SQL backstops ต้องครอบ new policy lifecycle/pending context, authoritative COUNT barrier, owner/source links, append-only events และ protected current revision links ไม่พึ่ง disabled UI
- Direct-SQL guards ห้ามสร้าง inverted blocking wait หลัง implicit tuple locks; อนุญาต stable retryable rejection เช่น lock contention ตามแนว Phase 4B ให้ระบุ protocol และพิสูจน์ด้วย real PostgreSQL
- ไม่อ้างว่าป้องกัน arbitrary privileged SQL corruption ทุกชนิด หรือเพิ่ม unrelated hardening

## 9. Presentation และผลต่อหน้าที่มีอยู่

- เสนอ dedicated Consumption ของ Cycle พร้อม entry จาก Cycle detail/Operations/Stock ที่เกี่ยวข้อง ไม่รวมประวัติหลาย Cycle เป็น form เดียวปกติ
- แสดง “ตามแผนที่ล็อก/ประมาณการ” กับ “เจ้าของบันทึกใช้จริง” แยกจาก stock balance/stock effect ชัดเจน
- แสดงค่าเดิม ค่าใหม่ ผลต่อ balance และเหตุผล โดยเฉพาะ HISTORY_ONLY/COUNT_SETTLED ห้ามข้อความสำเร็จทำให้เข้าใจว่าหัก stock ทั้งที่ delta เป็นศูนย์
- CANCELLED form ไม่มี prefilled planned use; การยืนยัน zero use ต้องตั้งใจและอธิบายได้
- COUNT blocker บอก Cycle ที่ต้องเคลียร์และทางไป Consumption; HISTORY_ONLY บอกทางไปนับของปัจจุบัน ไม่แก้ค่าที่ช่องเก่าแล้วหักย้อนหลังให้เอง
- Confirmation ไม่ผูกกับ fulfillment; ไม่มี stock movement เมื่อกด Task done, PACKED, DELIVERED หรือเมื่อใช้ template
- ใช้ useActionState pending/errors เก็บค่าที่กรอกเมื่อบันทึกล้มเหลว ปุ่ม disabled ระหว่าง submit ไม่มี optimistic success และ rotate request ID ทุก intent ที่สำเร็จ
- มือถือไม่ใช้ dense table เป็นทางเดียว ทุก native input/select/grid ต้องอยู่ใน viewport แม้ label ยาว รวม intermediate edit/error/dialog states
- รูปแบบ layout และชื่อเส้นทางจริงให้ builder เลือกจาก component conventions เดิม; ไม่เพิ่ม dependency เพื่อ UI นี้

## 10. Migration, compatibility และ release safety

- Forward migration ใหม่เท่านั้น ไม่แก้ applied 0001–0013 หรือ backfill ledger ของรอบเก่า
- เพิ่ม eligibility metadata ก่อนเปิด trigger default สำหรับรอบใหม่อย่างชัดเจน พร้อมตรวจทั้ง existing/new rows ไม่มี window ให้รอบเดิมถูกหักเงียบ ๆ
- ทดสอบ migration บน fresh database และ upgrade fixture ที่มี counts/purchases/terminal Cycles โดยไม่ทำให้ sum balance/ประวัติเก่าเปลี่ยน
- ตรวจ RLS/no policies/owned FK/restrict/checks/append-only/guard lifecycle จริง ไม่ตรวจเฉพาะข้อความใน SQL
- ใช้ isolated local PostgreSQL สำหรับ migration/concurrency/E2E และ existing Supabase Auth สำหรับ login เท่านั้น ไม่คัดลอกหรือพิมพ์ credentials
- Applying migration บนฐานร้านจริง, merge, push และ deployment ต้องมีสิทธิ์แยกตาม workflow ไม่รวมใน approval ของ design
- รักษา refund/restore, payment หลัง complete, task history, snapshot fingerprints และ Shopping purchase lifecycle เดิม

## 11. Acceptance และหลักฐานที่ต้องมี

TDD คู่กับทุกงาน; final verification ไม่แทน focused RED/GREEN

1. รวม snapshot requirements ได้ถูก รวม batch/waste/packaging หนึ่งครั้ง ไม่ใช้ master/Task ใหม่
2. Normal use หักเพียงยอดที่ยืนยัน ซื้อเกินยังเหลือ จำนวนไม่พอแม้ item เดียวไม่เขียนอะไรเลย
3. Canonical exact retry (`1` เทียบ numeric scale), double-click, concurrent same-intent และ changed-payload rejection ถูกต้อง
4. ทดสอบใช้จริง/ตามแผน/zero/missing cost/deactivated source item/full-set validation และ numeric boundary
5. เริ่มรอบ V1 สร้าง pending context atomic; stock check ก่อนเริ่ม; start retry/complete guards/zero-use unlock/history ถูกต้อง; LEGACY ไม่ถูกเปลี่ยนพฤติกรรม
6. Cancel หลังเริ่มไม่คืนของ; pending cancelled บันทึก OWNER_REPORTED ใช้จริงหรือศูนย์ได้; Operations CANCELLED ยัง read-only
7. Ordinary COUNT ทุก entry point ถูกบล็อกเฉพาะ pending items และปลดได้เมื่อเคลียร์ ไม่มี partial count; item อื่นยังนับได้
8. COUNT-backed settlement เลือกนับเฉพาะ subset ได้: full affected-context usage, COUNT_SETTLED + zero consumption + actual remaining COUNT เฉพาะ counted items และ DIRECT/no-negative สำหรับรายการอื่น ทั้งหมด atomic; ทดสอบ missing/duplicate counted items, exact pending-set race, uncounted shortage rollback และ full-operation retry ไม่สร้าง opening stock/purchase ปลอม ไม่หัก remaining ซ้ำ ไม่เปลี่ยน cycle count snapshot เก่า
9. Correction ก่อน COUNT ปรับเฉพาะส่วนต่าง; หลัง COUNT แก้ history แต่ stock คงเดิม; mixed-item set และ COUNT ระหว่าง preview/save ต้องไม่แอบเปลี่ยน mode
10. Independent PostgreSQL writers/observer: use vs use, use vs COUNT, correction vs COUNT, purchase vs use และ begin-production/pending registration vs COUNT ต้องมี deterministic wait/reject/atomicity proof ไม่ใช้ PGlite แทนหลาย connection
11. SQL trigger/constraints ป้องกัน direct writes ที่ละเมิดสัญญาในขอบเขตนี้ รวม append-only และ owned references; preserve Phase 4B race regressions
12. Unknown/cross-owner exact same safe kind/message; source/predecessor/fence tampering ไม่เขียนข้อมูล
13. Authenticated phone/desktop flow: preorder stock check → purchase → production → confirm use → deliver/complete → new count → historical correction โดย stock ไม่ถูกหักซ้ำ; cancelled-use และ count-settlement focused flows
14. Full unit/typecheck/lint/build/relevant E2E พร้อมรายงาน warnings เดิมตามจริง และ local resources/fixtures cleanup; no actual-shop migration claim

## 12. สิ่งที่เหลือให้ builder เลือก และสิ่งที่ไม่ถือว่าผู้ใช้อนุมัติแล้ว

- Builder เลือก module/file names, physical table/constraint/function names, UI layout และ exact SQL implementation ภายใต้ contracts ข้างต้น
- ต้องออกแบบ lock/recheck protocol และ durable count-fence/ledger metadata ให้พิสูจน์ได้; ห้ามแทนด้วย timestamp guess, UI-only checks หรือ duplicate balance ที่ไม่เป็น source of truth
- หาก count-backed settlement หรือ lifecycle rules นี้เปลี่ยนขอบเขตงาน materially ให้แจ้งก่อน implement ไม่ลด acceptance เพื่อให้ขนาดดูเล็กลง
- ข้อเสนอหลักที่ต้องให้เจ้าของเห็นตอนอนุมัติ: stock check ก่อนเริ่มผลิต, pending/zero-use unlock, recorded-use gate ก่อน complete, HISTORY_ONLY หลัง COUNT, count-backed settlement กรณีนับหลังผลิต และการไม่เปิดย้อนหลังให้ LEGACY
- Builder check พบคำถามเรื่องต้องนับครบทั้ง context หรือเลือกเฉพาะบาง item: ผู้ออกแบบเสนอ selective COUNT_SETTLED + DIRECT รายการที่เหลือใน §7.5 โดยอิงเจตนาลดงานบันทึกของร้าน ข้อนี้ยังเป็นข้อเสนอให้เจ้าของตรวจ ไม่ใช่การอ้างว่าเจ้าของตอบรายละเอียดนี้แล้ว
- ไม่มีคำถามธุรกิจเพิ่มเติมที่จำเป็นก่อนส่งเอกสาร; หากเจ้าของไม่เห็นด้วยกับข้อเสนอใดให้แก้ design ก่อนวางแผน implementation
- หลังเจ้าของอนุมัติเอกสารนี้จึงเขียน implementation plan; ยังไม่เริ่ม implementation จากการเห็นชอบแนวคิดหรือคำตอบ 7 ข้อเพียงอย่างเดียว
