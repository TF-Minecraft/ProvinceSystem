/**
 * @vitest-environment jsdom
 *
 * Mount smoke for the wipe/restore console. This component drives the two
 * destructive staff routes and had no test of any kind, because vitest ran
 * node-env and never matched a `.tsx` file at all.
 *
 * The rules themselves live in `lib/map/chronicleStaff.ts` and are tested
 * there; what this file pins is that the shell around them still mounts, that
 * the signed-out path renders the gate rather than the form, and that the wipe
 * result line reads as a file name rather than a server path.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backupFileName } from "../../lib/map/chronicleStaff";

let ChronicleStaffConsole: typeof import("./ChronicleStaffConsole").default;

beforeEach(async () => {
  // Each fixture is a fresh page view; accessible maps are shared within one.
  vi.resetModules();
  ({ default: ChronicleStaffConsole } = await import("./ChronicleStaffConsole"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("ChronicleStaffConsole", () => {
  it("mounts signed out and shows the login gate instead of the wipe form", async () => {
    render(<ChronicleStaffConsole mapId="main" />);
    await waitFor(() => expect(screen.getByText("Profile login required")).toBeDefined());
    expect(screen.queryByText(/Wipe the main chronicle/)).toBeNull();
  });

  it("mounts the signed-in console with a backups table", async () => {
    // `isCharacterUiDev()` is the one supported way to hand this component a
    // session token without standing up the whole character session.
    vi.stubEnv("NEXT_PUBLIC_CHARACTER_UI_DEV", "1");
    // `getApiBase()` throws without this, inside `fetchMapApi`'s try — which
    // surfaces as a transport failure rather than anything the mock can fix.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      // A hand-rolled response rather than `new Response(...)`: jsdom does not
      // define the fetch response classes, and `fetchMapApi` only reads `ok`,
      // `status` and `json()`.
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => String(url).includes("/maps/accessible") ? ({
          maps: [{ id: "main", display_name: "Main", public: true, archived: false }],
        }) : ({
          backups: [
            {
              id: 7,
              map_id: "main",
              wiped_at: 1_700_000_000,
              wiped_by: "uuid-1",
              day_count: 3,
              backup_path: "chronicle.bak.1700000000",
              reason: "season reset",
              restored_at: null,
              restored_by: null,
              restored: false,
              backup_exists: true,
            },
          ],
        }),
      }))
    );

    render(<ChronicleStaffConsole mapId="main" />);
    await waitFor(() => expect(screen.getByText("Backups")).toBeDefined());
    expect(screen.getByText(/Wipe the main chronicle/)).toBeDefined();
    await waitFor(() => expect(screen.getByText("season reset")).toBeDefined());
    expect(screen.getByText("Archive as…")).toBeDefined();
  });

  it("refreshes the shared map list after a successful archive", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHARACTER_UI_DEV", "1");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    let archived = false;
    let accessibleRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url);
      let body: unknown = { backups: [] };
      if (path.endsWith("/maps/accessible")) {
        accessibleRequests += 1;
        body = { maps: [
          { id: "main", display_name: "Main", public: true, archived: false },
          ...(archived ? [{ id: "chapter", display_name: "Chapter", public: true, archived: true }] : []),
        ] };
      } else if (options?.method === "POST" && path.endsWith("/archive")) {
        archived = true;
        body = { ok: true, dest: "chapter", days: [] };
      }
      return { ok: true, status: 200, json: async () => body };
    }));
    render(<ChronicleStaffConsole mapId="main" />);
    await waitFor(() => expect(screen.getByText("Backups")).toBeDefined());
    fireEvent.change(screen.getByLabelText("Dest id"), { target: { value: "chapter" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Chapter" } });
    fireEvent.change(screen.getByLabelText("Type the dest id to confirm"), { target: { value: "chapter" } });
    fireEvent.change(screen.getByPlaceholderText("why this live map is being copied to a frozen id"), { target: { value: "Archive fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "Archive as chapter" }));
    await waitFor(() => expect(screen.getByText("Copied main → chapter.")).toBeDefined());
    await waitFor(() => expect(screen.getByLabelText("Dest already exists — replace that chapter")).toBeDefined());
    expect(accessibleRequests).toBe(2);
  });

  it("hides Archive as on an archived map", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHARACTER_UI_DEV", "1");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href.includes("/maps/accessible")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
              maps: [
                {
                  id: "calavorn",
                  display_name: "Calavorn",
                  public: true,
                  archived: true,
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ backups: [] }),
        };
      })
    );
    render(<ChronicleStaffConsole mapId="calavorn" />);
    await waitFor(() => expect(screen.getByText("Backups")).toBeDefined());
    expect(screen.queryByText("Archive as…")).toBeNull();
  });
});

describe("the wipe result's backup line", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CHARACTER_UI_DEV", "1");
  });

  it("names a file, never a server-absolute path", () => {
    // The backend now returns a basename; this guards the day it doesn't.
    expect(backupFileName("/srv/provinces/data/main/chronicle.bak.170")).toBe(
      "chronicle.bak.170"
    );
    expect(backupFileName("chronicle.bak.170")).toBe("chronicle.bak.170");
  });
});
