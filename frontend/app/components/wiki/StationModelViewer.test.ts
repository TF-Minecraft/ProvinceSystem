import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { marketBlockRecipe } from "../../wiki/data/market-blocks";
import {
  faceUvCoordinates,
  buildGeometryForElement,
  loadTextureBindings,
  textureMaterialIndices,
  visibleFaceMaterialGroups,
} from "./StationModelViewer";

describe("StationModelViewer multi-texture models", () => {
  it("draws exactly one side of each fishing-station sheet from either direction", () => {
    const model = JSON.parse(
      readFileSync(join(process.cwd(), "public/wiki/models/stations/fishing-station.json"), "utf8"),
    ) as { elements: Array<Parameters<typeof buildGeometryForElement>[0]> };
    const sheets = model.elements.filter((el) => el.from[1] === el.to[1]);
    expect(sheets).toHaveLength(5); // String, two body fins, two tail fins.
    const materials = [
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
      new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    ];
    for (const el of sheets) {
      const { geo } = buildGeometryForElement(el, ["2"]);
      const mesh = new THREE.Mesh(geo, materials);
      for (const side of [-1, 1]) {
        // Off the diagonal to avoid hitting both triangles within one face.
        const ray = new THREE.Raycaster(
          new THREE.Vector3((el.to[0] - el.from[0]) / 160, side, 0),
          new THREE.Vector3(0, -side, 0),
        );
        const hits = ray.intersectObject(mesh);
        expect(hits).toHaveLength(1);
        expect(hits[0].face!.normal.y).toBe(side);
      }
      geo.dispose();
    }
    materials.forEach((material) => material.dispose());
  });

  it("keeps lone sheets double-sided and honors missing faces with a single texture", () => {
    const face = { uv: [0, 0, 16, 16] as [number, number, number, number], texture: "#0" };
    const { geo } = buildGeometryForElement(
      {
        from: [0, 0, 0],
        to: [16, 0, 16],
        faces: { up: face },
      },
      [],
    );
    expect(geo.groups).toEqual([{ start: 12, count: 6, materialIndex: 0 }]);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, [material]);
    for (const side of [-1, 1]) {
      expect(
        new THREE.Raycaster(new THREE.Vector3(0.1, side, 0), new THREE.Vector3(0, -side, 0)).intersectObject(mesh),
      ).toHaveLength(1);
    }
    geo.dispose();
    material.dispose();
  });

  it("assigns each box face to the material named by its texture reference", () => {
    const faces = {
      east: { uv: [0, 0, 1, 1] as [number, number, number, number], texture: "#coin" },
      west: { uv: [0, 0, 1, 1] as [number, number, number, number], texture: "#wood" },
    };

    expect(textureMaterialIndices(faces, ["wood", "coin"])).toEqual([1, 0, -1, -1, -1, -1]);
    expect(visibleFaceMaterialGroups(faces, ["wood", "coin"])).toEqual([
      { faceIndex: 0, materialIndex: 1 },
      { faceIndex: 1, materialIndex: 0 },
    ]);
  });

  it("settles a failed texture binding without rejecting the model load", async () => {
    const loaded: string[] = [];
    const result = await loadTextureBindings(["wood.png", "missing.png", "coin.png"], async (url) => {
      loaded.push(url);
      if (url === "missing.png") throw new Error("404");
      return { url };
    });

    expect(loaded).toEqual(["wood.png", "missing.png", "coin.png"]);
    expect(result).toEqual([{ url: "wood.png" }, null, { url: "coin.png" }]);
  });

  it.each([
    [
      0,
      [
        [0.125, 0.75],
        [0.625, 0.75],
        [0.125, 0.25],
        [0.625, 0.25],
      ],
    ],
    [
      90,
      [
        [0.125, 0.25],
        [0.125, 0.75],
        [0.625, 0.25],
        [0.625, 0.75],
      ],
    ],
    [
      180,
      [
        [0.625, 0.25],
        [0.125, 0.25],
        [0.625, 0.75],
        [0.125, 0.75],
      ],
    ],
    [
      270,
      [
        [0.625, 0.75],
        [0.625, 0.25],
        [0.125, 0.75],
        [0.125, 0.25],
      ],
    ],
  ] as const)("maps an asymmetric UV rectangle at %i degrees", (rotation, expected) => {
    expect(
      faceUvCoordinates({
        uv: [2, 4, 10, 12],
        texture: "#crop",
        rotation,
      }),
    ).toEqual(expected);
  });

  it("provides an existing authentic asset for every Market Block texture key", () => {
    const model = marketBlockRecipe.output.model;
    expect(model?.textures).toBeDefined();
    const source = JSON.parse(readFileSync(join(process.cwd(), "public/wiki/models/market-block.json"), "utf8")) as {
      textures: Record<string, string>;
    };
    const referencedKeys = new Set(
      Object.entries(source.textures)
        .filter(([key]) => key !== "particle")
        .map(([key]) => key),
    );

    expect(new Set(Object.keys(model!.textures!))).toEqual(referencedKeys);
    for (const url of Object.values(model!.textures!)) {
      expect(readFileSync(join(process.cwd(), "public", url)).length).toBeGreaterThan(0);
    }
  });
});
