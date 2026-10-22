import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FormErrors from "./FormErrors";

describe("FormErrors", () => {
  it("renders the _form error as an alert", () => {
    render(<FormErrors errors={{ _form: "Form is invalid." }} />);
    expect(screen.getByRole("alert").textContent).toBe("Form is invalid.");
  });

  it("renders nothing without a form-level error", () => {
    const { container } = render(<FormErrors errors={{ email: "bad" }} />);
    expect(container.innerHTML).toBe("");
  });
});
