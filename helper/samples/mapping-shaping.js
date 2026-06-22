/**
 * Data shaping demo — demonstrates flatten and groupBy.
 *
 * The test data has stores, each with an orders array, and each order has
 * an items array. The two features work at different levels:
 *
 *   flatten  — collapses a nested array (orders → items) into a single flat
 *              list before iterating or aggregating.
 *
 *   groupBy  — reshapes a flat array into an object keyed by a field value.
 *              The output field becomes an object rather than an array.
 *
 * flatten and groupBy compose with each other and with filter, distinct,
 * sortBy, and aggregate. The pipeline order is:
 *   flatten → filter → distinct → sortBy → (transform | groupBy | aggregate)
 *
 * Run with:
 *   node cli.js transform -d test-shaping.json -m mapping-shaping.js
 */
export default {
  id: "data-shaping",

  fields: {
    store_id:   { from: "store_id" },
    store_name: { from: "store_name" },

    // ── groupBy: reshape the orders array by status ───────────────────
    // Output is an object keyed by status value; each key holds an array
    // of matching orders. fields transforms each order within its group.
    orders_by_status: {
      forEach: "orders",
      groupBy: "status",
      fields: {
        order_id:   { from: "order_id" },
        item_count: { forEach: "items", aggregate: "count" },
      },
    },

    // ── groupBy without fields: raw grouping, no per-item transform ───
    // Omitting fields returns raw source objects inside each group.
    order_ids_by_status: {
      forEach: "orders",
      groupBy: "status",
    },

    // ── flatten: collapse orders → items into one flat list ───────────
    // Each order contains an items array; flatten extracts all of those
    // arrays and concatenates them into a single list for this store.
    all_line_items: {
      forEach: "orders",
      flatten: "items",
      fields: {
        sku:      { from: "sku" },
        category: { from: "category" },
        qty:      { from: "qty",   format: "number" },
        price:    { from: "price", format: "round", precision: 2 },
      },
    },

    // ── flatten + filter ──────────────────────────────────────────────
    // Flatten first, then apply a filter to the combined item list.
    bulk_items: {
      forEach: "orders",
      flatten: "items",
      filter:  { field: "qty", op: "gt", value: 1 },
      fields: {
        sku:   { from: "sku" },
        qty:   { from: "qty", format: "number" },
        price: { from: "price", format: "round", precision: 2 },
      },
    },

    // ── flatten + distinct + sortBy ───────────────────────────────────
    // Unique SKUs that appear across all orders, sorted alphabetically.
    unique_skus: {
      forEach:  "orders",
      flatten:  "items",
      distinct: "sku",
      sortBy:   "sku",
      fields: {
        sku:      { from: "sku" },
        category: { from: "category" },
        price:    { from: "price", format: "round", precision: 2 },
      },
    },

    // ── flatten + aggregate ───────────────────────────────────────────
    // Aggregate across the flattened item list instead of the orders array.
    total_line_items: {
      forEach:   "orders",
      flatten:   "items",
      aggregate: "count",
    },

    total_revenue: {
      forEach:   "orders",
      flatten:   "items",
      aggregate: "sum",
      from:      ["qty", "price"],
      compute:   (qty, price) => qty * price,
      format:    "round",
      precision: 2,
    },

    // ── flatten + groupBy: flatten then group the result ──────────────
    // Flatten all items across all orders into one list, then group
    // those items by their category. The result is an object where each
    // key is a category name and the value is an array of line items.
    items_by_category: {
      forEach:  "orders",
      flatten:  "items",
      groupBy:  "category",
      fields: {
        sku:   { from: "sku" },
        qty:   { from: "qty",   format: "number" },
        price: { from: "price", format: "round", precision: 2 },
      },
    },

    // ── flatten + filter + groupBy ────────────────────────────────────
    // Filter the flattened items first, then group the qualifying subset.
    bulk_items_by_category: {
      forEach:  "orders",
      flatten:  "items",
      filter:   { field: "qty", op: "gt", value: 1 },
      groupBy:  "category",
      fields: {
        sku: { from: "sku" },
        qty: { from: "qty", format: "number" },
      },
    },
  },
};
