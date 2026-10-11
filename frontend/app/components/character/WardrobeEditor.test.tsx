// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../../../lib/characters/api";
import WardrobeEditor from "./WardrobeEditor";
import WardrobeSlotFrame from "./WardrobeSlotFrame";

vi.mock("../../../lib/characters/api", async (original) => ({
  ...(await original<typeof api>()),
  getWardrobe: vi.fn(),
  fetchWardrobeTextureBlob: vi.fn().mockResolvedValue("blob:stored"),
  uploadWardrobeSlot: vi.fn(),
  renameWardrobeSlot: vi.fn(),
}));
vi.mock("./SkinMannequinPreview", () => ({
  default: ({ armModel }: { armModel: string }) => <div data-testid="preview" data-model={armModel} />,
}));

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
