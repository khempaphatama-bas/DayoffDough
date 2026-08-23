import { describe, expect, it } from "vitest";
import { aggregateProductionDemand } from "./production-demand";

describe("cycle production demand", () => {
  it("groups products and excludes cancelled orders", () => {
    expect(aggregateProductionDemand([
      { productId: "p1", productName: "Focaccia", sellingUnit: "piece", quantity: 2, fulfillmentStatus: "NEW" },
      { productId: "p1", productName: "Focaccia", sellingUnit: "piece", quantity: 3, fulfillmentStatus: "PACKED" },
      { productId: "p2", productName: "Scone", sellingUnit: "kg", quantity: 4, fulfillmentStatus: "CANCELLED" },
      { productId: "p2", productName: "Scone", sellingUnit: "kg", quantity: 1, fulfillmentStatus: "CONFIRMED" },
    ])).toEqual([
      { productId: "p1", productName: "Focaccia", sellingUnit: "piece", quantity: 5 },
      { productId: "p2", productName: "Scone", sellingUnit: "kg", quantity: 1 },
    ]);
  });

  it("sorts demand by Thai product name", () => {
    expect(aggregateProductionDemand([
      { productId: "p2", productName: "เค้ก", sellingUnit: "piece", quantity: 1, fulfillmentStatus: "NEW" },
      { productId: "p1", productName: "ขนมปัง", sellingUnit: "g", quantity: 1, fulfillmentStatus: "NEW" },
      { productId: "p3", productName: "คุกกี้", sellingUnit: "piece", quantity: 1, fulfillmentStatus: "NEW" },
    ])).toEqual([
      { productId: "p1", productName: "ขนมปัง", sellingUnit: "g", quantity: 1 },
      { productId: "p3", productName: "คุกกี้", sellingUnit: "piece", quantity: 1 },
      { productId: "p2", productName: "เค้ก", sellingUnit: "piece", quantity: 1 },
    ]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(() => aggregateProductionDemand([
        {
          productId: "p1",
          productName: "Focaccia",
          sellingUnit: "piece",
          quantity,
          fulfillmentStatus: "NEW",
        },
      ])).toThrow();
    },
  );

  it("rejects a grouped quantity that exceeds the safe integer range", () => {
    expect(() => aggregateProductionDemand([
      {
        productId: "p1",
        productName: "Focaccia",
        sellingUnit: "piece",
        quantity: Number.MAX_SAFE_INTEGER,
        fulfillmentStatus: "NEW",
      },
      {
        productId: "p1",
        productName: "Focaccia",
        sellingUnit: "piece",
        quantity: 1,
        fulfillmentStatus: "PACKED",
      },
    ])).toThrow();
  });
});
