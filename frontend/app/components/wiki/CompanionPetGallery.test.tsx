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
    "Bernese Mountain Dog", "Border Collie", "Gray Border Collie", "Gray cat", "Tabby cat",
    "Lagotto Romagnolo", "Yorkshire Terrier",
  ]);
  expect(screen.getByText("Beagle Companion Egg")).toBeTruthy();
  expect(screen.getByText("Pet Master")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Beagle" })
    .getAttribute("data-model-url")).toBe("/wiki/models/companion-pets/beagle.json");
  expect(screen.getByText("Beagle Companion Egg").parentElement?.querySelector("img")
    ?.getAttribute("src")).toBe("/wiki/textures/vanilla/wolf_spawn_egg.png");
  for (const [id, name, egg, unlock] of [
    ["chihuahua", "Chihuahua", "Chihuahua Companion Egg", "Pet Master"],
    ["corgi", "Corgi", "Corgi Companion Egg", "Pet Master"],
    ["husky", "Husky", "Husky Companion Egg", "Noble"],
    ["golden", "Golden Retriever", "Golden Companion Egg", "Pet Master"],
    ["catblack", "Black cat", "Catblack Companion Egg", "Pet Master"],
    ["catfunny", "Funny cat", "Catfunny Companion Egg", "Pet Master"],
    ["catorange", "Orange cat", "Catorange Companion Egg", "Pet Master"],
    ["mainecoon", "Maine Coon", "Maine Coon Companion Egg", "Noble"],
    ["fox", "Fox", "Fox Companion Egg", "Pet Master"],
    ["frog", "Frog", "Frog Companion Egg", "Pet Master"],
    ["bernesse", "Bernese Mountain Dog", "Bernese Mountain Dog Companion Egg", "Ascended"],
    ["bordercollie", "Border Collie", "Border Collie Companion Egg", "Noble"],
    ["bordercolliegray", "Gray Border Collie", "Gray Border Collie Companion Egg", "Legacy"],
    ["catgray", "Gray cat", "Gray Cat Companion Egg", "Gilded"],
    ["cattabby", "Tabby cat", "Tabby Cat Companion Egg", "Gilded"],
    ["lagottoromagnolo", "Lagotto Romagnolo", "Lagotto Romagnolo Companion Egg", "Gilded"],
    ["yorkshire", "Yorkshire Terrier", "Yorkshire Terrier Companion Egg", "Ascended"],
  ]) {
    fireEvent.change(select, { target: { value: id } });
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name })
      .getAttribute("data-model-url")).toBe(`/wiki/models/companion-pets/${id}.json`);
    expect(screen.getByText(egg)).toBeTruthy();
    expect(screen.getByText(unlock)).toBeTruthy();
    if (unlock !== "Pet Master") expect(screen.queryByText("Pet Master")).toBeNull();
    const eggIcon = screen.getByText(egg).parentElement?.querySelector("img");
    const family = ["catblack", "catfunny", "catorange", "mainecoon", "catgray", "cattabby"].includes(id) ? "cat" : id === "frog" ? "frog" : id === "fox" ? "fox" : "wolf";
    expect(eggIcon?.getAttribute("src")).toBe(`/wiki/textures/vanilla/${family}_spawn_egg.png`);
    expect(screen.queryByText("Beagle Companion Egg")).toBeNull();
  }
  expect(screen.getByRole("link", { name: "Animal Station" }).getAttribute("href"))
    .toBe("/wiki/stations/animal-station");
});
