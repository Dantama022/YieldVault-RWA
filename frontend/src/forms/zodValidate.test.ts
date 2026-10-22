import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodValidate, FORM_ERROR_KEY } from "./zodValidate";

const schema = z
  .object({
    from: z.string().min(1, "From is required."),
    to: z.string().min(1, "To is required."),
  })
  .refine((v) => v.from !== v.to, { message: "From and To must differ." });

describe("zodValidate", () => {
  it("returns no errors for valid values", () => {
    expect(zodValidate(schema, { from: "a", to: "b" })).toEqual({});
  });

  it("reports object-level refine errors under _form", () => {
    expect(zodValidate(schema, { from: "a", to: "a" })).toEqual({
      [FORM_ERROR_KEY]: "From and To must differ.",
    });
  });

  it("reports field errors by path[0] and keeps the first message", () => {
    const errors = zodValidate(schema, { from: "", to: "b" });
    expect(errors.from).toBe("From is required.");
    expect(errors._form).toBeUndefined();
  });

  it("handles falsy index-0 path keys (array schemas)", () => {
    const arr = z.array(z.string().min(2, "Too short."));
    const errors = zodValidate(arr as unknown as z.ZodSchema<object>, ["a", "bb"]);
    expect((errors as Record<string, string>)["0"]).toBe("Too short.");
  });
});
