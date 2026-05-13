/**
 * Order summary mapping — demonstrates aggregation, filter, and sortBy.
 *
 * Aggregation reduces an array to a single value (sum, count, min, max, avg).
 * filter skips items that don't match a condition before transforming or aggregating.
 * sortBy orders the array before transforming (ascending or descending).
 *
 * Run with:
 *   node cli.js transform -d test-order-summary.json -m mapping-order-summary.js
 */
export default {
  id: "order-summary",
  fields: {
    order_id: { from: "order_id" },
    customer: { from: "customer" },

    // ── count: no from needed — counts array items ───────────────────
    item_count: {
      forEach: "items",
      aggregate: "count",
    },

    // ── sum: raw field — add up all qty values directly ──────────────
    total_qty: {
      forEach: "items",
      aggregate: "sum",
      from: "qty",
    },

    // ── sum + compute: derive a value per item, then sum ─────────────
    // subtotal = Σ (qty × unit_price)
    subtotal: {
      forEach: "items",
      aggregate: "sum",
      from: ["qty", "unit_price"],
      compute: (qty, price) => Math.round(qty * price * 100) / 100,
    },

    // ── sum + compute: apply a discount per item before summing ──────
    // total = Σ (qty × unit_price × (1 - discount_pct / 100))
    total_after_discount: {
      forEach: "items",
      aggregate: "sum",
      from: ["qty", "unit_price", "discount_pct"],
      compute: (qty, price, discountPct) => Math.round(qty * price * (1 - discountPct / 100) * 100) / 100,
    },

    // ── max: raw field — highest unit price across all items ─────────
    highest_unit_price: {
      forEach: "items",
      aggregate: "max",
      from: "unit_price",
    },

    // ── max + compute: highest individual line total ─────────────────
    highest_line_total: {
      forEach: "items",
      aggregate: "max",
      from: ["qty", "unit_price"],
      compute: (qty, price) => Math.round(qty * price * 100) / 100,
    },

    // ── min: raw field — lowest unit price across all items ──────────
    lowest_unit_price: {
      forEach: "items",
      aggregate: "min",
      from: "unit_price",
    },

    // ── avg: raw field — average qty ordered per line ────────────────
    avg_qty_per_line: {
      forEach: "items",
      aggregate: "avg",
      from: "qty",
    },

    // ── filter + aggregate: total savings from discounted items only ──
    total_discount_value: {
      forEach: "items",
      filter: { field: "discount_pct", op: "gt", value: 0 },
      aggregate: "sum",
      from: ["qty", "unit_price", "discount_pct"],
      compute: (qty, price, discountPct) => Math.round(qty * price * (discountPct / 100) * 100) / 100,
    },

    // ── filter + forEach: only items ordered in quantity > 1 ─────────
    bulk_items: {
      forEach: "items",
      filter: { field: "qty", op: "gt", value: 1 },
      fields: {
        sku: { from: "sku" },
        qty: { from: "qty" },
        line_total: {
          from: ["qty", "unit_price"],
          compute: (qty, price) => Math.round(qty * price * 100) / 100,
        },
      },
    },

    // ── sortBy: items listed cheapest first ──────────────────────────
    items_by_price: {
      forEach: "items",
      sortBy: "unit_price",
      fields: {
        sku:        { from: "sku" },
        unit_price: { from: "unit_price" },
        qty:        { from: "qty" },
      },
    },

    // ── sortBy desc: most expensive item first ───────────────────────
    items_by_price_desc: {
      forEach: "items",
      sortBy: { field: "unit_price", order: "desc" },
      fields: {
        sku:        { from: "sku" },
        unit_price: { from: "unit_price" },
      },
    },
  },
};
