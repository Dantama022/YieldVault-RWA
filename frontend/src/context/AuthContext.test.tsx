import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

function TestConsumer({
  onAction,
}: {
  onAction?: (actions: { expire: () => void; clear: () => void; renew: () => void }) => void;
}) {
  const { sessionState, intendedPath, setSessionExpired, clearSessionExpired, renewSession } =
    useAuth();

  if (onAction) {
    onAction({ expire: () => setSessionExpired("/portfolio"), clear: clearSessionExpired, renew: renewSession });
  }

  return (
    <div>
      <span data-testid="state">{sessionState}</span>
      <span data-testid="path">{intendedPath}</span>
    </div>
  );
}

describe("AuthContext", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("starts with idle session state", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("transitions to expired and captures intended path", () => {
    let actions: { expire: () => void; clear: () => void; renew: () => void } | undefined;

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.expire();
    });

    expect(screen.getByTestId("state").textContent).toBe("expired");
    expect(screen.getByTestId("path").textContent).toBe("/portfolio");
  });

  it("resets to idle after clearSessionExpired", () => {
    let actions: { expire: () => void; clear: () => void; renew: () => void } | undefined;

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.expire();
    });
    expect(screen.getByTestId("state").textContent).toBe("expired");

    act(() => {
      actions!.clear();
    });
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("does not flip to expired twice (idempotent)", () => {
    let actions: { expire: () => void; clear: () => void; renew: () => void } | undefined;

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.expire();
      actions!.expire();
    });

    expect(screen.getByTestId("state").textContent).toBe("expired");
    expect(screen.getByTestId("path").textContent).toBe("/portfolio");
  });

  it("renews session and resets to idle", () => {
    let actions: { expire: () => void; clear: () => void; renew: () => void } | undefined;
    const now = Date.now();
    localStorage.setItem("wallet_session_start", (now - 20 * 60 * 1000).toString());

    render(
      <AuthProvider>
        <TestConsumer
          onAction={(a) => {
            actions = a;
          }}
        />
      </AuthProvider>,
    );

    act(() => {
      actions!.renew();
    });

    const newStart = JSON.parse(localStorage.getItem("wallet_session_start")!).data;
    expect(newStart).toBeGreaterThanOrEqual(now);
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("throws when useAuth is used outside AuthProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useAuth must be used within an AuthProvider",
    );
    spy.mockRestore();
  });
});
