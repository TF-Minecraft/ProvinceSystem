/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listCharacterKits } from "../../../lib/characters/api";
import { customItemId } from "../../../lib/profile/paths";
import { CustomItemView } from "./ProfileCustomItems";

vi.mock("../../../lib/characters/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/characters/api")>()),
  listCharacterKits: vi.fn(),
}));

const fetchTexture = vi.fn<typeof fetch>();
const revoke = vi.fn();
const item = {
  character_id: "character-1",
  character_name: "Ash",
  kit_key: "sword",
  display_name: "Ash's sword",
  state: "ready",
};

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://example.test/api");
  vi.stubGlobal("fetch", fetchTexture);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:kit");
      static revokeObjectURL = revoke;
    },
  );
  vi.mocked(listCharacterKits).mockResolvedValue({ character_id: item.character_id, kits: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderShowcase() {
  const view = render(
    <CustomItemView
      id={customItemId(item.character_id, item.kit_key)}
      items={[item]}
      sessionToken="owner"
      onBack={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: item.display_name });
  return view;
}

it("fills a custom item's large stage until its kit texture arrives", async () => {
  const pending = deferredResponse();
  fetchTexture.mockReturnValueOnce(pending.promise);
  const { container, unmount } = await renderShowcase();
  expect(container.querySelector("span[aria-hidden='true']")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => pending.resolve(new Response(new Blob(["texture"]), { status: 200 })));
  expect(container.querySelector("span[aria-hidden='true']")).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:kit");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:kit");
});

it.each(["missing", "request failure"])("uses the hanger after a kit texture %s", async (failure) => {
  const pending = deferredResponse();
  fetchTexture.mockReturnValueOnce(pending.promise);
  const { container } = await renderShowcase();
  await act(async () => {
    if (failure === "request failure") pending.reject(new Error("unavailable"));
    else pending.resolve(new Response(null, { status: 404 }));
  });
  expect(container.querySelector("span[aria-hidden='true']")).toBeNull();
  expect(container.querySelector("svg")).toBeTruthy();
});
