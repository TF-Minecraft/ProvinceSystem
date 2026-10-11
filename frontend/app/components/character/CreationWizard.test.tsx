// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CreationCatalog } from "../../../lib/characters/api";
import { ageFromBirthday, fictionalBirthdayLabel } from "../../../lib/characters/fantasyCalendar";
import CreationWizard from "./CreationWizard";
import type { WardrobeEditorProps } from "./WardrobeEditor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("./WardrobeEditor", () => ({
  default: (props: WardrobeEditorProps) =>
    props.mode === "draft" && (
      <button
        onClick={() => {
          props.onDraftFilesChange({ base: new File(["skin"], "traveller.png") });
          props.onDraftNamesChange({ base: "Travelling clothes" });
          props.onDraftModelsChange({ base: "slim" });
          props.onAutoMaskedChange?.(true);
        }}
      >
        Choose test skin
      </button>
    ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const catalog: CreationCatalog = {
  stages: [
    { id: "name", type: "setter", target: "name" },
    { id: "age", type: "setter", target: "age" },
    { id: "race", type: "selection", target: "race" },
    { id: "talent", type: "selection", target: "trait", key: "talent", min_select: 1, max_select: 1 },
    { id: "attributes", type: "attributes" },
    { id: "description", type: "setter", target: "description" },
    { id: "wardrobe", type: "wardrobe" },
    { id: "summary", type: "summary" },
  ],
  races: [
    { id: "elf", name: "Elf", age_max: 210, attribute_modifiers: [{ type: "strength", amount: 2 }] },
    { id: "human", name: "Human", age_max: 90 },
  ],
  traits: [{ id: "strong", name: "Strong", key: "talent", attribute_modifiers: [{ type: "strength", amount: 1 }] }],
  classes: [],
  attribute_point_buy: { pool: 1, max_rank: 1, cost_for_rank: [1], attributes: ["strength"] },
  validation: { age: { minimum: 18 }, calendar: { year_offset: 1000, era_suffix: "AE" } },
  slot_limits: {},
  updated_at: null,
};

function next() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}
function edit(label: string) {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${label}` }));
}
function summaryValue(label: string) {
  return screen.getByText(label, { selector: "p" }).parentElement!;
}

function fillToSummary({ skin = false, age = "200" } = {}) {
  render(<CreationWizard catalog={catalog} sessionToken="" uiDev skipRealAge nameColourStops={2} />);
  fireEvent.change(screen.getByPlaceholderText("Character name"), { target: { value: "Ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
  next();
  fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: age } });
  // The race has not been picked yet; the default maximum is 200.
  next();
  fireEvent.click(screen.getByRole("button", { name: /Elf/ }));
  next();
  fireEvent.click(screen.getByRole("button", { name: /Strong/ }));
  next();
  fireEvent.click(screen.getByRole("button", { name: "Increase strength" }));
  next();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "A travelling scholar." } });
  fireEvent.change(screen.getByLabelText("Gender (optional)"), { target: { value: "Female" } });
  next();
  if (skin) fireEvent.click(screen.getByRole("button", { name: "Choose test skin" }));
  next();
}

it("summarises birthday, gender, colours, skins and total attributes with working edit links", () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000001");
  fillToSummary({ skin: true });
  expect(summaryValue("Birthday").textContent).toContain(
    fictionalBirthdayLabel("200", "00000000-0000-0000-0000-000000000001", catalog.validation.calendar),
  );
  expect(summaryValue("Gender").textContent).toContain("Female");
  expect(summaryValue("Name colours").textContent).toContain("#55ff55");
  expect(summaryValue("Skins").textContent).toContain("Travelling clothes");
  expect(summaryValue("Skins").textContent).toContain("slim");
  expect(summaryValue("Skins").textContent).toContain("Masked: from base");
  expect(summaryValue("Attributes").textContent).toContain("Strength +4");
  edit("Skins");
  expect(screen.getByRole("button", { name: "Choose test skin" })).toBeTruthy();
  next();
  edit("Gender");
  expect((screen.getByLabelText("Gender (optional)") as HTMLInputElement).value).toBe("Female");
});

it("blocks creation after a summary edit invalidates an earlier age and lets the player repair it", () => {
  fillToSummary();
  edit("Race");
  fireEvent.click(screen.getByRole("button", { name: /Human/ }));
  for (let i = 0; i < 5; i++) next();
  expect((screen.getByRole("button", { name: "Create (UI-dev)" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review Age" }));
  fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "50" } });
  for (let i = 0; i < 6; i++) next();
  expect((screen.getByRole("button", { name: "Create (UI-dev)" }) as HTMLButtonElement).disabled).toBe(false);
  expect(summaryValue("Skins").textContent).toContain("None selected");
});

it("shows race and trait bonuses without spending extra points or changing purchased ranks", () => {
  const logged = vi.spyOn(console, "info").mockImplementation(() => {});
  fillToSummary({ age: "50" });
  edit("Attributes");
  const attribute = screen.getByText("Strength").closest("li")!;
  expect(attribute.textContent).toContain("Race & traits +3");
  expect(attribute.textContent).toContain("Total +4");
  expect((within(attribute).getByRole("button", { name: "Increase strength" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  for (let i = 0; i < 3; i++) next();
  fireEvent.click(screen.getByRole("button", { name: "Create (UI-dev)" }));
  const submitted = logged.mock.calls[0]![1] as { body: { attributes: Record<string, number>; birthday: string } };
  expect(submitted.body.attributes).toEqual({ strength: 1 });
  expect(ageFromBirthday(submitted.body.birthday, catalog.validation.calendar)).toBe(50);
});
