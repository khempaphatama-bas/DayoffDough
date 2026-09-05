# Day Off Dough OS — Phase 3B Inventory Count and Shopping Design

**วันที่:** 2026-09-05

**สถานะ:** รออนุมัติ specification

**ฐานที่ใช้:** Phase 3A immutable planning generations ที่ commit `4400e22`

**ขอบเขตผู้ใช้:** เจ้าของร้านหนึ่งคน

## 1. เป้าหมาย

เพิ่มขั้นตอนหลังล็อก Bake Cycle ให้เจ้าของร้านตอบได้อย่างเชื่อถือได้ว่า:

1. Planning Generation ที่ใช้งานอยู่ต้องใช้วัตถุดิบและบรรจุภัณฑ์อะไรเท่าไร
2. ตอนตรวจรอบนี้นับของจริงได้เท่าไร
3. ขาดเท่าไรและควรซื้อกี่แพ็ก
4. ซื้อจริงไปแล้วกี่แพ็ก ราคาเท่าไร และยังขาดหรือซื้อเกินเท่าไร
5. การซื้อแต่ละครั้งเพิ่ม stock balance และ price history อย่างไร

Phase 3B ต้องใช้ requirement จาก active Phase 3A snapshot โดยตรง ห้ามคำนวณใหม่จากสูตร กฎบรรจุภัณฑ์ ราคา หรือออเดอร์ที่แก้ไขได้ในปัจจุบัน

## 2. การตัดสินใจที่อนุมัติแล้ว

- เจ้าของร้านตรวจยอดคงเหลือล่าสุดและยืนยันหรือแก้เป็นจำนวนที่นับจริงในแต่ละ Bake Cycle
- สูตรของขาดไม่เผื่อ `minimumStockQuantity`: `max(required - counted, 0)`
- เมื่อซื้อจริง เจ้าของร้านกรอกจำนวนแพ็ก ราคารวม ร้านที่ซื้อ เวลา และหมายเหตุ
- การซื้อสร้างทั้ง `PURCHASE` inventory movement และ inventory price history
- Shopping item เดียวรองรับการซื้อบางส่วนหลายครั้ง
- ถ้า re-lock เป็น Planning Generation ใหม่ ข้อมูลนับและ shopping รุ่นเก่าเป็นประวัติอ่านอย่างเดียว การซื้อที่เกิดขึ้นแล้วยังคงอยู่ใน global stock ledger
- จำนวนซื้อจริงกรอกเป็นจำนวนแพ็กจำนวนเต็มบวก และใช้ขนาดแพ็กที่ snapshot ตอนยืนยันสต๊อก
- ต้องยืนยันยอดครบทุก required inventory item ใน transaction เดียวก่อนสร้าง Shopping List
- หน้านับแสดงเฉพาะวัตถุดิบและบรรจุภัณฑ์ที่ Planning Generation นั้นต้องใช้
- หน้าเช็กสต๊อกและ Shopping List เข้าจาก Bake Cycle/หน้าแผนการผลิตของรอบโดยตรง
- ซื้อเกินได้ ปริมาณทั้งหมดเพิ่มเข้าสต๊อก และ UI แสดงยอดเกินอย่างชัดเจน

## 3. ขอบเขตที่ทำ

- รวม material และ packaging requirements ของ Planning Generation ตาม `inventoryItemId`
- แสดง stock balance ปัจจุบันเพื่อช่วยนับ แต่ใช้ยอดที่เจ้าของร้านยืนยันเป็นฐานคำนวณของขาด
- reconcile global stock ledger ด้วย `COUNT` movements
- สร้าง immutable cycle inventory counts และ Shopping List ต่อ generation
- คำนวณ non-negative shortfall และ suggested integer pack count
- บันทึก partial/multiple/over purchases แบบ append-only
- เพิ่ม `PURCHASE` movements และ price history แบบ atomic กับ purchase entry
- แสดงประวัติ stock check, shopping และ purchases ของ generation เก่าแบบ read-only
- รองรับ phone และ desktop

## 4. สิ่งที่ไม่ทำ

- ไม่บวก minimum stock เข้า quantity to buy
- ไม่รวม `CONSUMABLE` ที่ไม่มี material/packaging requirement ในรอบ
- ไม่รวม Shopping List จากหลาย Bake Cycles
- ไม่ reserve stock ข้ามหลายรอบ
- ไม่ตัดสต๊อกตาม planned หรือ actual consumption
- ไม่บันทึก actual waste หรือ actual recipe usage
- ไม่สร้าง Production Timeline หรือ Cycle Tasks
- ไม่สร้าง final cost snapshot หรือรายงานกำไร
- ไม่เชื่อมร้านค้า ระบบชำระเงิน หรือระบบขนส่ง
- ไม่รองรับ lot, expiry หรือ inventory valuation
- ไม่แก้หรือลบ ledger entries แบบ destructive; การกรอกผิดใช้การนับสต๊อกใหม่และเพิ่ม price history ที่ถูกต้องในขอบเขต MVP

## 5. แนวทางสถาปัตยกรรม

ใช้ snapshot ต่อ Planning Generation ร่วมกับ append-only purchase ledger:

- Phase 3A เป็นแหล่ง requirement ที่ immutable
- Phase 3B snapshot ยอดนับและคำแนะนำซื้อ ณ เวลายืนยัน
- การซื้อจริงเป็น event แยกหลายรายการและเชื่อมกลับไปยัง Shopping item
- `inventory_movements` ยังคงเป็นแหล่งจริงของ global stock balance
- `inventory_prices` ยังคงเป็นแหล่งจริงของราคาที่มีผลสำหรับ planning ครั้งต่อไป

เพิ่ม module `shopping` ที่มีขอบเขตชัดเจน:

- domain functions คำนวณ requirement aggregation, shortfall, suggested packs และ purchase progress
- query services อ่าน active/history view โดยไม่ mutate
- command services ยืนยันสต๊อกและบันทึก purchase ใน transaction
- Server Actions ตรวจ session owner แปลงผลลัพธ์เป็นข้อความไทยที่ปลอดภัย และ revalidate เส้นทางที่เกี่ยวข้อง
- UI แสดง count form หรือ immutable shopping view ตามสถานะของ generation

## 6. โมเดลข้อมูล

### 6.1 `cycle_inventory_counts`

หนึ่งแถวต่อ inventory item ที่ Planning Generation ต้องใช้ โดยรวม material และ packaging requirement ก่อน persist

ฟิลด์หลัก:

- `id` UUID
- `owner_id`
- `bake_cycle_id`
- `planning_snapshot_id`
- `inventory_item_id`
- `price_snapshot_id`
- `inventory_item_name` ที่คัดลอกจาก planning snapshot
- `inventory_category`: `INGREDIENT | PACKAGING`
- `base_unit`
- `required_quantity`
- `system_balance_before_count`
- `counted_quantity`
- `count_delta_quantity`
- `purchase_unit_label` ที่คัดลอกจาก inventory master ตอนยืนยัน
- `base_quantity_per_purchase_pack` ที่คัดลอกตอนยืนยัน
- `count_movement_id`
- `counted_at`
- `confirmation_request_id`
- `created_at`

Constraints:

- unique `(owner_id, id)`
- unique `(owner_id, planning_snapshot_id, inventory_item_id)`
- positive `required_quantity`
- non-negative system/count quantities
- positive pack quantity
- `count_delta_quantity = counted_quantity - system_balance_before_count`
- owner-scoped foreign keys ไปยัง Bake Cycle, Planning Snapshot, price snapshot, inventory item และ count movement
- Planning Snapshot FK ต้องรวม `bake_cycle_id` เพื่อห้ามผูก count ข้ามรอบ

`confirmation_request_id` เดียวกันใช้กับทุกแถวของการยืนยันหนึ่งครั้งเพื่อ audit และตรวจ retry แต่ uniqueness ต่อ snapshot/item เป็นขอบเขต idempotency ที่แท้จริง

### 6.2 `cycle_shopping_items`

สร้างเฉพาะ count ที่มี `shortfall_quantity > 0` และไม่แก้ค่าคำแนะนำย้อนหลัง

ฟิลด์หลัก:

- `id` UUID
- `owner_id`
- `bake_cycle_id`
- `planning_snapshot_id`
- `inventory_count_id`
- `inventory_item_id`
- `shortfall_quantity`
- `suggested_pack_count`
- `suggested_purchase_quantity`
- `estimated_cost_satang`, nullable เมื่อ planning price ขาด
- `created_at`

Constraints:

- unique `(owner_id, id)`
- unique `(owner_id, planning_snapshot_id, inventory_item_id)`
- one-to-one owner-scoped FK ไปยัง `cycle_inventory_counts`
- positive shortfall, suggested pack count และ suggested purchase quantity
- `suggested_purchase_quantity >= shortfall_quantity`
- estimated cost เป็น null หรือ integer ไม่ติดลบ

สถานะไม่ persist เป็น mutable column แต่ derive จากยอดซื้อสะสม:

- `TO_BUY` เมื่อ purchased quantity เท่ากับ 0
- `PARTIAL` เมื่อมากกว่า 0 แต่น้อยกว่า shortfall
- `COMPLETE` เมื่อเท่ากับหรือมากกว่า shortfall

### 6.3 `cycle_purchase_entries`

หนึ่งแถวต่อการซื้อจริงหนึ่งครั้ง เป็น append-only business event

ฟิลด์หลัก:

- `id` UUID
- `owner_id`
- `bake_cycle_id`
- `planning_snapshot_id`
- `shopping_item_id`
- `inventory_item_id`
- `purchase_request_id`
- `pack_count` integer
- `pack_base_quantity` ที่คัดลอกจาก cycle count
- `purchased_quantity`
- `total_price_satang`
- `purchased_from`, nullable
- `occurred_at`
- `notes`, nullable
- `inventory_movement_id`
- `inventory_price_id`
- `created_at`

Constraints:

- unique `(owner_id, id)`
- unique `(owner_id, purchase_request_id)` สำหรับ idempotency
- unique owner-scoped references ไปยัง movement และ price row
- composite owner/snapshot/item FK ไปยัง Shopping item เพื่อห้ามข้าม generation หรือ inventory item
- `pack_count > 0`
- `pack_base_quantity > 0`
- `purchased_quantity = pack_count * pack_base_quantity`
- `total_price_satang >= 0`

เพิ่ม composite unique `(owner_id, id)` ให้ `inventory_movements` เพื่อรองรับ owner-scoped FK จาก count และ purchase entries หากยังไม่มี

### 6.4 RLS และ indexes

- เปิด RLS บนทุกตารางใหม่
- ไม่มี anonymous/authenticated Data API policies; server-side application connection เป็น write path
- index ทุก owner-scoped list path: owner/cycle/snapshot, owner/snapshot/item และ owner/shopping item/occurred time
- ทุก cross-table relationship ใช้ owner-scoped composite foreign key
- ใช้ `ON DELETE RESTRICT` เพื่อรักษาประวัติ

## 7. กฎคำนวณ

### 7.1 รวม requirement

อ่านเฉพาะ `cycle_material_requirements` และ `cycle_packaging_requirements` ของ Planning Snapshot ที่เลือก แล้วรวม `planned_requirement` ตาม inventory item:

```text
required(item) = sum(material planned requirement)
               + sum(packaging planned requirement)
```

ชื่อ หมวด และ base unit ต้องมาจาก Planning Snapshot ไม่ใช่ inventory master ปัจจุบัน ยกเว้น purchase unit label และ default purchase pack quantity ซึ่ง snapshot ณ เวลายืนยันสต๊อก

### 7.2 ของขาด

```text
shortfall = max(required - counted, 0)
```

`minimumStockQuantity` ไม่เข้าการคำนวณ Phase 3B

### 7.3 จำนวนแพ็กแนะนำ

```text
suggestedPackCount = ceil(shortfall / baseQuantityPerPurchasePack)
suggestedPurchaseQuantity = suggestedPackCount * baseQuantityPerPurchasePack
```

ใช้ Decimal.js ห้ามใช้ floating-point arithmetic สำหรับ quantity

### 7.4 ต้นทุนซื้อประมาณการ

ถ้า Phase 3A price snapshot มีราคา:

```text
estimatedCost = roundHalfUp(
  suggestedPurchaseQuantity * snapshottedUnitCostSatang
)
```

ถ้าไม่มีราคา `estimatedCostSatang = null` และ UI แสดง `ยังไม่มีราคาประมาณ` ห้ามแปลงเป็นศูนย์

### 7.5 ความคืบหน้าการซื้อ

```text
purchased = sum(purchaseEntry.purchasedQuantity)
remaining = max(shortfall - purchased, 0)
overage = max(purchased - shortfall, 0)
```

ซื้อเกินไม่ถูก clamp ออกจาก stock movement และไม่เปลี่ยน immutable shortfall

### 7.6 ราคา actual purchase

แต่ละ purchase entry สร้าง `inventory_prices` หนึ่งแถวโดยใช้:

- `pack_price_satang = total_price_satang`
- `pack_base_quantity = purchased_quantity`
- `effective_at = occurred_at`
- `purchased_from` และ notes จาก purchase

การเก็บยอดเงินจริงคู่กับปริมาณรวมโดยตรงรักษา unit-cost precision โดยไม่ต้องหารราคาเฉลี่ยต่อแพ็กก่อน persist

## 8. Application contracts

### 8.1 Queries

```ts
getCycleStockCheck(
  ownerId: string,
  cycleId: string,
  generation?: number,
): Promise<CycleStockShoppingView>
```

ผลลัพธ์แบ่งเป็น:

- `COUNT_REQUIRED`: active generation ยังไม่เคยยืนยันสต๊อก พร้อม rows ที่มี current system balance
- `SHOPPING`: ยืนยันแล้ว พร้อม immutable count, shopping items, purchase entries และ derived progress
- `HISTORY`: generation เก่าหรือ cycle terminal แสดง read-only
- `NO_PLAN`: รอบยังไม่มี planning generation

### 8.2 Confirm stock

```ts
confirmCycleStock(
  ownerId: string,
  input: {
    cycleId: string;
    planningSnapshotId: string;
    confirmationRequestId: string;
    countedAt: Date;
    counts: ReadonlyArray<{
      inventoryItemId: string;
      countedQuantity: string;
    }>;
  },
): Promise<CycleStockShoppingView>
```

คำสั่งต้องตรวจว่ารายการ input ตรงกับ required inventory items ทุกตัวแบบ exact set: ห้ามขาด ห้ามเกิน และห้ามซ้ำ

### 8.3 Record purchase

```ts
recordCyclePurchase(
  ownerId: string,
  input: {
    cycleId: string;
    planningSnapshotId: string;
    shoppingItemId: string;
    purchaseRequestId: string;
    packCount: number;
    totalPriceSatang: number;
    purchasedFrom?: string;
    occurredAt: Date;
    notes?: string;
  },
): Promise<ShoppingItemProgress>
```

retry ด้วย `purchaseRequestId` เดิมและ payload เดิมคืน purchase เดิมโดยไม่สร้าง movement/price ซ้ำ หาก request ID เดิมมากับ payload คนละ shopping item ให้ปฏิเสธ

## 9. Transaction และ concurrency

### 9.1 Confirm stock transaction

1. lock owner-scoped Bake Cycle row
2. ตรวจ status เป็น `LOCKED` หรือ `IN_PRODUCTION`
3. ตรวจ `active_planning_snapshot_id` ตรงกับ input และ snapshot status เป็น `ACTIVE`
4. lock required inventory item rows ตาม UUID ที่ sort แล้ว
5. ถ้ามี counts อยู่แล้วและ payload เหมือนเดิม ให้คืนผลเดิม; ถ้าต่าง ให้ปฏิเสธ
6. โหลดและรวม immutable requirements ภายใน transaction
7. ตรวจ exact input set และ decimal constraints
8. คำนวณ current balance ใหม่หลังได้ locks
9. สร้าง `COUNT` movement ต่อ item เพื่อ reconcile ledger
10. สร้าง cycle inventory count ต่อ item
11. สร้าง Shopping item เฉพาะ shortfall บวก
12. commit ทั้งชุดหรือ rollback ทั้งชุด

### 9.2 Purchase transaction

1. lock Bake Cycle row
2. ตรวจ status และ active snapshot เช่นเดียวกับ confirm
3. ตรวจ `purchaseRequestId`; ถ้ามีแล้วให้คืนผล idempotently
4. lock inventory item แล้ว Shopping item ในลำดับคงที่
5. ตรวจ pack count, copied pack size และ money
6. สร้าง purchase entry, `PURCHASE` movement และ price history ใน transaction เดียว
7. query ยอดซื้อสะสมและคืน derived progress

ทุก write path ต้องยืนยัน lifecycle ใน transaction ไม่พึ่ง disabled UI

## 10. Lifecycle

- `DRAFT` และ `OPEN`: ยังไม่มี active locked generation สำหรับ stock check
- `LOCKED`: ยืนยันสต๊อกและบันทึกซื้อได้
- `IN_PRODUCTION`: บันทึกซื้อเพิ่มเติมได้ เพราะอาจมีการซื้อฉุกเฉินระหว่างผลิต
- เมื่อ unlock: Phase 3A เปลี่ยน snapshot เดิมเป็น `SUPERSEDED` และล้าง active pointer; stock/shopping เดิมอ่านอย่างเดียวทันที
- เมื่อ re-lock: generation ใหม่เริ่ม stock check ใหม่จาก global stock balance ซึ่งรวม purchases ก่อนหน้าแล้ว
- `COMPLETED` และ `CANCELLED`: count/shopping/purchase history อ่านอย่างเดียว

ห้ามนำ count หรือ shopping item จาก superseded generation กลับมาแก้หรือผูกกับ generation ใหม่

## 11. UX และ routes

เพิ่ม route หลัก:

```text
/cycles/[id]/shopping
/cycles/[id]/shopping?generation=N
```

เพิ่ม action `เช็กสต๊อกและรายการซื้อ` ใน Cycle Detail และ Planning page เมื่อมี active generation

### 11.1 Count screen

- header แสดงชื่อรอบและ Planning Generation
- card ต่อ required item แสดงชื่อ หมวด ต้องใช้ ยอดในระบบ และ base unit
- input `จำนวนที่นับจริง` ต้องครบทุก item
- ยอดในระบบเป็นค่าเริ่มต้นเพื่อช่วยกรอก แต่ copy อธิบายว่าต้องตรวจของจริงก่อนยืนยัน
- sticky phone action `ยืนยันสต๊อกและสร้างรายการซื้อ`
- confirmation dialog อธิบายว่าจะ reconcile stock ledger และล็อกยอดนับของ generation นี้

### 11.2 Shopping screen

- summary: จำนวนรายการต้องซื้อ, ซื้อครบ, ยังไม่ครบ และ estimated total ที่ทราบ
- ถ้าไม่มี shortfall แสดง success state `สต๊อกเพียงพอสำหรับรอบนี้`
- item card แสดง required, counted, shortfall, pack size, suggested packs, purchased, remaining และ overage
- badges `ต้องซื้อ`, `ซื้อบางส่วน`, `ซื้อครบ`
- ปุ่ม `บันทึกการซื้อ` และหลังซื้อครบใช้ข้อความ `เพิ่มการซื้ออีกครั้ง`
- purchase form ใช้ native number/date/time controls ที่แตะง่ายและ validation message ข้าง field
- purchase history แสดงทุกรายการโดยไม่ซ่อนรายการก่อนหน้า
- overage แสดงเป็นข้อความเชิงข้อมูล ไม่ใช่ error

### 11.3 History

- ใช้ generation selector pattern เดียวกับหน้า Planning
- superseded/terminal generation ไม่มี submit controls
- แสดง badge `ประวัติ · อ่านอย่างเดียว`

## 12. Error handling

Server Actions คืนผลลัพธ์ที่แยก field errors และ form error โดยไม่ส่ง raw database message ไป browser

กรณีหลัก:

- generation เปลี่ยนหรือรอบถูก unlock ระหว่างกรอก: แจ้ง `แผนของรอบเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุด` และ refresh
- counts ไม่ครบ/ซ้ำ/มี item เกิน: แสดง field/form validation โดยไม่เขียนข้อมูลใด ๆ
- มีการยืนยัน stock ไปแล้วด้วยข้อมูลต่างกัน: เปิด immutable result และอธิบายว่าต้อง re-lock เพื่อสร้างชุดใหม่
- purchase ถูกส่งซ้ำ: คืนผลเดิมจาก idempotency key
- transaction ล้มเหลว: ไม่แสดง saved state และไม่สร้าง purchase/movement/price เพียงบางส่วน
- network/Flight stream ขาดหลัง POST: browser test และ UI recovery ใช้ fresh GET เพื่ออ่าน persisted state; idempotency ป้องกัน duplicate write

## 13. Security

- ทุก route และ Server Action เรียก `requireOwner()`
- owner ID มาจาก verified session เท่านั้น
- service queries filter owner ทุกตาราง
- UUID จาก route/form ไม่ถือเป็น authorization
- composite owner foreign keys ป้องกัน cross-owner lineage ที่ database layer
- RLS เปิดเป็น defense in depth
- input ใช้ Zod และ Decimal.js; money เป็น integer satang
- ไม่มี public signup, public shopping link หรือ external integration

## 14. Migration strategy

- ใช้ forward-only migration ต่อจาก `0010`
- schema และ SQL migration ต้องมี constraint/foreign-key parity tests
- ไม่แก้ migration ที่เคยใช้กับ configured development database แล้ว
- migration ต้องทำงานทั้ง fresh database และ database ที่มี Phase 3A data
- ตารางใหม่เริ่มว่าง ไม่มี backfill เพราะ Phase 3A generations ที่มีอยู่ยังไม่มีการยืนยันสต๊อก

## 15. Testing strategy

ใช้ TDD ก่อน production code ทุก business rule

### Domain tests

- aggregate material และ packaging rows ตาม item
- exact Decimal addition
- non-negative shortfall
- ceil suggested packs ที่ boundary และ decimal precision
- missing estimated price ไม่กลายเป็นศูนย์
- progress: none, partial, exact complete และ overage

### Schema/migration tests

- owner-scoped FKs และ RLS ทุกตาราง
- same cycle/snapshot/item lineage
- unique count ต่อ generation/item
- idempotency unique key
- positive/non-negative/check constraints
- append-only source rows ถูก RESTRICT

### Application integration tests

- exact-set count validation
- COUNT reconciliation จาก current balance ภายใน transaction
- atomic count + shopping creation และ forced rollback
- idempotent count retry
- partial/multiple/over purchase
- atomic purchase + movement + price และ forced rollback
- idempotent purchase retry
- owner isolation
- lifecycle guards ก่อนและหลัง unlock/re-lock
- historical query ไม่อ่าน mutable recipe/packaging requirements

### UI/action tests

- verified owner เท่านั้น
- count form completeness และ mobile sticky action
- no-shortfall empty state
- shopping status/remaining/overage
- read-only history
- safe stale/error messages

### Playwright

Phone และ desktop workflow:

1. สร้าง master data และ Planning Generation ที่มีทั้ง ingredient และ packaging requirement
2. เปิด cycle shopping page และตรวจ latest balance
3. ยืนยัน counts ที่ทำให้หนึ่งรายการขาดและอีกหนึ่งรายการพอ
4. ตรวจ suggested pack rounding
5. ซื้อบางส่วนและตรวจ `PARTIAL`
6. ซื้อเพิ่มจนเกิน shortfall และตรวจ `COMPLETE` พร้อม overage
7. ตรวจ global stock balance และ latest price
8. unlock/re-lock แล้วตรวจ generation เดิม read-only และ generation ใหม่เห็น stock ที่รวม purchases

E2E ใช้ configured development/test Supabase เท่านั้น ใช้ unique fixture names และไม่ลบ persistent fixtures โดยอัตโนมัติ

## 16. Release gate

Phase 3B พร้อม merge เมื่อ:

- migrations ใช้ได้กับ configured development/test database
- lint ผ่าน
- TypeScript typecheck ผ่าน
- unit/integration tests ผ่านทั้งหมด
- production build ผ่าน
- phone และ desktop Playwright workflow ผ่าน
- environment/secrets ไม่อยู่ใน diff
- independent review ไม่มี unresolved Important+ finding

## 17. Acceptance criteria

1. active locked generation แสดง requirement ที่รวมตาม inventory item จาก immutable Phase 3A rows เท่านั้น
2. เจ้าของร้านต้องยืนยันยอดนับครบทุก required item ในครั้งเดียว
3. การยืนยันสร้าง COUNT movements, immutable counts และ Shopping List แบบ atomic
4. quantity to buy ไม่ติดลบและไม่รวม minimum stock
5. suggested pack count ปัดขึ้นด้วย copied purchase pack size
6. no-shortfall item มี count history แต่ไม่มี Shopping item
7. purchase หนึ่ง item บันทึกได้หลายครั้งและเพิ่ม stock จริงทุกครั้ง
8. actual purchase สร้าง price history จาก total actual money และ total purchased quantity
9. partial, complete และ overage แสดงถูกต้องโดยไม่ทิ้ง stock ส่วนเกิน
10. retries ไม่สร้าง COUNT/PURCHASE movement หรือ price row ซ้ำ
11. unlock ทำให้ generation เดิม read-only และ re-lock สร้าง stock/shopping scope ใหม่
12. cross-owner และ cross-generation writes ถูกปฏิเสธทั้ง application และ database boundaries
13. workflow สำคัญใช้งานได้ทั้ง phone และ desktop
