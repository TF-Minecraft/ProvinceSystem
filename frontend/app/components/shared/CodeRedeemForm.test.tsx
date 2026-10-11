/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CodeRedeemForm from "./CodeRedeemForm";

afterEach(cleanup);

function setup(redeem: (code: string) => Promise<{ token: string }>, compact = false) {
  const saveSession = vi.fn();
  const onRedeemed = vi.fn();
  render(
    <CodeRedeemForm
      compact={compact}
      redeem={redeem}
      toSession={(result) => ({ session_token: result.token })}
      saveSession={saveSession}
      onRedeemed={onRedeemed}
      label="Skin code"
    />
  );
  return { saveSession, onRedeemed };
}

it("redeems the trimmed code, saves the session and hands it on", async () => {
  const redeem = vi.fn().mockResolvedValue({ token: "t1" });
  const { saveSession, onRedeemed } = setup(redeem);
  fireEvent.change(screen.getByLabelText("Skin code"), { target: { value: "  ABCD-1234 " } });
  fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
  await waitFor(() => expect(onRedeemed).toHaveBeenCalledWith({ session_token: "t1" }));
  expect(redeem).toHaveBeenCalledWith("ABCD-1234");
  expect(saveSession).toHaveBeenCalledWith({ session_token: "t1" });
});

it("asks for a code before calling the API", () => {
  const redeem = vi.fn();
  setup(redeem, true);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByRole("alert").textContent).toBe("Enter a code");
  expect(redeem).not.toHaveBeenCalled();
});

it("shows the API error and saves nothing", async () => {
  const { saveSession, onRedeemed } = setup(() => Promise.reject(new Error("Code already used")), true);
  fireEvent.change(screen.getByLabelText("Skin code"), { target: { value: "USED" } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Code already used");
  expect(saveSession).not.toHaveBeenCalled();
  expect(onRedeemed).not.toHaveBeenCalled();
});
