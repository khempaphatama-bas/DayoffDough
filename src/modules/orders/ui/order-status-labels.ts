import type {
  OrderDetail,
  OrderFulfillmentStatus,
} from "@/modules/orders/application/orders";

export const ORDER_PAYMENT_STATUS_LABELS: Readonly<
  Record<OrderDetail["paymentStatus"], string>
> = {
  UNPAID: "ยังไม่ชำระ",
  PARTIAL: "ชำระบางส่วน",
  PAID: "ชำระแล้ว",
  REFUNDED: "คืนเงินแล้ว",
};

export const ORDER_FULFILLMENT_STATUS_LABELS: Readonly<
  Record<OrderFulfillmentStatus, string>
> = {
  NEW: "ใหม่",
  CONFIRMED: "ยืนยันแล้ว",
  IN_PRODUCTION: "กำลังผลิต",
  PACKED: "แพ็กเสร็จแล้ว",
  DELIVERED: "จัดส่งแล้ว",
  CANCELLED: "ยกเลิก",
};
