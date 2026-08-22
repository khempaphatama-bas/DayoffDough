# Day Off Dough OS — MVP Design Specification

- วันที่: 2026-08-22
- สถานะ: พร้อมให้ผู้ใช้ตรวจทาน
- ประเภทระบบ: เว็บแอปภายในร้านแบบ Responsive
- ผู้ใช้หลัก: เจ้าของร้านหนึ่งคน

## 1. บทสรุป

Day Off Dough OS เป็นระบบหลังร้านสำหรับเบเกอรี่ขนาดเล็กที่ผลิตเป็นรอบ ระบบช่วยเปลี่ยนออเดอร์ลูกค้าให้เป็นแผนการทำงานที่นำไปใช้ได้จริง ตั้งแต่การรวมยอดสินค้า การคำนวณจำนวนสูตรและวัตถุดิบ การตรวจสต๊อก การสร้างรายการซื้อ การวางแผนงานย้อนหลังจากวันส่ง ไปจนถึงการสรุปรายได้ ต้นทุน และกำไรของรอบ

ระบบไม่ใช่หน้าร้านออนไลน์, POS หรือ ERP เป้าหมายคือช่วยลดสิ่งที่เจ้าของร้านต้องจำ คำนวณ และประสานเองในแต่ละ Bake Cycle

ลำดับข้อมูลหลักคือ:

`ราคาวัตถุดิบ → ต้นทุนสูตร → ต้นทุนสินค้า → ออเดอร์ → Bake Cycle → แผนผลิต → สต๊อกและรายการซื้อ → Timeline → สรุปรอบ`

## 2. บริบทและปัญหา

ปัจจุบันออเดอร์มาจาก Instagram, Facebook และการติดต่อโดยตรง เจ้าของร้านจะกรอกออเดอร์เข้าระบบเองใน MVP ข้อมูลที่ต้องติดตามประกอบด้วยลูกค้า สินค้า จำนวน ราคา วันรับสินค้า วิธีส่ง ค่าส่ง การชำระเงิน และคำสั่งพิเศษ

เมื่อยืนยันออเดอร์แล้ว เจ้าของร้านต้องคำนวณต่อเองว่า:

- ต้องผลิตสินค้าแต่ละชนิดเท่าไร
- ต้องทำสูตรกี่ batch และจะได้ผลผลิตจริงเท่าไร
- ต้องใช้วัตถุดิบและบรรจุภัณฑ์เท่าไร
- ของที่มีอยู่เพียงพอหรือไม่
- ต้องซื้ออะไรและควรซื้อกี่แพ็ก
- ต้องเริ่มเตรียมแต่ละผลิตภัณฑ์วันไหน
- รอบนั้นมีรายได้ ต้นทุน และกำไรเท่าไร

## 3. เป้าหมายของ MVP

MVP ต้องทำให้เจ้าของร้านตอบคำถามต่อไปนี้ได้โดยไม่ต้องคำนวณด้วยมือ:

1. ใครสั่งอะไร จำนวนเท่าไร ราคาเท่าไร รับสินค้าอย่างไร และมีคำสั่งพิเศษอะไร
2. Bake Cycle นี้ต้องผลิตสินค้าแต่ละชนิดเท่าไร
3. ต้องทำแต่ละสูตรกี่ batch และต้องใช้ส่วนผสมเท่าไร
4. วัตถุดิบและบรรจุภัณฑ์ที่มีอยู่เพียงพอหรือไม่
5. ต้องซื้ออะไร จำนวนเท่าไร และประมาณกี่แพ็ก
6. ก่อนถึงวันส่งต้องทำกิจกรรมใด วันไหน และเวลาใดโดยประมาณ
7. รอบที่จบแล้วมีรายได้ ต้นทุน และกำไรขั้นต้นเท่าไร

## 4. ขอบเขตที่ไม่ทำใน MVP

- หน้าร้านสาธารณะหรือระบบ e-commerce
- บัญชีลูกค้าและ customer login
- ระบบสะสมแต้ม
- Payment gateway
- POS
- การดึงออเดอร์จาก Instagram หรือ Facebook อัตโนมัติ
- การเรียกรถหรือเชื่อม API บริษัทขนส่ง
- ระบบบัญชีการเงินเต็มรูปแบบ
- ระบบคลังสินค้าแบบ lot, expiry, location หรือ warehouse
- ระบบสิทธิ์ผู้ใช้หลายระดับ
- Native iOS หรือ Android app
- AI chatbot
- Advanced analytics และ enterprise reporting
- ระบบ dependency graph หรือ resource scheduling ขั้นสูง

## 5. การตัดสินใจหลัก

### 5.1 Bake Cycle เป็นแกนของระบบ

หนึ่ง Bake Cycle แทนหนึ่งรอบผลิตและมีวันส่งหลักหนึ่งวัน ออเดอร์หนึ่งรายการต้องอยู่ใน Bake Cycle เดียว หากลูกค้าต้องรับสินค้าคนละวันอย่างมีนัยสำคัญ ให้สร้าง Bake Cycle แยกเพื่อให้แผนผลิตและ Timeline ไม่กำกวม

ออเดอร์ยังเก็บ requested delivery date และ confirmed delivery date ได้ แต่ใน MVP confirmed delivery date ควรตรงกับวันส่งหลักของ Bake Cycle ระบบเตือนเมื่อไม่ตรงกันและให้เจ้าของร้านยืนยันก่อนบันทึก

### 5.2 กรอกออเดอร์เอง

เจ้าของร้านกรอกออเดอร์จาก Instagram, Facebook, โทรศัพท์ หรือช่องทางอื่นเข้าระบบเอง ไม่มี social media integration ใน MVP

### 5.3 ต้นทุนครบตามการปฏิบัติงาน

ต้นทุนสินค้ารวมวัตถุดิบ บรรจุภัณฑ์ ค่าแรง ค่าไฟหรือแก๊ส ค่าเผื่อสูญเสีย และค่าอุดหนุนการจัดส่ง

### 5.4 Responsive และ mobile-priority

ระบบต้องใช้งานได้ดีทั้งมือถือและคอมพิวเตอร์ หน้าจอระหว่างผลิตและนับสต๊อกให้ความสำคัญกับมือถือ ส่วนหน้าตารางและการตั้งค่าสูตรต้องใช้พื้นที่คอมพิวเตอร์ได้เต็มประสิทธิภาพ

## 6. สถาปัตยกรรม

ใช้ Modular Monolith เพื่อให้ระบบง่ายต่อการพัฒนาและดูแลในระยะแรก:

- Responsive web UI
- Backend และ Calculation Engine ใน codebase เดียวกัน
- Relational database
- Authentication สำหรับเจ้าของร้านหนึ่งคน
- Cloud hosting พร้อม database backup
- ส่งออกข้อมูลสำคัญเป็น CSV ได้

โมดูลแยกขอบเขตเชิงธุรกิจ แต่ยัง deploy เป็นระบบเดียว:

- Catalog
- Recipe and Costing
- Customer and Order
- Bake Cycle and Production Planning
- Inventory and Shopping
- Production Timeline
- Cycle Summary

การคำนวณสำคัญต้องเกิดที่ backend เพื่อให้ผลลัพธ์เหมือนกันทุกอุปกรณ์และป้องกันการแก้ค่าเฉพาะฝั่งหน้าจอ เงินจัดเก็บเป็น integer หน่วยสตางค์ ปริมาณและอัตราแปลงหน่วยใช้ชนิด decimal ที่กำหนด precision ชัดเจน

## 7. โมดูลการทำงาน

### 7.1 วัตถุดิบ บรรจุภัณฑ์ และราคา

รองรับ inventory item สองกลุ่ม:

- Ingredient เช่น แป้ง ยีสต์ เกลือ น้ำมัน ครีมชีส
- Packaging/Consumable เช่น ถุง กล่อง แก้ว ฝา สติกเกอร์

แต่ละรายการมีหน่วยฐาน หน่วยซื้อ ขนาดต่อแพ็ก ราคาซื้อ ประวัติราคา สต๊อกปัจจุบัน และ optional minimum stock

ตัวอย่าง:

`แป้ง 1 kg ราคา ฿55 → 1,000 g → ฿0.055/g`

### 7.2 สินค้า สูตร และต้นทุน

สินค้าเชื่อมกับสูตรที่กำลังใช้งาน สูตรมี version และ base yield ที่เป็นผลผลิตขายได้หลังการสูญเสียตามกระบวนการปกติ

Recipe Version ประกอบด้วย:

- วัตถุดิบและปริมาณ
- Base yield และ yield unit
- เวลาแรงงานต่อ batch
- ค่าไฟหรือแก๊สต่อ batch
- Waste allowance percent
- หมายเหตุวิธีผลิต

สินค้าเชื่อมกับกฎบรรจุภัณฑ์แยกจากวัตถุดิบ เช่น Focaccia หนึ่งถาดใช้ถุงหนึ่งใบ หรือการส่งแบบ KEX ใช้กล่องหนึ่งใบต่อออเดอร์

### 7.3 ลูกค้าและออเดอร์

ออเดอร์รองรับลูกค้าหนึ่งคนและสินค้าหลายรายการ โดยเก็บข้อมูล:

- ช่องทางรับออเดอร์
- Requested และ confirmed delivery date
- วิธีส่ง
- ค่าส่งที่เรียกเก็บลูกค้า
- ต้นทุนขนส่งจริง
- ผู้รับผิดชอบค่าส่ง
- จุดรับหรือที่อยู่และหมายเหตุการส่ง
- ส่วนลด
- ยอดชำระแล้ว
- Payment status
- Fulfillment status
- Special instructions
- Bake Cycle

ราคาต่อหน่วยถูกคัดลอกจากราคาสินค้าปัจจุบันเข้า Order Item และแก้เฉพาะรายการได้ การเปลี่ยนราคาสินค้าภายหลังไม่เปลี่ยนออเดอร์เก่า

### 7.4 Bake Cycle และแผนผลิต

Bake Cycle เป็นหน้ารวมของรอบ ประกอบด้วย:

- รายการออเดอร์และลูกค้า
- ยอดสินค้าที่ต้องผลิต
- จำนวน batch ที่แนะนำและจำนวนผลิตจริง
- วัตถุดิบและบรรจุภัณฑ์รวม
- ผลการตรวจสต๊อก
- รายการซื้อ
- Production Timeline
- สถานะการชำระ การผลิต การแพ็ก และการจัดส่ง
- สรุปรายได้ ต้นทุน และกำไร

### 7.5 Inventory และ Shopping

ระบบเปรียบเทียบ material requirement ของ Bake Cycle กับ stock balance ที่ยืนยันล่าสุด และสร้าง shortfall กับ shopping list

รายการซื้อเก็บจำนวนที่ต้องซื้อ จำนวนแพ็กที่แนะนำ ราคาประมาณการ จำนวนซื้อจริง และราคาซื้อจริง เมื่อยืนยันการซื้อ ระบบบันทึก inventory movement และ price history

เมื่อจบรอบ ระบบเสนอให้ตัดสต๊อกตาม planned requirement หรือจำนวนใช้จริงที่เจ้าของร้านแก้ไข การตัดสต๊อกเกิดขึ้นเมื่อเจ้าของร้านยืนยันเท่านั้นและบันทึกเป็น inventory movement ประเภท `CONSUMPTION`

### 7.6 Production Timeline

Production Template รองรับกิจกรรมระดับสินค้าและระดับรอบ โดยแต่ละกิจกรรมมี:

- Activity name
- Offset days from delivery
- Default time
- Estimated duration
- Sequence
- Notes

เมื่อ Bake Cycle ถูกล็อก ระบบสร้าง Cycle Task เป็น snapshot จาก template ปัจจุบัน เจ้าของร้านแก้เวลา หมายเหตุ และสถานะ task ในแต่ละรอบได้โดยไม่กระทบ template

MVP ไม่สร้าง dependency graph และไม่แก้ตารางอัตโนมัติเมื่อ task ล่าช้า

### 7.7 Cycle Summary

เมื่อปิดรอบ ระบบสรุป:

- จำนวนลูกค้าและออเดอร์
- จำนวนสินค้าที่ขาย
- Product revenue
- Discount
- Delivery fee charged
- Ingredient cost
- Packaging cost
- Labor cost
- Utility cost
- Waste allowance cost
- Delivery cost และ delivery subsidy
- Gross profit และ gross margin

ค่าต้นทุนตอนล็อกรอบเป็น planning snapshot ส่วนตอนปิดรอบเป็น final snapshot หากเจ้าของร้านบันทึกจำนวนใช้จริงหรือราคาซื้อจริง ระบบใช้ค่าจริงเหล่านั้น หากไม่มี ระบบใช้ค่าประมาณจาก planning snapshot และทำเครื่องหมายว่าเป็นค่าประมาณ

## 8. Primary User Flow

1. สร้างหรือเปิด Bake Cycle
2. กรอกออเดอร์และยืนยันวันส่ง
3. ตรวจความครบถ้วนของออเดอร์
4. ล็อกรอบและสร้าง snapshot
5. รวมยอดสินค้าที่ต้องผลิต
6. คำนวณ batch และขยายสูตร
7. รวมวัตถุดิบและบรรจุภัณฑ์
8. นับหรือยืนยันสต๊อก
9. สร้างและใช้งาน shopping list
10. ทำงานตาม Production Timeline
11. อัปเดตสถานะการผลิต แพ็ก จัดส่ง และชำระเงิน
12. ปิด Bake Cycle และดูสรุปรอบ

## 9. โครงสร้างข้อมูลเชิงแนวคิด

ชื่อ entity อาจปรับตาม conventions ของ implementation stack แต่ความหมายและความสัมพันธ์ต้องคงเดิม

### 9.1 OwnerAccount

- id
- email
- displayName
- timezone; ค่าเริ่มต้น `Asia/Bangkok`
- currency; ค่าเริ่มต้น `THB`

### 9.2 Customer

- id
- name
- contactHandle
- phone
- defaultDeliveryMethodId
- defaultDeliveryNote
- notes
- active

### 9.3 InventoryItem

- id
- name
- category: `INGREDIENT | PACKAGING | CONSUMABLE`
- baseUnit
- purchaseUnitLabel
- baseQuantityPerPurchasePack
- minimumStockQuantity
- active
- notes

### 9.4 InventoryPrice

- id
- inventoryItemId
- packPriceSatang
- packBaseQuantity
- purchasedFrom
- effectiveAt
- notes

Unit cost คำนวณจาก `packPriceSatang / packBaseQuantity`

### 9.5 InventoryMovement

- id
- inventoryItemId
- type: `COUNT | PURCHASE | CONSUMPTION | CORRECTION`
- quantityDeltaInBaseUnit
- countedQuantityInBaseUnit; ใช้เฉพาะ `COUNT`
- referenceType
- referenceId
- occurredAt
- notes

Stock balance ได้จาก movement ledger ระบบมีคำสั่ง reconcile ด้วยการนับจริง เมื่อบันทึก `COUNT` ระบบคำนวณ quantity delta จากยอดก่อนหน้าใน transaction เดียวกัน

### 9.6 Product

- id
- name
- sellingUnit
- defaultUnitPriceSatang
- activeRecipeVersionId
- active
- notes

### 9.7 Recipe และ RecipeVersion

Recipe:

- id
- productId
- name

RecipeVersion:

- id
- recipeId
- versionCode
- baseYieldQuantity
- yieldUnit
- laborMinutesPerBatch
- utilityCostSatangPerBatch
- wasteAllowancePercent
- instructions
- activeFrom

### 9.8 RecipeIngredient

- id
- recipeVersionId
- inventoryItemId
- quantityInBaseUnit
- notes

Recipe Ingredient ต้องอ้าง inventory item ที่ category เป็น `INGREDIENT`

### 9.9 ProductPackagingRule

- id
- scope: `PRODUCT | DELIVERY_METHOD`
- productId; ต้องมีเมื่อ scope เป็น `PRODUCT`
- deliveryMethodId; ต้องมีเมื่อ scope เป็น `DELIVERY_METHOD`
- inventoryItemId
- consumptionBasis: `PER_PRODUCT_UNIT | PER_ORDER | PER_DELIVERY`
- quantityInBaseUnit
- notes

ProductPackagingRule ต้องอ้าง inventory item ที่ category เป็น `PACKAGING` หรือ `CONSUMABLE`

กฎที่รองรับใน MVP คือ:

- `PRODUCT + PER_PRODUCT_UNIT`: คูณตามจำนวนหน่วยสินค้าที่ผลิต
- `PRODUCT + PER_ORDER`: ใช้หนึ่งครั้งต่อออเดอร์ที่มีสินค้านั้น
- `DELIVERY_METHOD + PER_DELIVERY`: ใช้หนึ่งครั้งต่อออเดอร์ที่เลือกวิธีส่งนั้น

Combination อื่นถือว่าไม่ถูกต้องและต้องถูกปฏิเสธตอนบันทึกกฎ

### 9.10 DeliveryMethod

- id
- name
- defaultCustomerFeeSatang
- defaultInternalCostSatang
- active
- notes

Order จะคัดลอกค่าตั้งต้นทั้งสองค่าและอนุญาตให้แก้รายออเดอร์

### 9.11 ProductionTemplate และ ProductionTemplateActivity

ProductionTemplate:

- id
- name
- scope: `CYCLE | PRODUCT`
- productId เมื่อ scope เป็น `PRODUCT`
- active

ProductionTemplateActivity:

- id
- productionTemplateId
- activityName
- offsetDaysFromDelivery
- defaultTime
- estimatedDurationMinutes
- sequence
- notes

### 9.12 BakeCycle

- id
- cycleNumber
- name
- status
- orderCutoffAt
- targetProductionDate
- primaryDeliveryDate
- lockedAt
- completedAt
- notes

### 9.13 Order

- id
- customerId
- bakeCycleId
- sourceChannel
- requestedDeliveryDate
- confirmedDeliveryDate
- deliveryMethodId
- deliveryFeeChargedSatang
- deliveryCostSatang
- deliveryFeePayer: `CUSTOMER | BAKERY | SHARED`
- discountSatang
- amountPaidSatang
- deliveryLocationOrNote
- specialInstructions
- paymentStatus
- fulfillmentStatus
- createdAt

### 9.14 OrderItem

- id
- orderId
- productId
- quantity
- unitPriceSatang
- lineNote

### 9.15 Derived Cycle Entities

ข้อมูล derived ของ Bake Cycle ประกอบด้วย:

- CycleProductPlan
- CycleRecipePlan
- CycleMaterialRequirement
- CycleInventoryCount
- CycleShoppingItem
- CycleTask
- CycleCostSnapshot

ตอนล็อกรอบ ระบบสร้าง CycleProductPlan, CycleRecipePlan, CycleMaterialRequirement, CycleTask และ planning CycleCostSnapshot ใน transaction เดียว CycleInventoryCount และ CycleShoppingItem ถูกสร้างหรืออัปเดตหลังเจ้าของร้านยืนยันจำนวนสต๊อก

CycleCostSnapshot มี snapshot type เป็น `PLANNING | FINAL` Derived entities เก็บ source version และค่าที่ใช้คำนวณ เพื่ออธิบายผลลัพธ์ย้อนหลังได้

### 9.16 ShopSettings

- laborRateSatangPerHour
- timezone; ค่าเริ่มต้น `Asia/Bangkok`
- currency; ค่าเริ่มต้น `THB`
- defaultWasteAllowancePercent

ค่าที่ใช้ในการคำนวณต้นทุนต้องถูก snapshot เมื่อ Bake Cycle ถูกล็อก

## 10. กฎคำนวณ

### 10.1 การแปลงหน่วย

ก่อนรวมปริมาณ ต้องแปลงค่าทั้งหมดเป็น base unit เดียวกัน หน่วยที่อนุญาตให้แปลงต้องอยู่ใน dimension เดียวกัน เช่น mass, volume หรือ count

ห้ามแปลง mass เป็น volume โดยอัตโนมัติ เช่น g เป็น ml เว้นแต่มี conversion rule เฉพาะวัตถุดิบที่เจ้าของร้านกำหนดไว้ในอนาคต ซึ่งไม่อยู่ใน MVP

### 10.2 จำนวนผลิตและจำนวน batch

สำหรับแต่ละสินค้า:

`requiredProductQuantity = ผลรวม OrderItem ที่ไม่ถูกยกเลิก`

`rawBatchCount = requiredProductQuantity / baseYieldQuantity`

`suggestedBatchCount = ceil(rawBatchCount)`

MVP เสนอ batch เต็มโดยอัตโนมัติ เจ้าของร้านสามารถ override เป็นค่าบวกแบบทศนิยมได้ แต่ต้องเป็นการแก้โดยตั้งใจและระบบเก็บเหตุผลหรือหมายเหตุ

`plannedOutput = selectedBatchCount × baseYieldQuantity`

ระบบแสดงส่วนต่างระหว่าง planned output และ ordered quantity เพื่อให้เห็นของเกินหรือความเสี่ยงของไม่พอ

### 10.3 Material requirement

สำหรับวัตถุดิบแต่ละรายการ:

`baseRequirement = ingredientQuantityPerBatch × selectedBatchCount`

`plannedRequirement = baseRequirement × (1 + wasteAllowancePercent / 100)`

Base yield ถือว่าเป็นผลผลิตขายได้หลังการสูญเสียปกติ Waste allowance เป็น buffer เพิ่มเติมและไม่เพิ่มจำนวน batch

หาก Recipe Version ไม่กำหนด waste allowance ให้ใช้ค่า default ของร้าน หากทั้งสองค่าไม่มีให้ใช้ศูนย์

Packaging requirement คำนวณจาก ProductPackagingRule ตาม basis ของกฎ

### 10.4 Shopping quantity

`availableQuantity = stock balance ที่ยืนยันสำหรับรอบ`

`quantityToBuy = max(plannedRequirement - availableQuantity, 0)`

`suggestedPurchasePacks = ceil(quantityToBuy / baseQuantityPerPurchasePack)`

หากไม่มี pack size ระบบแสดง quantity to buy โดยไม่เสนอจำนวนแพ็ก

### 10.5 ต้นทุนสูตรและสินค้า

`ingredientUnitCost = ราคาซื้อล่าสุดที่ effective ก่อนเวลาล็อกรอบ / ปริมาณฐานต่อแพ็ก`

`baseIngredientCost = baseRequirement × ingredientUnitCost`

`wasteAllowanceCost = (plannedRequirement - baseRequirement) × ingredientUnitCost`

`ingredientCostIncludingWaste = baseIngredientCost + wasteAllowanceCost`

`laborRatePerMinute = laborRateSatangPerHour / 60`

`laborCost = laborMinutesPerBatch × selectedBatchCount × laborRatePerMinute`

Labor rate เป็นค่า setting ระดับร้านและถูก snapshot เมื่อ Bake Cycle ถูกล็อก

`utilityCost = utilityCostPerBatch × selectedBatchCount`

Waste allowance ถูกสะท้อนใน planned ingredient quantity แล้ว จึงไม่บวกซ้ำในสูตรต้นทุน

`productProductionCost = baseIngredientCost + wasteAllowanceCost + packagingCost + laborCost + utilityCost`

ระบบแสดงต้นทุนต่อ batch ต้นทุนต่อ planned output unit และต้นทุนต่อ ordered unit

### 10.6 ยอดออเดอร์

`subtotal = Σ(orderItem.quantity × orderItem.unitPrice)`

`customerDeliveryCharge = ค่าส่งที่เรียกเก็บลูกค้า`

`grandTotal = subtotal - discount + customerDeliveryCharge`

ส่วนลดต้องไม่ทำให้ grand total ติดลบ

### 10.7 สรุปรอบ

`productRevenue = Σ(subtotal - discount)`

`deliveryRevenue = Σ(deliveryFeeCharged)`

`totalRevenue = productRevenue + deliveryRevenue`

`totalProductionCost = baseIngredient + wasteAllowance + packaging + labor + utility`

ในรายงาน `ingredient` หมายถึง base ingredient cost และแสดง waste allowance แยกบรรทัด โดย total production cost รวมทั้งสองรายการ

`deliverySubsidy = max(deliveryCost - deliveryFeeCharged, 0)` ต่อออเดอร์

`grossProfit = totalRevenue - totalProductionCost - totalDeliveryCost`

`grossMarginPercent = grossProfit / totalRevenue × 100` เมื่อ total revenue มากกว่าศูนย์

## 11. สถานะและการเปลี่ยนสถานะ

### 11.1 Payment Status

- `UNPAID`
- `PARTIAL`
- `PAID`
- `REFUNDED`

Payment status อนุมานจาก amount paid ได้เมื่อเหมาะสม แต่เจ้าของร้านยืนยันสถานะสุดท้ายได้ ไม่มี payment gateway ใน MVP

### 11.2 Order Fulfillment Status

- `NEW`
- `CONFIRMED`
- `IN_PRODUCTION`
- `PACKED`
- `DELIVERED`
- `CANCELLED`

### 11.3 Bake Cycle Status

- `DRAFT`
- `OPEN`
- `LOCKED`
- `IN_PRODUCTION`
- `COMPLETED`
- `CANCELLED`

เฉพาะออเดอร์ที่ไม่ถูกยกเลิกเท่านั้นที่เข้าสู่การคำนวณผลิต

## 12. การล็อก Snapshot และการคำนวณใหม่

การกดล็อกรอบต้องทำงานแบบ atomic:

1. Validate blocking errors
2. Snapshot order items และราคา
3. Snapshot active recipe versions
4. Snapshot inventory prices และ labor rate
5. สร้าง product และ recipe plans
6. สร้าง material requirements
7. สร้าง packaging requirements
8. สร้าง cost snapshot
9. สร้าง cycle tasks จาก Production Templates
10. เปลี่ยนสถานะรอบเป็น `LOCKED`

Planning snapshot ที่ได้จากการล็อกรอบไม่เปลี่ยนตามราคาหรือสูตรใน master data

เมื่อรอบล็อกแล้ว การแก้ออเดอร์ที่กระทบการผลิต สูตร หรือแผนต้องปลดล็อกก่อน การปลดล็อกแจ้งชัดเจนว่า derived plan เดิมจะถูกแทนที่เมื่อคำนวณใหม่

การแก้สถานะชำระเงิน จัดส่ง หรือ task completion ที่ไม่กระทบสูตรสามารถทำได้โดยไม่ปลดล็อก

เมื่อปิดรอบ ระบบสร้าง final snapshot จากจำนวนและต้นทุนจริงที่มีอยู่ หากข้อมูลจริงบางส่วนไม่มี ระบบใช้ planning snapshot สำหรับส่วนนั้นและติดป้าย `estimated` รอบที่ `COMPLETED` แล้วไม่ถูกคำนวณย้อนหลังจาก master data

## 13. UX และหน้าจอ

### 13.1 Navigation

มือถือใช้ bottom navigation:

- Home
- Current Cycle
- Orders
- Stock
- More

คอมพิวเตอร์ใช้ sidebar และแสดง Recipes, Products, Customers, Delivery Methods และ Settings เพิ่มเติม

### 13.2 Home

แสดงรอบที่เปิดอยู่ วันผลิต วันส่ง จำนวนออเดอร์ จำนวนสินค้าที่ต้องทำ งานวันนี้ และ alerts พร้อม quick actions สำหรับเพิ่มออเดอร์และเปิดรอบ

### 13.3 Order Form

ใช้แบบฟอร์มหน้าเดียว รองรับลูกค้า สินค้าหลายรายการ ช่องทางออเดอร์ ส่วนลด วิธีส่ง ค่าส่ง วันรับสินค้า การชำระ และคำสั่งพิเศษ พร้อมคำนวณยอดสุทธิทันที

### 13.4 Bake Cycle Detail

ประกอบด้วย tabs หรือ sections:

- Overview
- Orders
- Production
- Materials
- Shopping
- Timeline
- Summary

### 13.5 Production View

แสดงจำนวนที่สั่ง จำนวน batch ที่แนะนำ จำนวนผลิตจริง วัตถุดิบต่อ batch และรวม พร้อม action สำหรับเตรียม ผลิต และแพ็ก

### 13.6 Stock and Shopping

บนมือถือเน้นการกรอกจำนวนที่นับได้ ติ๊กของที่ซื้อแล้ว และบันทึกจำนวนกับราคาซื้อจริง

### 13.7 Product Personality

ภาพรวมต้อง calm, simple, warm, lightweight และ friendly แต่ usability มาก่อน decoration ใช้บุคลิกแบรนด์อย่างพอดี ไม่มี mascot-heavy experience ใน MVP

## 14. Validation และ Error Handling

### 14.1 Blocking Errors ก่อนล็อกรอบ

- ไม่มี primary delivery date
- ไม่มีออเดอร์ที่ใช้งานอยู่
- Order ไม่มี Order Item
- Product ไม่มี active Recipe Version
- Base yield เป็นศูนย์หรือติดลบ
- หน่วยไม่อยู่ใน dimension เดียวกันหรือไม่มี conversion
- ปริมาณวัตถุดิบเป็นค่าติดลบ

### 14.2 Warnings ที่อนุญาตให้ทำงานต่อ

- สต๊อกไม่พอ
- Inventory Item ไม่มีราคาซื้อ
- ออเดอร์ยังไม่ชำระหรือชำระบางส่วน
- ที่อยู่หรือข้อมูลจัดส่งไม่ครบ
- สินค้าไม่มี Production Template
- Confirmed delivery date ไม่ตรงกับวันส่งหลักของรอบ

หากราคาต้นทุนไม่ครบ ระบบแสดง `ต้นทุนไม่สมบูรณ์` และไม่แทนค่าที่หายด้วยศูนย์

## 15. Reliability, Security และ Data Recovery

- ทุกหน้าอยู่หลัง authentication
- ไม่มี public write endpoint
- Mutations ตรวจสิทธิ์ที่ backend แม้มีผู้ใช้เพียงคนเดียว
- การล็อกรอบและสร้าง derived plans ใช้ database transaction
- ป้องกัน duplicate submission จากการกดซ้ำบนมือถือ
- เก็บ createdAt และ updatedAt ใน transactional entities
- ใช้ soft delete หรือ active flag กับ master data ที่ถูกอ้างอิงแล้ว
- มี automated database backup ตามความสามารถของ hosting provider
- ส่งออก Customers, Orders, Inventory, Recipes และ Cycle Summaries เป็น CSV ได้

Offline-first ไม่อยู่ใน MVP ระบบต้องแจ้งเมื่อบันทึกไม่สำเร็จและไม่แสดงสถานะสำเร็จก่อน backend ยืนยัน

## 16. Testing Strategy

### 16.1 Unit Tests

- Unit conversion ภายใน dimension เดียวกัน
- Pack price เป็น unit cost
- Aggregation จากหลายออเดอร์
- Batch rounding และ manual override
- Recipe scaling
- Waste allowance
- Packaging rules ทุก consumption basis
- Material aggregation
- Stock shortfall และ suggested packs
- Recipe, product และ cycle costs
- Order subtotal, discount, delivery และ grand total
- Delivery subsidy และ gross profit
- Timeline date offsets
- Status rules และ lock validation

### 16.2 Integration Tests

เส้นทางหลัก:

`Create Cycle → Add Orders → Lock → Aggregate → Scale Recipes → Compare Inventory → Generate Shopping List → Generate Timeline → Complete Cycle`

ทดสอบการปลดล็อกและคำนวณใหม่ ทดสอบ snapshot ไม่เปลี่ยนตาม master data และทดสอบ rollback เมื่อการล็อกรอบล้มเหลวกลางทาง

### 16.3 UI and Responsive Tests

- เพิ่มออเดอร์จากมือถือ
- เพิ่มสินค้าหลายรายการในออเดอร์
- นับสต๊อกและบันทึกราคาซื้อ
- ดู production plan ระหว่างผลิต
- เปลี่ยน order และ task status
- ตารางสูตรและราคาใช้งานบนคอมพิวเตอร์
- Critical flow ที่ viewport มือถือและ desktop

## 17. ลำดับการพัฒนา

### Phase 1 — Foundation

- Project foundation
- Authentication
- Database and migrations
- Units and conversions
- Inventory items and price history
- Products, recipes, versions, and packaging rules
- Delivery methods and shop settings

ผลลัพธ์: เจ้าของร้านสร้าง master data ที่จำเป็นต่อการคำนวณได้

### Phase 2 — Core Vertical Workflow

- Customers
- Bake Cycles
- Orders and Order Items
- Order totals
- Cycle product aggregation
- Lock validation and snapshots

ผลลัพธ์: สร้างรอบ กรอกออเดอร์ และเห็นยอดสินค้าที่ต้องผลิตได้

### Phase 3 — Calculation and Shopping

- Batch calculation
- Recipe scaling
- Cost calculation
- Material and packaging aggregation
- Inventory count and movements
- Shopping list and purchase capture

ผลลัพธ์: ระบบตอบได้ว่าต้องผลิตกี่ batch ใช้วัตถุดิบเท่าไร และต้องซื้ออะไร

### Phase 4 — Operational Workflow

- Production Templates
- Generated Cycle Tasks
- Production, packing, payment, and delivery statuses
- Mobile operational views

ผลลัพธ์: เจ้าของร้านใช้ระบบเป็น checklist ระหว่างเตรียม ผลิต แพ็ก และส่งได้

### Phase 5 — Cycle Closure

- Final cost snapshot
- Revenue and gross profit summary
- CSV export
- Responsive polish
- Reliability and recovery verification

ผลลัพธ์: ปิดรอบและตรวจผลประกอบการพื้นฐานของรอบได้

## 18. Acceptance Criteria

MVP ถือว่าสำเร็จเมื่อ:

1. เจ้าของร้านกรอกออเดอร์จากหลายช่องทางได้ภายในระบบเดียว
2. ออเดอร์หนึ่งรายการมีสินค้าหลายชนิดและคำนวณยอดสุทธิถูกต้อง
3. Bake Cycle รวมยอดสินค้าจากออเดอร์ที่ไม่ถูกยกเลิกได้
4. ระบบเสนอ batch count โดยไม่ใช้ fractional batch โดยเงียบ ๆ
5. ระบบขยายสูตรและแปลงหน่วยถูกต้อง
6. ระบบรวมวัตถุดิบและบรรจุภัณฑ์ของทั้งรอบได้
7. ระบบเปรียบเทียบกับสต๊อกและสร้าง quantity to buy ได้
8. ระบบเสนอจำนวนแพ็กที่ควรซื้อเมื่อมี purchase pack size
9. ระบบสร้าง Timeline ย้อนหลังจากวันส่งตาม template ของสินค้าได้
10. ระบบแยก Payment Status และ Fulfillment Status
11. รอบที่ล็อกแล้วใช้ snapshot และไม่เปลี่ยนตามราคาหรือสูตรใหม่
12. ระบบแสดงต้นทุนไม่สมบูรณ์เมื่อข้อมูลราคาหาย
13. ระบบสรุปรายได้ ต้นทุน กำไร และสินค้าที่ขายของรอบได้
14. Critical workflow ใช้งานได้ทั้งมือถือและคอมพิวเตอร์
15. Business-critical calculations มี automated tests

## 19. ความเสี่ยงและแนวทางลดความเสี่ยง

### ความซับซ้อนของหน่วย

จำกัด MVP ให้แปลงเฉพาะหน่วยใน dimension เดียวกันและใช้ base unit ทุกครั้ง ไม่รองรับ density conversion อัตโนมัติ

### สต๊อกไม่ตรงกับของจริง

รองรับ physical count และ reconciliation ก่อนล็อกรอบ เก็บ movement history และไม่ทำ lot tracking ใน MVP

### ต้นทุนย้อนหลังเปลี่ยน

ใช้ effective price history และ snapshot ต้นทุนเมื่อรอบถูกล็อกหรือคำนวณใหม่

### Timeline ซับซ้อนเกินไป

MVP ใช้ offset days, default time และ sequence เท่านั้น Cycle Task แก้เองได้ ไม่ทำ dependency solver

### ขอบเขตบาน

ยึด acceptance criteria และ non-goals ทุกฟีเจอร์ใหม่ต้องตอบ pain point ของ Bake Cycle โดยตรงก่อนเข้าสู่ MVP

## 20. ส่วนขยายหลัง MVP

- Production dependencies และ capacity planning
- Inventory reservation ระหว่างหลาย Bake Cycles
- Lot และ expiry tracking
- Recipe density conversions
- Import ออเดอร์จาก social channels
- Shipping provider integrations
- Payment gateway
- Repeat customer rate และ average order value
- Margin by product และ best seller analytics
- Multi-user roles
- Offline-capable PWA
