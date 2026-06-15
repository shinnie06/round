import { z } from 'zod'

/**
 * Tier-1 validation: the LLM's JSON must parse against this before we
 * even look at the numbers. Zod for runtime, RECEIPT_JSON_SCHEMA for
 * LMStudio's constrained decoding (response_format json_schema strict) —
 * the two must describe the same shape.
 */
export const rawLineZod = z.object({
  name: z.string(),
  qty: z
    .number()
    .int()
    .min(1)
    .nullable()
    .transform((q) => q ?? 1),
  line_total: z.number().finite().min(0),
})

export const rawReceiptZod = z.object({
  venue: z.string().nullable(),
  items: z.array(rawLineZod),
  // signed: receipts print discounts as deductions ("10% Member -5.00") and
  // the model transcribes the sign; the magnitude is what we deduct.
  discount: z
    .number()
    .finite()
    .nullable()
    .transform((d) => (d === null ? null : Math.abs(d))),
  service_charge: z.number().finite().min(0).nullable(),
  gst: z.number().finite().min(0).nullable(),
  // signed: rounding lines go both ways; default null keeps older payloads valid
  rounding: z.number().finite().nullable().default(null),
  grand_total: z.number().finite().min(0).nullable(),
})

/** Plain JSON-Schema for LMStudio constrained decoding. All fields required,
 *  nullability via union types — strict mode rejects anything else. */
export const RECEIPT_JSON_SCHEMA = {
  name: 'receipt',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['venue', 'items', 'discount', 'service_charge', 'gst', 'rounding', 'grand_total'],
    properties: {
      venue: { type: ['string', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'qty', 'line_total'],
          properties: {
            name: { type: 'string' },
            qty: { type: ['integer', 'null'] },
            line_total: { type: 'number' },
          },
        },
      },
      discount: { type: ['number', 'null'] },
      service_charge: { type: ['number', 'null'] },
      gst: { type: ['number', 'null'] },
      rounding: { type: ['number', 'null'] },
      grand_total: { type: ['number', 'null'] },
    },
  },
} as const
