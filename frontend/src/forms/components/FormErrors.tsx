import type React from "react";
import { FORM_ERROR_KEY } from "../zodValidate";

export interface FormErrorsProps {
  errors: Partial<Record<string, string>>;
}

/** Renders the form-level (`_form`) validation error, if any. */
const FormErrors: React.FC<FormErrorsProps> = ({ errors }) => {
  const message = errors[FORM_ERROR_KEY];
  if (!message) return null;
  return (
    <div className="form-error form-error-form" role="alert">
      {message}
    </div>
  );
};

export default FormErrors;
