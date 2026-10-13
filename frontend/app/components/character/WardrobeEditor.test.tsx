// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../../../lib/characters/api";
import WardrobeEditor from "./WardrobeEditor";
import WardrobeSlotFrame from "./WardrobeSlotFrame";

vi.mock("../../../lib/characters/api", async (original) => ({
  ...(await original<typeof api>()),
  getWardrobe: vi.fn(),
  fetchWardrobeTextureBlob: vi.fn().mockResolvedValue("blob:stored"),
  setWardrobeActive: vi.fn(),
  uploadWardrobeSlot: vi.fn(),
  renameWardrobeSlot: vi.fn(),
}));
vi.mock("./SkinMannequinPreview", () => ({
  default: ({ armModel, source, decorative }: { armModel: string; source: string; decorative?: boolean }) => (
    <div data-testid="preview" data-model={armModel} data-source={source} data-decorative={decorative} />
  ),
}));

beforeEach(() => {
  vi.mocked(api.getWardrobe).mockReset();
  vi.mocked(api.fetchWardrobeTextureBlob).mockReset().mockResolvedValue("blob:stored");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const wardrobe: api.WardrobeResponse = {
  character_id: "character",
  active_slot: "base",
  swappable_slots: 1,
  slots: [{ slot: "base", filled: true, unlocked: true, model: "classic" }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function stubObjectUrls() {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = revokeObjectURL;
    },
  );
  return revokeObjectURL;
}

it("keeps four slot-shaped placeholders noninteractive until live metadata arrives", async () => {
  const request = deferred<api.WardrobeResponse>();
  vi.mocked(api.getWardrobe).mockReturnValue(request.promise);
  const { container } = render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);

  expect(screen.getByRole("status").textContent).toContain("Loading wardrobe");
  expect(container.querySelectorAll(".aspect-\\[3\\/5\\]")).toHaveLength(4);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryByText("Empty")).toBeNull();
  expect(screen.queryByText("Locked")).toBeNull();

  await act(async () => request.resolve({ ...wardrobe, active_slot: null, slots: [] }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Base empty - edit" })).toBeTruthy();
});

it("shows UI-dev slots immediately without a live metadata request", () => {
  render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" uiDev uiDevSwappableSlots={3} />);
  expect(api.getWardrobe).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Skin 3 empty - edit" })).toBeTruthy();
});

it("ends initial loading on metadata errors without exposing unknown slots for editing", async () => {
  const request = deferred<api.WardrobeResponse>();
  vi.mocked(api.getWardrobe).mockReturnValue(request.promise);
  render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  await act(async () => request.reject(new Error("Wardrobe unavailable")));
  expect(screen.getByRole("alert").textContent).toBe("Wardrobe unavailable");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryByText("Empty")).toBeNull();
  expect(screen.queryByText("Locked")).toBeNull();
});

it("shows a filled slot preview skeleton until its texture arrives", async () => {
  stubObjectUrls();
  const texture = deferred<string>();
  vi.mocked(api.getWardrobe).mockResolvedValue(wardrobe);
  vi.mocked(api.fetchWardrobeTextureBlob).mockReturnValue(texture.promise);
  render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  const base = await screen.findByRole("button", { name: "Base - edit" });
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain("Loading wardrobe previews");
  expect(base.querySelector('[aria-hidden="true"]')).toBeTruthy();
  expect(within(base).queryByRole("status")).toBeNull();
  expect(within(base).queryByText("Empty")).toBeNull();
  expect(within(base).queryByText("Preview unavailable")).toBeNull();

  await act(async () => texture.resolve("blob:loaded"));
  expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("blob:loaded");
  expect(screen.getByTestId("preview").getAttribute("data-decorative")).toBe("true");
  expect(screen.queryByRole("status")).toBeNull();
});

it("ends a failed texture load with an unavailable preview instead of a false empty slot", async () => {
  const texture = deferred<string>();
  vi.mocked(api.getWardrobe).mockResolvedValue(wardrobe);
  vi.mocked(api.fetchWardrobeTextureBlob).mockReturnValue(texture.promise);
  render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  const base = await screen.findByRole("button", { name: "Base - edit" });
  await act(async () => texture.reject(new Error("Texture unavailable")));
  expect(within(base).getByText("Preview unavailable")).toBeTruthy();
  expect(within(base).queryByText("Empty")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("preserves known slots and textures during refresh and after a refresh texture failure", async () => {
  const revokeObjectURL = stubObjectUrls();
  vi.mocked(api.getWardrobe).mockResolvedValueOnce(wardrobe);
  const { rerender } = render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  await screen.findByTestId("preview");
  const request = deferred<api.WardrobeResponse>();
  const texture = deferred<string>();
  vi.mocked(api.getWardrobe).mockReturnValueOnce(request.promise);
  vi.mocked(api.fetchWardrobeTextureBlob).mockReturnValueOnce(texture.promise);
  rerender(<WardrobeEditor mode="live" characterId="character" sessionToken="refreshed-token" />);
  expect(screen.getByRole("button", { name: "Base - edit" })).toBeTruthy();
  expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("blob:stored");
  expect(screen.queryByRole("status")).toBeNull();

  await act(async () => request.resolve(wardrobe));
  expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("blob:stored");
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => texture.reject(new Error("Refresh texture unavailable")));
  expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("blob:stored");
  expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:stored");
  expect(screen.queryByRole("status")).toBeNull();
});

it("hides the old character's controls and discards textures completed after switching characters", async () => {
  const revokeObjectURL = stubObjectUrls();
  const oldTexture = deferred<string>();
  const nextWardrobe = deferred<api.WardrobeResponse>();
  vi.mocked(api.getWardrobe).mockResolvedValueOnce(wardrobe).mockReturnValueOnce(nextWardrobe.promise);
  vi.mocked(api.fetchWardrobeTextureBlob).mockReturnValueOnce(oldTexture.promise);
  const { rerender } = render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  await screen.findByRole("button", { name: "Base - edit" });
  rerender(<WardrobeEditor mode="live" characterId="next-character" sessionToken="token" />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toContain("Loading wardrobe");
  await act(async () => nextWardrobe.resolve({ ...wardrobe, character_id: "next-character", slots: [] }));
  expect(screen.getByRole("button", { name: "Base empty - edit" })).toBeTruthy();
  await act(async () => oldTexture.resolve("blob:old-character"));
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:old-character");
  expect(screen.queryByTestId("preview")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("revokes textures that arrive after the editor unmounts", async () => {
  const revokeObjectURL = stubObjectUrls();
  const texture = deferred<string>();
  vi.mocked(api.getWardrobe).mockResolvedValue(wardrobe);
  vi.mocked(api.fetchWardrobeTextureBlob).mockReturnValue(texture.promise);
  const { unmount } = render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  await screen.findByRole("button", { name: "Base - edit" });
  unmount();
  await act(async () => texture.resolve("blob:unmounted"));
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:unmounted");
});

it("renders the stored slim model in the wardrobe card", () => {
  render(
    <WardrobeSlotFrame
      slot={{ ...wardrobe.slots[0], model: "slim" }}
      label="Base"
      active
      textureSrc="blob:stored"
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByTestId("preview").getAttribute("data-model")).toBe("slim");
});

it("lets a signed skin be equipped and edited before the server syncs it", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = vi.fn();
    },
  );
  const pending: api.WardrobeResponse = {
    ...wardrobe,
    swappable_slots: 2,
    slots: [
      ...wardrobe.slots,
      {
        slot: "extra_1",
        display_name: "Ball suit",
        filled: true,
        unlocked: true,
        model: "classic",
        apply_pending: true,
      },
    ],
  };
  vi.mocked(api.getWardrobe).mockResolvedValue(pending);
  vi.mocked(api.setWardrobeActive).mockResolvedValue({ ...pending, active_slot: "extra_1" });
  render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  expect(await screen.findByText("Syncing")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Equip" }));
  await waitFor(() => expect(api.setWardrobeActive).toHaveBeenCalledWith("token", "character", "extra_1"));
  fireEvent.click(screen.getByRole("button", { name: "Ball suit syncing - edit" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("re-signs the stored PNG when only its arm model changes", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["png"]) }));
  vi.mocked(api.getWardrobe).mockResolvedValue(wardrobe);
  vi.mocked(api.uploadWardrobeSlot).mockResolvedValue(wardrobe);
  const { container } = render(<WardrobeEditor mode="live" characterId="character" sessionToken="token" />);
  await screen.findByTestId("preview");
  fireEvent.click(container.querySelector("button")!);
  fireEvent.click(screen.getByRole("switch", { name: "Slim arms" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.uploadWardrobeSlot).toHaveBeenCalledWith("token", "character", "base", expect.any(File), null, {
      createMasked: false,
      model: "slim",
    }),
  );
  expect(api.renameWardrobeSlot).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps a model-only change in the creation draft", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:draft");
      static revokeObjectURL = vi.fn();
    },
  );
  const onDraftModelsChange = vi.fn();
  const { container } = render(
    <WardrobeEditor
      mode="draft"
      draftFiles={{ base: new File(["png"], "skin.png") }}
      draftNames={{}}
      draftModels={{ base: "default" }}
      onDraftFilesChange={vi.fn()}
      onDraftNamesChange={vi.fn()}
      onDraftModelsChange={onDraftModelsChange}
    />,
  );
  await screen.findByTestId("preview");
  fireEvent.click(container.querySelector("button")!);
  fireEvent.click(screen.getByRole("switch", { name: "Slim arms" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onDraftModelsChange).toHaveBeenCalledWith({ base: "slim" });
});
