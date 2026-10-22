import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnboardingWalkthrough from "./OnboardingWalkthrough";

describe("OnboardingWalkthrough storage", () => {
  beforeEach(() => localStorage.clear());

  it("shows when unseen and persists dismissal as a v1 envelope", () => {
    const { container } = render(<OnboardingWalkthrough />);
    expect(container.firstChild).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(localStorage.getItem("hasSeenWalkthrough")).toBe('{"version":1,"data":true}');
  });

  it("stays hidden for a legacy raw 'true' value and migrates it", () => {
    localStorage.setItem("hasSeenWalkthrough", "true");
    const { container } = render(<OnboardingWalkthrough />);
    expect(container.firstChild).toBeNull();
    expect(localStorage.getItem("hasSeenWalkthrough")).toBe('{"version":1,"data":true}');
  });
});
