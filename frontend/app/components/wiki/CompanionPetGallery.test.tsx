// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CompanionPetGallery from "./CompanionPetGallery";

vi.mock("./WikiModelViewer", () => ({
  default: ({ label, modelUrl }: { label: string; modelUrl: string }) => (
    <div role="img" aria-label={label} data-model-url={modelUrl} />
  ),
}));

it("lets readers choose any companion while mounting only its preview", () => {
  render(<CompanionPetGallery />);
  const select = screen.getByRole("combobox", { name: "Meet the companions" });
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Beagle", "Chihuahua", "Corgi", "Golden Retriever", "Husky", "Maine Coon",
    "Black cat", "Funny cat", "Orange cat", "Fox", "Frog",
  ]);
  expect(screen.getByText("Beagle Companion Egg")).toBeTruthy();
  for (const [id, name, egg] of [
    ["husky", "Husky", "Husky Companion Egg"],
    ["golden", "Golden Retriever", "Golden Companion Egg"],
    ["catblack", "Black cat", "Catblack Companion Egg"],
    ["mainecoon", "Maine Coon", "Maine Coon Companion Egg"],
    ["frog", "Frog", "Frog Companion Egg"],
  ]) {
    fireEvent.change(select, { target: { value: id } });
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name })
      .getAttribute("data-model-url")).toBe(`/wiki/models/companion-pets/${id}.json`);
    expect(screen.getByText(egg)).toBeTruthy();
    expect(screen.queryByText("Beagle Companion Egg")).toBeNull();
  }
  expect(screen.getByRole("link", { name: "Animal Station" }).getAttribute("href"))
    .toBe("/wiki/stations/animal-station");
});
