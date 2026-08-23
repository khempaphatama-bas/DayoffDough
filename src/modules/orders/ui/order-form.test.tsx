import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickCustomerResult } from "@/app/(app)/customers/actions";
import type { OrderFormOptions } from "@/modules/orders/application/orders";
import type { OrderFormValues } from "@/modules/orders/domain/order-form";

const actions = vi.hoisted(() => ({ saveOrderAction: vi.fn() }));

vi.mock("@/app/(app)/orders/actions", () => ({
  saveOrderAction: actions.saveOrderAction,
}));

import { OrderForm } from "./order-form";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000010";
const CUSTOMER_WITH_UNAVAILABLE_DEFAULT_ID = "00000000-0000-4000-8000-000000000012";
const CYCLE_ID = "00000000-0000-4000-8000-000000000020";
const ADVANCED_CYCLE_ID = "00000000-0000-4000-8000-000000000021";
const KEX_ID = "00000000-0000-4000-8000-000000000030";
const PICKUP_ID = "00000000-0000-4000-8000-000000000031";
const UNAVAILABLE_METHOD_ID = "00000000-0000-4000-8000-000000000032";
const FOCACCIA_ID = "00000000-0000-4000-8000-000000000040";
const SCONE_ID = "00000000-0000-4000-8000-000000000050";

const OPTIONS: OrderFormOptions = {
  customers: [
    {
      id: CUSTOMER_ID,
      name: "คุณเมย์",
      contactHandle: "@may",
      phone: "0812345678",
      defaultDeliveryMethodId: KEX_ID,
      defaultDeliveryLocation: null,
      defaultDeliveryNote: "โทรก่อนส่ง",
      active: true,
    },
  ],
  products: [
    {
      id: FOCACCIA_ID,
      name: "Focaccia",
      defaultUnitPriceSatang: 22000,
      active: true,
    },
    {
      id: SCONE_ID,
      name: "Scone",
      defaultUnitPriceSatang: 8000,
      active: true,
    },
  ],
  deliveryMethods: [
    {
      id: KEX_ID,
      name: "KEX Same Day",
      defaultCustomerFeeSatang: 12000,
      defaultInternalCostSatang: 12000,
      requiresDeliveryLocation: true,
      active: true,
    },
    {
      id: PICKUP_ID,
      name: "รับเอง",
      defaultCustomerFeeSatang: 0,
      defaultInternalCostSatang: 0,
      requiresDeliveryLocation: false,
      active: true,
    },
  ],
  bakeCycles: [
    {
      id: CYCLE_ID,
      cycleNumber: 12,
      name: "รอบส่ง 30 ส.ค.",
      status: "DRAFT",
      targetProductionDate: "2026-08-29",
      primaryDeliveryDate: "2026-08-30",
    },
  ],
};

const INITIAL_VALUES: OrderFormValues = {
  customerId: "",
  bakeCycleId: CYCLE_ID,
  sourceChannel: "",
  requestedDeliveryDate: "",
  confirmedDeliveryDate: "",
  deliveryMethodId: "",
  deliveryFeeChargedBaht: "0.00",
  deliveryCostBaht: "0.00",
  deliveryFeePayer: "CUSTOMER",
  discountBaht: "0.00",
  amountPaidBaht: "0.00",
  deliveryLocation: "",
  deliveryNote: "",
  specialInstructions: "",
  items: [
    { productId: "", quantity: "1", unitPriceBaht: "0.00", lineNote: "" },
  ],
};

function successfulQuickCustomer(): Promise<QuickCustomerResult> {
  return Promise.resolve({
    ok: true,
    customer: {
      id: "00000000-0000-4000-8000-000000000011",
      ownerId: "00000000-0000-4000-8000-000000000001",
      name: "คุณแอน",
      contactHandle: null,
      phone: null,
      defaultDeliveryMethodId: null,
      defaultDeliveryLocation: null,
      defaultDeliveryNote: null,
      notes: null,
      active: true,
    },
  });
}

describe("OrderForm", () => {
  beforeEach(() => {
    actions.saveOrderAction.mockReset();
  });

  it("applies customer, product, and delivery defaults and shows live totals", async () => {
    actions.saveOrderAction.mockResolvedValue({ error: null, fieldErrors: {} });
    const user = userEvent.setup();
    render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={INITIAL_VALUES}
        mode="create"
        options={OPTIONS}
      />,
    );

    await user.selectOptions(screen.getByLabelText("ลูกค้า"), CUSTOMER_ID);
    expect(screen.getByLabelText("วิธีจัดส่ง")).toHaveValue(KEX_ID);
    expect(screen.getByLabelText("ค่าส่งที่เรียกเก็บ (บาท)")).toHaveValue("120.00");
    expect(screen.getByText("กรุณาระบุสถานที่จัดส่ง")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("สินค้า รายการที่ 1"), FOCACCIA_ID);
    await user.clear(screen.getByLabelText("จำนวน รายการที่ 1"));
    await user.type(screen.getByLabelText("จำนวน รายการที่ 1"), "2");
    await user.click(screen.getByRole("button", { name: "เพิ่มรายการสินค้า" }));
    await user.selectOptions(screen.getByLabelText("สินค้า รายการที่ 2"), SCONE_ID);
    await user.clear(screen.getByLabelText("ส่วนลด (บาท)"));
    await user.type(screen.getByLabelText("ส่วนลด (บาท)"), "20");
    await user.clear(screen.getByLabelText("ยอดชำระแล้ว (บาท)"));
    await user.type(screen.getByLabelText("ยอดชำระแล้ว (บาท)"), "200");

    expect(screen.getByText("ยอดสินค้า ฿520.00")).toBeInTheDocument();
    expect(screen.getByText("ส่วนลด ฿20.00")).toBeInTheDocument();
    expect(screen.getByText("ค่าส่ง ฿120.00")).toBeInTheDocument();
    expect(screen.getByText("ยอดสุทธิ ฿620.00")).toBeInTheDocument();
    expect(screen.getByText("ชำระบางส่วน")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("วิธีจัดส่ง"), PICKUP_ID);
    expect(screen.queryByText("กรุณาระบุสถานที่จัดส่ง")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ค่าส่งที่เรียกเก็บ (บาท)")).toHaveValue("0.00");
  });

  it("ignores a customer delivery default that is unavailable in create options", async () => {
    actions.saveOrderAction.mockResolvedValue({ error: null, fieldErrors: {} });
    const user = userEvent.setup();
    const { container } = render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={INITIAL_VALUES}
        mode="create"
        options={{
          ...OPTIONS,
          customers: [
            ...OPTIONS.customers,
            {
              id: CUSTOMER_WITH_UNAVAILABLE_DEFAULT_ID,
              name: "คุณนิด",
              contactHandle: null,
              phone: null,
              defaultDeliveryMethodId: UNAVAILABLE_METHOD_ID,
              defaultDeliveryLocation: "ลาดพร้าว กรุงเทพฯ",
              defaultDeliveryNote: "ฝาก รปภ.",
              active: true,
            },
          ],
        }}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("ลูกค้า"),
      CUSTOMER_WITH_UNAVAILABLE_DEFAULT_ID,
    );

    expect(screen.getByLabelText("วิธีจัดส่ง")).toHaveValue("");
    const payload = container.querySelector<HTMLInputElement>(
      'input[name="payload"]',
    );
    expect(payload).not.toBeNull();
    expect(JSON.parse(payload!.value)).toMatchObject({
      customerId: CUSTOMER_WITH_UNAVAILABLE_DEFAULT_ID,
      deliveryMethodId: "",
      deliveryFeeChargedBaht: "0.00",
      deliveryCostBaht: "0.00",
      deliveryLocation: "ลาดพร้าว กรุงเทพฯ",
      deliveryNote: "ฝาก รปภ.",
    });
  });

  it("creates and selects an inline customer without resetting order lines", async () => {
    actions.saveOrderAction.mockResolvedValue({ error: null, fieldErrors: {} });
    const createQuickCustomer = vi.fn(successfulQuickCustomer);
    const user = userEvent.setup();
    render(
      <OrderForm
        createQuickCustomer={createQuickCustomer}
        initialValues={{
          ...INITIAL_VALUES,
          items: [{ ...INITIAL_VALUES.items[0]!, productId: FOCACCIA_ID, quantity: "3" }],
        }}
        mode="create"
        options={OPTIONS}
      />,
    );

    await user.selectOptions(screen.getByLabelText("ลูกค้า"), CUSTOMER_ID);
    expect(screen.getByLabelText("ค่าส่งที่เรียกเก็บ (บาท)")).toHaveValue("120.00");
    await user.click(screen.getByRole("button", { name: "สร้างลูกค้าใหม่" }));
    await user.type(screen.getByLabelText("ชื่อลูกค้าใหม่"), "คุณแอน");
    await user.click(screen.getByRole("button", { name: "บันทึกลูกค้าใหม่" }));

    expect(await screen.findByRole("option", { name: "คุณแอน" })).toBeInTheDocument();
    expect(screen.getByLabelText("ลูกค้า")).toHaveValue(
      "00000000-0000-4000-8000-000000000011",
    );
    expect(screen.getByLabelText("สินค้า รายการที่ 1")).toHaveValue(FOCACCIA_ID);
    expect(screen.getByLabelText("จำนวน รายการที่ 1")).toHaveValue(3);
    expect(screen.getByLabelText("วิธีจัดส่ง")).toHaveValue("");
    expect(screen.getByLabelText("ค่าส่งที่เรียกเก็บ (บาท)")).toHaveValue("0.00");
  });

  it("renders two-decimal baht strings without floating-point display errors", () => {
    actions.saveOrderAction.mockResolvedValue({ error: null, fieldErrors: {} });
    render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={{
          ...INITIAL_VALUES,
          customerId: CUSTOMER_ID,
          deliveryFeeChargedBaht: "2.22",
          discountBaht: "1.11",
          items: [{
            ...INITIAL_VALUES.items[0]!,
            productId: FOCACCIA_ID,
            unitPriceBaht: "220.00",
          }],
        }}
        mode="create"
        options={OPTIONS}
      />,
    );

    expect(screen.getByText("ส่วนลด ฿1.11")).toBeInTheDocument();
    expect(screen.getByText("ค่าส่ง ฿2.22")).toBeInTheDocument();
  });

  it("does not let an unused quick-customer panel block a valid order submission", async () => {
    actions.saveOrderAction.mockResolvedValue({
      error: "บันทึกออเดอร์ไม่สำเร็จ กรุณาตรวจสอบข้อมูล",
      fieldErrors: {},
    });
    const user = userEvent.setup();
    render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={{
          ...INITIAL_VALUES,
          customerId: CUSTOMER_ID,
          items: [{
            ...INITIAL_VALUES.items[0]!,
            productId: FOCACCIA_ID,
            unitPriceBaht: "220.00",
          }],
        }}
        mode="create"
        options={OPTIONS}
      />,
    );

    await user.click(screen.getByRole("button", { name: "สร้างลูกค้าใหม่" }));
    await user.click(screen.getAllByRole("button", { name: "บันทึกออเดอร์" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกออเดอร์ไม่สำเร็จ");
    expect(actions.saveOrderAction).toHaveBeenCalledOnce();
  });

  it("keeps controlled values after an expected error and disables duplicate submission", async () => {
    let resolveAction: ((value: { error: string; fieldErrors: Record<string, string> }) => void) | undefined;
    actions.saveOrderAction.mockImplementation(
      () => new Promise((resolve) => { resolveAction = resolve; }),
    );
    const user = userEvent.setup();
    render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={{
          ...INITIAL_VALUES,
          customerId: CUSTOMER_ID,
          items: [{
            ...INITIAL_VALUES.items[0]!,
            productId: FOCACCIA_ID,
            unitPriceBaht: "220.00",
          }],
        }}
        mode="create"
        options={OPTIONS}
      />,
    );

    const quantity = screen.getByLabelText("จำนวน รายการที่ 1");
    await user.clear(quantity);
    await user.type(quantity, "7");
    const saveButtons = screen.getAllByRole("button", { name: "บันทึกออเดอร์" });
    fireEvent.click(saveButtons[0]!);

    await waitFor(() => expect(saveButtons[0]).toBeDisabled());
    fireEvent.click(saveButtons[0]!);
    expect(actions.saveOrderAction).toHaveBeenCalledTimes(1);

    resolveAction?.({
      error: "บันทึกออเดอร์ไม่สำเร็จ กรุณาตรวจสอบข้อมูล",
      fieldErrors: { "items.0.quantity": "จำนวนสินค้าไม่ถูกต้อง" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "บันทึกออเดอร์ไม่สำเร็จ",
    );
    expect(screen.getByText("จำนวนสินค้าไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /^จำนวน รายการที่ 1/ }))
      .toHaveValue(7);
  });

  it("keeps an excessive discount and renders its Thai field error adjacent", async () => {
    actions.saveOrderAction.mockResolvedValue({
      error: "กรุณาตรวจสอบข้อมูลออเดอร์",
      fieldErrors: {
        discountBaht: "ส่วนลดต้องไม่เกินยอดสินค้าและค่าส่ง",
      },
    });
    const user = userEvent.setup();
    render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={{
          ...INITIAL_VALUES,
          customerId: CUSTOMER_ID,
          items: [{
            ...INITIAL_VALUES.items[0]!,
            productId: FOCACCIA_ID,
            unitPriceBaht: "220.00",
          }],
        }}
        mode="create"
        options={OPTIONS}
      />,
    );

    const discount = screen.getByLabelText("ส่วนลด (บาท)");
    await user.clear(discount);
    await user.type(discount, "1000");
    await user.click(
      screen.getAllByRole("button", { name: "บันทึกออเดอร์" })[0]!,
    );

    expect(await screen.findByText("ส่วนลดต้องไม่เกินยอดสินค้าและค่าส่ง"))
      .toBeInTheDocument();
    expect(discount.closest("label")).toHaveTextContent(
      "ส่วนลดต้องไม่เกินยอดสินค้าและค่าส่ง",
    );
    expect(discount).toHaveValue("1000");
  });

  it("warns for advanced cycles and updates when the selected cycle changes", async () => {
    actions.saveOrderAction.mockResolvedValue({ error: null, fieldErrors: {} });
    const user = userEvent.setup();
    render(
      <OrderForm
        createQuickCustomer={successfulQuickCustomer}
        initialValues={INITIAL_VALUES}
        mode="edit"
        options={{
          ...OPTIONS,
          bakeCycles: [
            ...OPTIONS.bakeCycles,
            {
              id: ADVANCED_CYCLE_ID,
              cycleNumber: 13,
              name: "รอบที่กำลังผลิต",
              status: "IN_PRODUCTION",
              targetProductionDate: "2026-09-05",
              primaryDeliveryDate: "2026-09-06",
            },
          ],
        }}
        orderId="00000000-0000-4000-8000-000000000060"
      />,
    );

    const warning =
      "รอบผลิตนี้เริ่มผลิตหรือเสร็จสิ้นแล้ว กรุณาตรวจสอบก่อนแก้ไขออเดอร์";
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("รอบผลิต"),
      ADVANCED_CYCLE_ID,
    );
    expect(screen.getByText(warning)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("รอบผลิต"), CYCLE_ID);
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });
});
