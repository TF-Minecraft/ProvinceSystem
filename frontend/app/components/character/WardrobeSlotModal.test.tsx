// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ArmModel } from "../../../lib/skins/steveMannequin";
import { inferArmModel } from "../../../lib/skins/steveMannequin";
import WardrobeSlotModal from "./WardrobeSlotModal";

vi.mock("../../../lib/characters/wardrobeSkin", () => ({
  assertWardrobeSkinPng: vi.fn().mockResolvedValue(undefined),
  WARDROBE_INVALID_PNG_MESSAGE: "Invalid PNG",
}));
vi.mock("../../../lib/skins/steveMannequin", () => ({
  inferArmModel: vi.fn(),
}));
vi.mock("./SkinMannequinPreview", () => ({
  default: function Preview({ source, armModel, onModelDetected }: {
    source: string | null;
    armModel: ArmModel;
    onModelDetected?: (model: ArmModel) => void;
  }) {
    // The real preview reloads and reports detection when the arm model changes.
    useEffect(() => {
      if (source) onModelDetected?.(inferArmModel(new Image()));
    }, [source, armModel]);
    return <div data-testid="preview" data-arm-model={armModel} />;
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each<ArmModel>(["default", "slim"])(
  "preserves manual arm selection when replacing a detected %s skin",
  async (detected) => {
    vi.mocked(inferArmModel).mockReturnValue(detected);
    vi.stubGlobal("Image", class {
      onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:replacement");
      static revokeObjectURL = vi.fn();
    });
    const onSave = vi.fn();
    render(<WardrobeSlotModal
      open slotLabel="Base" slotId="base" filled canEquip
      defaultEquipOnSave defaultArmModel={detected}
      existingTextureSrc="/broken-skin.png" initialDisplayName="Base"
      namePlaceholder="Base" saving={false} error={null}
      onClose={vi.fn()} onSave={onSave}
    />);
    const file = new File(["png"], "replacement.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Skin file"), { target: { files: [file] } });
    await waitFor(() => expect(inferArmModel).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));

    const toggle = screen.getByRole("switch", { name: "Slim arms" });
    const chosen = detected === "default" ? "slim" : "default";
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe(String(chosen === "slim")));
    expect(screen.getByTestId("preview").getAttribute("data-arm-model")).toBe(chosen);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ file, armModel: chosen }));
  },
);
