/**
 * Data cleaning mapping — demonstrates passthrough, template, coalesce,
 * and the extended format options: titlecase, round, split, and join.
 *
 * passthrough copies all source fields to the output first; the fields
 * block then overrides specific keys with cleaned/transformed values.
 * internal_id is excluded from the passthrough entirely.
 *
 * Run with:
 *   node cli.js transform -d test-data-cleaning.json -m mapping-data-cleaning.js
 */
export default {
  id: "data-cleaning",

  // Copy every source field through except the internal identifier.
  // Fields defined below override the passthrough values.
  passthrough: { exclude: ["internal_id"] },

  fields: {
    // ── template: build a string from multiple source fields ─────────
    // {token} paths are resolved from the source row
    full_name: {
      template: "{first_name} {last_name}",
      format: "titlecase",
    },

    // ── template: formatted mailing address ─────────────────────────
    address: {
      template: "{street}, {city}, {state} {zip}",
      format: "titlecase",
    },

    // ── titlecase: normalise an individual field in-place ────────────
    city:  { from: "city",  format: "titlecase" },
    state: { from: "state", format: "uppercase" },

    // ── coalesce: first non-null phone wins; fallback to "N/A" ───────
    phone: {
      coalesce: ["mobile", "work_phone", "home_phone"],
      default: "N/A",
    },

    // ── split: convert a comma-separated string into an array ────────
    tag_list: {
      from: "tags",
      format: "split",
      separator: ",",
    },

    // ── join: convert an array into a readable string ────────────────
    keyword_str: {
      from: "keywords",
      format: "join",
      separator: " | ",
    },

    // ── round: trim floating-point noise ────────────────────────────
    price: { from: "price", format: "round", precision: 2 },
    score: { from: "score", format: "round", precision: 1 },
  },
};
