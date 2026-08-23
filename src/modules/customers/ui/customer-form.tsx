"use client";

import {
  startTransition,
  useActionState,
  type FormEvent,
} from "react";
import {
  createCustomerAction,
  type CustomerActionState,
  updateCustomerAction,
} from "@/app/(app)/customers/actions";
import type { Customer } from "@/modules/customers/application/customers";

type DeliveryMethodOption = Readonly<{
  id: string;
  name: string;
  active: boolean;
}>;

type CustomerFormProps = Readonly<{
  deliveryMethods: ReadonlyArray<DeliveryMethodOption>;
  customer?: Customer;
}>;

const INITIAL_STATE: CustomerActionState = {
  error: null,
  fieldErrors: {},
  saved: false,
};

function FieldErrors({
  errors,
}: Readonly<{ errors: ReadonlyArray<string> | undefined }>) {
  return errors?.map((error) => (
    <span className="text-sm font-normal text-red-700" key={error}>
      {error}
    </span>
  ));
}

export function CustomerForm({
  deliveryMethods,
  customer,
}: CustomerFormProps) {
  const action = customer ? updateCustomerAction : createCustomerAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form
      className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-2"
      onSubmit={submitCustomer}
    >
      {customer ? (
        <input name="customerId" type="hidden" value={customer.id} />
      ) : null}
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ชื่อลูกค้า
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={customer?.name ?? ""}
          name="name"
          required
        />
        <FieldErrors errors={state.fieldErrors.name} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        ช่องทางติดต่อ
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={customer?.contactHandle ?? ""}
          name="contactHandle"
          placeholder="เช่น @may หรือ LINE ID"
        />
        <FieldErrors errors={state.fieldErrors.contactHandle} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        เบอร์โทร
        <input
          className="min-h-11 rounded-xl border border-stone-300 px-4 text-base font-normal"
          defaultValue={customer?.phone ?? ""}
          inputMode="tel"
          name="phone"
          type="tel"
        />
        <FieldErrors errors={state.fieldErrors.phone} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700">
        วิธีส่งประจำ
        <select
          className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-base font-normal"
          defaultValue={customer?.defaultDeliveryMethodId ?? ""}
          name="defaultDeliveryMethodId"
        >
          <option value="">ยังไม่กำหนด</option>
          {deliveryMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}{method.active ? "" : " (ปิดใช้งาน)"}
            </option>
          ))}
        </select>
        <FieldErrors errors={state.fieldErrors.defaultDeliveryMethodId} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
        สถานที่จัดส่งประจำ
        <textarea
          className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal"
          defaultValue={customer?.defaultDeliveryLocation ?? ""}
          name="defaultDeliveryLocation"
        />
        <FieldErrors errors={state.fieldErrors.defaultDeliveryLocation} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
        หมายเหตุการส่งประจำ
        <textarea
          className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal"
          defaultValue={customer?.defaultDeliveryNote ?? ""}
          name="defaultDeliveryNote"
        />
        <FieldErrors errors={state.fieldErrors.defaultDeliveryNote} />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-stone-700 md:col-span-2">
        หมายเหตุลูกค้า
        <textarea
          className="min-h-20 rounded-xl border border-stone-300 px-4 py-3 text-base font-normal"
          defaultValue={customer?.notes ?? ""}
          name="notes"
        />
        <FieldErrors errors={state.fieldErrors.notes} />
      </label>
      {customer ? (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-stone-700 md:col-span-2">
          <input defaultChecked={customer.active} name="active" type="checkbox" />
          เปิดใช้งาน
        </label>
      ) : null}
      {state.error ? (
        <p
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 md:col-span-2"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 md:col-span-2"
        >
          บันทึกลูกค้าแล้ว
        </p>
      ) : null}
      <button
        className="min-h-11 rounded-xl bg-amber-800 px-5 font-semibold text-white disabled:opacity-60 md:col-span-2"
        disabled={pending}
        type="submit"
      >
        {pending
          ? "กำลังบันทึก…"
          : customer
            ? "บันทึกการแก้ไข"
            : "บันทึกลูกค้า"}
      </button>
    </form>
  );
}
