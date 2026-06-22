/**
 * Data cleaning mapping — demonstrates passthrough, template, coalesce,
 * and the extended format options: titlecase, round, split, join,
 * truncate, replace, camelcase, snakecase, and kebabcase.
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

    // ── compute: formatted mailing address ──────────────────────────
    // compute is used here instead of template so each part can be
    // formatted independently — street/city titlecased, state uppercased.
    address: {
      from: ["street", "city", "state", "zip"],
      compute: (street, city, state, zip) => {
        const tc = s => String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        return `${tc(street)}, ${tc(city)}, ${String(state).toUpperCase()} ${zip}`;
      },
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

    // ── truncate: shorten long text with a suffix ────────────────────
    short_desc: {
      from: "description",
      format: "truncate",
      length: 40,
      suffix: "…",
    },

    // ── replace: strip non-digit characters from a phone number ─────
    phone_digits: {
      coalesce: ["mobile", "work_phone", "home_phone"],
      format: "replace",
      find: "\\D",
      replaceWith: "",
    },

    // ── casing formats: derive identifier variants from a name ───────
    api_key:   { from: "api_key_name",   format: "snakecase" },
    css_class: { from: "component_name", format: "kebabcase" },
    js_var:    { from: "component_name", format: "camelcase" },
  },
};
