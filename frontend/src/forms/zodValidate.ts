import { z } from "zod";

/** Reserved errors key for issues that are not tied to a single field (e.g. object-level refine). */
export const FORM_ERROR_KEY = "_form";

export type FormErrors<TValues extends object> = Partial<
  Record<keyof TValues | typeof FORM_ERROR_KEY, string>
>;

/**
 * Validates form values using a Zod schema.
 * Returns a map of fieldName -> first error message string. Issues with an
 * empty path are reported under the reserved `_form` key.
 */
export function zodValidate<TValues extends object>(
  schema: z.ZodSchema<TValues>,
  values: TValues
): FormErrors<TValues> {
  const result = schema.safeParse(values);
  if (result.success) {
    return {};
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const first = issue.path[0];
    const key = first === undefined ? FORM_ERROR_KEY : String(first);
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors as FormErrors<TValues>;
}

export default zodValidate;
