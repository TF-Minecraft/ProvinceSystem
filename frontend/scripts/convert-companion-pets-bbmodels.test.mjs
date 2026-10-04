import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { convert } from "./convert-vehicle-bbmodels.mjs";

it("exports a pet to its own asset folders and omits attachment locators", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-pet-preview-"));
  try {
    const texture = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7s0AAAAASUVORK5CYII=";
    writeFileSync(join(root, "pet.bbmodel"), JSON.stringify({
      resolution: { width: 32, height: 32 },
      textures: [{ id: "2", source: `data:image/png;base64,${texture}` }],
      elements: [
        { type: "locator", uuid: "attachment", position: [0, 1, 0] },
        { type: "cube", uuid: "body", from: [0, 0, 0], to: [16, 16, 16],
          faces: { north: { uv: [0, 0, 32, 32], texture: 0 } } },
      ],
    }));
    const modelsDir = join(root, "models");
    const texturesDir = join(root, "textures");
    const result = convert("pet", "pet", undefined, {
      blueprintsDir: root, modelsDir, texturesDir, texturePrefix: "companion-pets",
    });
    expect(result.elements).toBe(1);
    const model = JSON.parse(readFileSync(join(modelsDir, "pet.json"), "utf8"));
    expect(model.elements[0].faces.north).toEqual({ uv: [0, 0, 16, 16], texture: "#2" });
    expect(model.textures).toEqual({ "2": "companion-pets/pet/2.png" });
    expect(readFileSync(join(texturesDir, "pet", "2.png"))).toEqual(Buffer.from(texture, "base64"));
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("wiki-pet-preview-")) {
      throw new Error("Refusing to remove a directory outside this test's temporary folder.");
    }
    rmSync(root, { recursive: true, force: true });
  }
});
