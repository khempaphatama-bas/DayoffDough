"use client";

import {
  startTransition,
  useActionState,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import type { createQuickCustomerAction } from "@/app/(app)/customers/actions";
import {
  saveOrderAction,
  type OrderActionState,
} from "@/app/(app)/orders/actions";
import type { OrderFormOptions } from "@/modules/orders/application/orders";
import {
  calculateOrderFormTotals,
  type OrderFormValues,
} from "@/modules/orders/domain/order-form";
import {
  formatSatangAsBaht,
  parseBahtToSatang,
} from "@/modules/money/domain/money";

type OrderFormProps = Readonly<{
  mode: "create" | "edit";
  options: OrderFormOptions;
  initialValues: OrderFormValues;
  orderId?: string;
  productionFrozen?: boolean;
  createQuickCustomer: typeof createQuickCustomerAction;
}>;

type CustomerOption = OrderFormOptions["customers"][number];

const INITIAL_ACTION_STATE: OrderActionState = {
  error: null,
  fieldErrors: {},
};

const PAYMENT_STATUS_LABELS = {
  UNPAID: "ยังไม่ชำระ",
  PARTIAL: "ชำระบางส่วน",
  PAID: "ชำระแล้ว",
} as const;

const INPUT_CLASS =
  "min-h-11 w-full min-w-0 max-w-full rounded-xl border border-stone-300 bg-white px-4 text-base font-normal";
const TEXTAREA_CLASS =
  "min-h-20 w-full min-w-0 max-w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base font-normal";

function FieldError({
  error,
}: Readonly<{ error: string | undefined }>) {
  return error ? (
    <span className="text-sm font-normal text-red-700">{error}</span>
  ) : null;
}

function blankItem(): OrderFormValues["items"][number] {
  return {
    productId: "",
    quantity: "1",
    unitPriceBaht: "0.00",
    lineNote: "",
  };
}

export function OrderForm({
  mode,
  options,
  initialValues,
  orderId,
  productionFrozen = false,
  createQuickCustomer,
}: OrderFormProps) {
  const [values, setValues] = useState<OrderFormValues>(initialValues);
  const [customerOptions, setCustomerOptions] = useState<
    ReadonlyArray<CustomerOption>
  >(options.customers);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({
    name: "",
    contactHandle: "",
    phone: "",
    defaultDeliveryMethodId: "",
    defaultDeliveryLocation: "",
    defaultDeliveryNote: "",
  });
  const [quickCustomerError, setQuickCustomerError] = useState<string | null>(
    null,
  );
  const [quickCustomerPending, startQuickCustomerTransition] = useTransition();
  const [state, formAction, savePending] = useActionState(
    saveOrderAction,
    INITIAL_ACTION_STATE,
  );

  const totals = calculateOrderFormTotals(values);
  const selectedMethod = options.deliveryMethods.find(
    (method) => method.id === values.deliveryMethodId,
  );
  const selectedCycle = options.bakeCycles.find(
    (cycle) => cycle.id === values.bakeCycleId,
  );
  const showAdvancedCycleWarning = !productionFrozen && (
    selectedCycle?.status === "IN_PRODUCTION" ||
    selectedCycle?.status === "COMPLETED"
  );
  const showMissingLocation = Boolean(
    !productionFrozen &&
      selectedMethod?.requiresDeliveryLocation &&
      values.deliveryLocation.trim() === "",
  );

  function updateValue<Key extends keyof OrderFormValues>(
    key: Key,
    value: OrderFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function selectCustomer(customerId: string, customer?: CustomerOption) {
    const selectedCustomer =
      customer ?? customerOptions.find((option) => option.id === customerId);
    if (!selectedCustomer) {
      updateValue("customerId", customerId);
      return;
    }
    const method = options.deliveryMethods.find(
      (option) => option.id === selectedCustomer.defaultDeliveryMethodId,
    );
    setValues((current) => ({
      ...current,
      customerId: selectedCustomer.id,
      deliveryMethodId: method?.id ?? "",
      deliveryLocation: selectedCustomer.defaultDeliveryLocation ?? "",
      deliveryNote: selectedCustomer.defaultDeliveryNote ?? "",
      deliveryFeeChargedBaht: method
        ? formatSatangAsBaht(method.defaultCustomerFeeSatang)
        : "0.00",
      deliveryCostBaht: method
        ? formatSatangAsBaht(method.defaultInternalCostSatang)
        : "0.00",
    }));
  }

  function selectDeliveryMethod(deliveryMethodId: string) {
    const method = options.deliveryMethods.find(
      (option) => option.id === deliveryMethodId,
    );
    setValues((current) => ({
      ...current,
      deliveryMethodId,
      deliveryFeeChargedBaht: method
        ? formatSatangAsBaht(method.defaultCustomerFeeSatang)
        : "0.00",
      deliveryCostBaht: method
        ? formatSatangAsBaht(method.defaultInternalCostSatang)
        : "0.00",
    }));
  }

  function updateItem(
    itemIndex: number,
    change: Partial<OrderFormValues["items"][number]>,
  ) {
    setValues((current) => ({
      ...current,
      items: current.items.map((item, index) =>
        index === itemIndex ? { ...item, ...change } : item,
      ),
    }));
  }

  function selectProduct(itemIndex: number, productId: string) {
    const product = options.products.find((option) => option.id === productId);
    updateItem(itemIndex, {
      productId,
      ...(product
        ? { unitPriceBaht: formatSatangAsBaht(product.defaultUnitPriceSatang) }
        : {}),
    });
  }

  function createCustomerInline() {
    setQuickCustomerError(null);
    startQuickCustomerTransition(async () => {
      const result = await createQuickCustomer({
        name: quickCustomer.name,
        contactHandle: quickCustomer.contactHandle,
        phone: quickCustomer.phone,
        defaultDeliveryMethodId:
          quickCustomer.defaultDeliveryMethodId === ""
            ? null
            : quickCustomer.defaultDeliveryMethodId,
        defaultDeliveryLocation: quickCustomer.defaultDeliveryLocation,
        defaultDeliveryNote: quickCustomer.defaultDeliveryNote,
        notes: "",
      });
      if (!result.ok) {
        setQuickCustomerError(result.error);
        return;
      }
      const customer: CustomerOption = {
        id: result.customer.id,
        name: result.customer.name,
        contactHandle: result.customer.contactHandle,
        phone: result.customer.phone,
        defaultDeliveryMethodId: result.customer.defaultDeliveryMethodId,
        defaultDeliveryLocation: result.customer.defaultDeliveryLocation,
        defaultDeliveryNote: result.customer.defaultDeliveryNote,
        active: result.customer.active,
      };
      setCustomerOptions((current) => [...current, customer]);
      selectCustomer(customer.id, customer);
      setShowQuickCustomer(false);
      setQuickCustomer({
        name: "",
        contactHandle: "",
        phone: "",
        defaultDeliveryMethodId: "",
        defaultDeliveryLocation: "",
        defaultDeliveryNote: "",
      });
    });
  }

  function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const saveLabel = productionFrozen
    ? "บันทึกยอดชำระ"
    : mode === "edit"
      ? "บันทึกการแก้ไข"
      : "บันทึกออเดอร์";

  return (
    <form className="grid w-full min-w-0 max-w-full gap-6 pb-24 md:pb-0 [&_article]:min-w-0 [&_label]:min-w-0 [&_section]:min-w-0" onSubmit={submitOrder}>
      <input name="payload" type="hidden" value={JSON.stringify(values)} />
      {orderId ? <input name="orderId" type="hidden" value={orderId} /> : null}

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <div className="grid gap-3 md:col-span-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-2 text-sm font-semibold text-stone-700">
            ลูกค้า
            <select
              className={INPUT_CLASS}
              disabled={productionFrozen}
              onChange={(event) => selectCustomer(event.target.value)}
              required
              value={values.customerId}
            >
              <option value="">เลือกลูกค้า</option>
              {customerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}{customer.active ? "" : " (ปิดใช้งาน)"}
                </option>
              ))}
            </select>
            <FieldError error={state.fieldErrors.customerId} />
          </label>
          <button
            className="min-h-11 rounded-xl border border-amber-800 px-5 font-semibold text-amber-900"
            disabled={productionFrozen}
            onClick={() => setShowQuickCustomer((current) => !current)}
            type="button"
          >
            สร้างลูกค้าใหม่
          </button>
        </div>

        {showQuickCustomer ? (
          <div className="grid gap-4 rounded-2xl bg-amber-50 p-4 md:col-span-2 md:grid-cols-2">
            <h2 className="text-lg font-bold text-stone-900 md:col-span-2">
              สร้างลูกค้าใหม่แบบด่วน
            </h2>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              ชื่อลูกค้าใหม่
              <input
                className={INPUT_CLASS}
                onChange={(event) =>
                  setQuickCustomer((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={quickCustomer.name}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              ช่องทางติดต่อลูกค้าใหม่
              <input
                className={INPUT_CLASS}
                onChange={(event) =>
                  setQuickCustomer((current) => ({
                    ...current,
                    contactHandle: event.target.value,
                  }))
                }
                value={quickCustomer.contactHandle}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              เบอร์โทรลูกค้าใหม่
              <input
                className={INPUT_CLASS}
                inputMode="tel"
                onChange={(event) =>
                  setQuickCustomer((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                value={quickCustomer.phone}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              วิธีส่งประจำของลูกค้าใหม่
              <select
                className={INPUT_CLASS}
                onChange={(event) =>
                  setQuickCustomer((current) => ({
                    ...current,
                    defaultDeliveryMethodId: event.target.value,
                  }))
                }
                value={quickCustomer.defaultDeliveryMethodId}
              >
                <option value="">ยังไม่กำหนด</option>
                {options.deliveryMethods.map((method) => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
              สถานที่จัดส่งประจำของลูกค้าใหม่
              <textarea
                className={TEXTAREA_CLASS}
                onChange={(event) =>
                  setQuickCustomer((current) => ({
                    ...current,
                    defaultDeliveryLocation: event.target.value,
                  }))
                }
                value={quickCustomer.defaultDeliveryLocation}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
              หมายเหตุการส่งประจำของลูกค้าใหม่
              <textarea
                className={TEXTAREA_CLASS}
                onChange={(event) =>
                  setQuickCustomer((current) => ({
                    ...current,
                    defaultDeliveryNote: event.target.value,
                  }))
                }
                value={quickCustomer.defaultDeliveryNote}
              />
            </label>
            {quickCustomerError ? (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2" role="alert">
                {quickCustomerError}
              </p>
            ) : null}
            <button
              className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2"
              disabled={quickCustomerPending || quickCustomer.name.trim() === ""}
              onClick={createCustomerInline}
              type="button"
            >
              {quickCustomerPending ? "กำลังบันทึก…" : "บันทึกลูกค้าใหม่"}
            </button>
          </div>
        ) : null}

        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          รอบผลิต
          <select
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("bakeCycleId", event.target.value)}
            required
            value={values.bakeCycleId}
          >
            <option value="">เลือกรอบผลิต</option>
            {options.bakeCycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                #{cycle.cycleNumber} {cycle.name}{["DRAFT", "OPEN"].includes(cycle.status) ? "" : ` (${cycle.status})`}
              </option>
            ))}
          </select>
          <FieldError error={state.fieldErrors.bakeCycleId} />
        </label>
        {showAdvancedCycleWarning ? (
          <p
            aria-live="polite"
            className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 md:col-span-2"
          >
            รอบผลิตนี้เริ่มผลิตหรือเสร็จสิ้นแล้ว กรุณาตรวจสอบก่อนแก้ไขออเดอร์
          </p>
        ) : null}
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ช่องทางออเดอร์
          <select
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) =>
              updateValue(
                "sourceChannel",
                event.target.value as OrderFormValues["sourceChannel"],
              )
            }
            value={values.sourceChannel}
          >
            <option value="">ยังไม่ระบุ</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
            <option value="PHONE">โทรศัพท์</option>
            <option value="OTHER">อื่น ๆ</option>
          </select>
          <FieldError error={state.fieldErrors.sourceChannel} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          วันส่งที่ลูกค้าขอ
          <input
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("requestedDeliveryDate", event.target.value)}
            type="date"
            value={values.requestedDeliveryDate}
          />
          <FieldError error={state.fieldErrors.requestedDeliveryDate} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          วันส่งยืนยัน
          <input
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("confirmedDeliveryDate", event.target.value)}
            type="date"
            value={values.confirmedDeliveryDate}
          />
          <FieldError error={state.fieldErrors.confirmedDeliveryDate} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          เวลานัดส่ง
          <input
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("confirmedDeliveryTime", event.target.value)}
            type="time"
            value={values.confirmedDeliveryTime}
          />
          <FieldError error={state.fieldErrors.confirmedDeliveryTime} />
        </label>
      </section>

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-stone-900">รายการสินค้า</h2>
          <button
            className="min-h-11 rounded-xl border border-amber-800 px-4 font-semibold text-amber-900"
            disabled={productionFrozen}
            onClick={() =>
              setValues((current) => ({
                ...current,
                items: [...current.items, blankItem()],
              }))
            }
            type="button"
          >
            เพิ่มรายการสินค้า
          </button>
        </div>
        {values.items.map((item, itemIndex) => (
          <article
            className="grid gap-4 rounded-2xl bg-stone-50 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(7rem,.5fr)_minmax(9rem,.65fr)]"
            key={itemIndex}
          >
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              สินค้า รายการที่ {itemIndex + 1}
              <select
                className={INPUT_CLASS}
                disabled={productionFrozen}
                onChange={(event) => selectProduct(itemIndex, event.target.value)}
                required
                value={item.productId}
              >
                <option value="">เลือกสินค้า</option>
                {options.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}{product.active ? "" : " (ปิดใช้งาน)"}
                  </option>
                ))}
              </select>
              <FieldError error={state.fieldErrors[`items.${itemIndex}.productId`]} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              จำนวน รายการที่ {itemIndex + 1}
              <input
                className={INPUT_CLASS}
                disabled={productionFrozen}
                inputMode="numeric"
                min="1"
                onChange={(event) => updateItem(itemIndex, { quantity: event.target.value })}
                required
                type="number"
                value={item.quantity}
              />
              <FieldError error={state.fieldErrors[`items.${itemIndex}.quantity`]} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700">
              ราคาต่อหน่วย รายการที่ {itemIndex + 1} (บาท)
              <input
                className={INPUT_CLASS}
                disabled={productionFrozen}
                inputMode="decimal"
                onChange={(event) => updateItem(itemIndex, { unitPriceBaht: event.target.value })}
                required
                value={item.unitPriceBaht}
              />
              <FieldError error={state.fieldErrors[`items.${itemIndex}.unitPriceBaht`]} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
              หมายเหตุสินค้า รายการที่ {itemIndex + 1}
              <input
                className={INPUT_CLASS}
                disabled={productionFrozen}
                onChange={(event) => updateItem(itemIndex, { lineNote: event.target.value })}
                value={item.lineNote}
              />
              <FieldError error={state.fieldErrors[`items.${itemIndex}.lineNote`]} />
            </label>
            <button
              className="min-h-11 self-end rounded-xl border border-red-300 px-4 font-semibold text-red-800 disabled:opacity-50"
              disabled={productionFrozen || values.items.length === 1}
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  items: current.items.filter((_, index) => index !== itemIndex),
                }))
              }
              type="button"
            >
              ลบรายการที่ {itemIndex + 1}
            </button>
          </article>
        ))}
        <FieldError error={state.fieldErrors.items} />
      </section>

      <section className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <h2 className="text-xl font-bold text-stone-900 md:col-span-2">การจัดส่งและยอดเงิน</h2>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          วิธีจัดส่ง
          <select
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) => selectDeliveryMethod(event.target.value)}
            value={values.deliveryMethodId}
          >
            <option value="">ยังไม่กำหนด</option>
            {options.deliveryMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}{method.active ? "" : " (ปิดใช้งาน)"}
              </option>
            ))}
          </select>
          <FieldError error={state.fieldErrors.deliveryMethodId} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ผู้รับภาระค่าส่ง
          <select
            className={INPUT_CLASS}
            disabled={productionFrozen}
            onChange={(event) =>
              updateValue(
                "deliveryFeePayer",
                event.target.value as OrderFormValues["deliveryFeePayer"],
              )
            }
            value={values.deliveryFeePayer}
          >
            <option value="CUSTOMER">ลูกค้า</option>
            <option value="BAKERY">ร้าน</option>
            <option value="SHARED">แบ่งกัน</option>
          </select>
          <FieldError error={state.fieldErrors.deliveryFeePayer} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ค่าส่งที่เรียกเก็บ (บาท)
          <input
            className={INPUT_CLASS}
            disabled={productionFrozen}
            inputMode="decimal"
            onChange={(event) => updateValue("deliveryFeeChargedBaht", event.target.value)}
            required
            value={values.deliveryFeeChargedBaht}
          />
          <FieldError error={state.fieldErrors.deliveryFeeChargedBaht} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ต้นทุนจัดส่ง (บาท)
          <input
            className={INPUT_CLASS}
            disabled={productionFrozen}
            inputMode="decimal"
            onChange={(event) => updateValue("deliveryCostBaht", event.target.value)}
            required
            value={values.deliveryCostBaht}
          />
          <FieldError error={state.fieldErrors.deliveryCostBaht} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ส่วนลด (บาท)
          <input
            className={INPUT_CLASS}
            disabled={productionFrozen}
            inputMode="decimal"
            onChange={(event) => updateValue("discountBaht", event.target.value)}
            required
            value={values.discountBaht}
          />
          <FieldError error={state.fieldErrors.discountBaht} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700">
          ยอดชำระแล้ว (บาท)
          <input
            className={INPUT_CLASS}
            inputMode="decimal"
            onChange={(event) => updateValue("amountPaidBaht", event.target.value)}
            required
            value={values.amountPaidBaht}
          />
          <FieldError error={state.fieldErrors.amountPaidBaht} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
          สถานที่จัดส่ง
          <textarea
            className={TEXTAREA_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("deliveryLocation", event.target.value)}
            value={values.deliveryLocation}
          />
          <FieldError error={state.fieldErrors.deliveryLocation} />
        </label>
        {showMissingLocation ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
            กรุณาระบุสถานที่จัดส่ง
          </p>
        ) : null}
        <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
          หมายเหตุการส่ง
          <textarea
            className={TEXTAREA_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("deliveryNote", event.target.value)}
            value={values.deliveryNote}
          />
          <FieldError error={state.fieldErrors.deliveryNote} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
          คำสั่งพิเศษ
          <textarea
            className={TEXTAREA_CLASS}
            disabled={productionFrozen}
            onChange={(event) => updateValue("specialInstructions", event.target.value)}
            value={values.specialInstructions}
          />
          <FieldError error={state.fieldErrors.specialInstructions} />
        </label>
      </section>

      <section className="grid gap-3 rounded-3xl bg-stone-900 p-5 text-white sm:grid-cols-2">
        <h2 className="text-xl font-bold sm:col-span-2">สรุปออเดอร์</h2>
        {totals ? (
          <>
            <p>ยอดสินค้า ฿{formatSatangAsBaht(totals.subtotalSatang)}</p>
            <p>ส่วนลด ฿{formatSatangAsBaht(parseBahtToSatang(values.discountBaht))}</p>
            <p>ค่าส่ง ฿{formatSatangAsBaht(parseBahtToSatang(values.deliveryFeeChargedBaht))}</p>
            <p className="font-bold">ยอดสุทธิ ฿{formatSatangAsBaht(totals.grandTotalSatang)}</p>
            <p>คงเหลือ ฿{formatSatangAsBaht(totals.balanceSatang)}</p>
            <p className="font-semibold">{PAYMENT_STATUS_LABELS[totals.paymentStatus]}</p>
            {totals.overpaidSatang > 0 ? (
              <p className="rounded-xl bg-amber-100 px-4 py-3 text-amber-950 sm:col-span-2">
                รับชำระเกิน ฿{formatSatangAsBaht(totals.overpaidSatang)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-stone-300 sm:col-span-2">กรอกข้อมูลสินค้าและยอดเงินให้ครบเพื่อดูสรุป</p>
        )}
      </section>

      {state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="hidden md:block">
        <button
          className="min-h-12 w-full rounded-xl bg-amber-800 px-6 text-lg font-bold text-white disabled:opacity-60"
          disabled={savePending}
          type="submit"
        >
          {savePending ? "กำลังบันทึก…" : saveLabel}
        </button>
      </div>
      <div className="sticky bottom-20 z-20 -mx-5 border-t border-stone-200 bg-stone-50/95 p-4 backdrop-blur md:hidden">
        <button
          className="min-h-12 w-full rounded-xl bg-amber-800 px-6 text-lg font-bold text-white disabled:opacity-60"
          disabled={savePending}
          type="submit"
        >
          {savePending ? "กำลังบันทึก…" : saveLabel}
        </button>
      </div>
    </form>
  );
}
