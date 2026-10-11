// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Object3D, Vector3 } from "three";
import {
  applySkinUvs,
  buildModelBuffers,
  faceUvs,
  type FaceDir,
  type WikiBlockModel,
} from "../../components/wiki/modelGeometry";
import { vehicles } from "../data/vehicles";
import fixtures from "./vehicle-source-fixtures.json";

const sourceRoot = "C:/Users/MSI/Desktop/plugins/ModelEngine/blueprints";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const asset = (url: string) => read(join(process.cwd(), "public", url));
type SourceNode = { origin?: number[]; rotation?: number[] };

// Independent reference: reproduce Blockbench's actual Object3D scene graph.
// Each node is translated by origin - parent.origin, rotated in ZYX order;
// cube-local coordinates are from/to - cube.origin. No converter math is reused.
function worldMatrix(parents: SourceNode[], cube: SourceNode): Matrix4 {
  let parent = new Object3D();
  let previousOrigin = [0, 0, 0];
  for (const node of [...parents, cube]) {
    const child = new Object3D();
    const origin = node.origin ?? [0, 0, 0];
    child.position.fromArray(origin.map((v, i) => v - previousOrigin[i]));
    child.rotation.copy(
      new Euler(...((node.rotation ?? [0, 0, 0]).map((v) => (v * Math.PI) / 180) as [number, number, number]), "ZYX"),
    );
    parent.add(child);
    child.updateWorldMatrix(true, false);
    parent = child;
    previousOrigin = origin;
  }
  return parent.matrixWorld;
}

function checkCube(
  id: string,
  source: any,
  parents: SourceNode[],
  model: WikiBlockModel,
  textures: any[],
  resolution: any,
) {
  const element = model.elements.find((cube) => cube.sourceUuid === source.uuid);
  expect(element, `${id}: missing cube ${source.uuid}`).toBeDefined();
  const matrix = worldMatrix(parents, source);
  const origin = new Vector3().fromArray(source.origin ?? [0, 0, 0]);
  const expectedCorners = [];
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++) {
        expectedCorners.push(
          new Vector3(source[x ? "to" : "from"][0], source[y ? "to" : "from"][1], source[z ? "to" : "from"][2])
            .sub(origin)
            .applyMatrix4(matrix)
            .divideScalar(16),
        );
      }
  const [buffer] = buildModelBuffers({ elements: [element!] }, 1, () => 0);
  const expectedNormals = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ].map((axis) => new Vector3().fromArray(axis).transformDirection(matrix));
  for (let i = 0; i < buffer.position.length; i += 3) {
    const point = new Vector3().fromArray(buffer.position, i);
    expect(
      Math.min(...expectedCorners.map((expected) => expected.distanceTo(point))),
      `${id}: transformed vertex`,
    ).toBeLessThan(0.00015);
    const normal = new Vector3().fromArray(buffer.normal, i);
    expect(Math.min(...expectedNormals.map((expected) => expected.distanceTo(normal)))).toBeLessThan(0.00001);
  }
  for (const [direction, face] of Object.entries<any>(source.faces)) {
    const texture = typeof face.texture === "number" ? textures[face.texture] : undefined;
    const converted = element!.faces[direction as FaceDir];
    if (!texture) {
      expect(converted).toBeUndefined();
      continue;
    }
    expect(converted?.texture, `${id}: ${direction} slot`).toBe(`#${texture.id ?? face.texture}`);
    const sizes = [texture.uv_width || resolution.width, texture.uv_height || resolution.height];
    face.uv.forEach((value: number, index: number) =>
      expect(Math.abs(converted!.uv[index] - (value * 16) / sizes[index % 2])).toBeLessThan(0.000050001),
    );
    expect(converted!.rotation ?? 0).toBe(face.rotation ?? 0);
    // Blockbench CubePreviewController.updateUV rotates slots [0,1,2,3]
    // to [2,0,3,1]. Reversed endpoints must remain mirrored, not sorted.
    const [u1, v1, u2, v2] = face.uv;
    let uv = [
      [u1 / sizes[0], 1 - v1 / sizes[1]],
      [u2 / sizes[0], 1 - v1 / sizes[1]],
      [u1 / sizes[0], 1 - v2 / sizes[1]],
      [u2 / sizes[0], 1 - v2 / sizes[1]],
    ];
    for (let angle = face.rotation ?? 0; angle > 0; angle -= 90) uv = [uv[2], uv[0], uv[3], uv[1]];
    faceUvs(converted!)
      .flat()
      .forEach((value, index) => expect(Math.abs(value - uv.flat()[index])).toBeLessThan(0.000003126));
  }
}

describe("source-backed vehicle rest poses", () => {
  it("matches native Blockbench pivots/ZYX and UV grids in committed samples from all 21 families", () => {
    expect(fixtures).toHaveLength(21);
    for (const fixture of fixtures) {
      checkCube(
        fixture.id,
        fixture.cube,
        fixture.parents,
        asset(`/wiki/models/vehicles/${fixture.id}.json`),
        fixture.textures,
        fixture.resolution,
      );
    }
  });

  it.runIf(existsSync(sourceRoot))(
    "audits every visible source cube, parent chain, face UV and embedded PNG across the entire catalogue",
    () => {
      for (const fixture of fixtures) {
        const source = read(join(sourceRoot, `${fixture.path}.bbmodel`));
        const model = asset(`/wiki/models/vehicles/${fixture.id}.json`);
        const groups = new Map(source.groups?.map((node: any) => [node.uuid, node]) ?? []);
        const parents = new Map<string, any[]>();
        const walk = (nodes: any[], ancestors: any[] = []) => {
          for (const node of nodes ?? []) {
            if (typeof node === "string") parents.set(node, ancestors);
            else walk(node.children, [...ancestors, { ...(groups.get(node.uuid) as object), ...node }]);
          }
        };
        walk(source.outliner);
        let visible = 0;
        for (const cube of source.elements) {
          const chain = parents.get(cube.uuid) ?? [];
          expect(cube.type ?? "cube").toBe("cube");
          const hidden = [cube, ...chain].some((node) => node.visibility === false || node.export === false);
          const empty = cube.from.every((v: number, index: number) => v === cube.to[index]);
          const textured = Object.values<any>(cube.faces).some((face) => typeof face.texture === "number");
          if (hidden || empty || !textured) {
            expect(model.elements.some((element: any) => element.sourceUuid === cube.uuid)).toBe(false);
            continue;
          }
          visible++;
          checkCube(fixture.id, cube, chain, model, source.textures, source.resolution);
        }
        expect(model.elements).toHaveLength(visible);
        const base = vehicles.find((vehicle) => vehicle.id === fixture.id)!.skins[0];
        for (const texture of source.textures) {
          expect(readFileSync(join(process.cwd(), "public", base.textures![texture.id]))).toEqual(
            Buffer.from(texture.source.split(",")[1], "base64"),
          );
        }
      }
    },
    15000,
  );

  it("keeps all 16 skins on their base vertices and normals, varying only textures and UVs", () => {
    let count = 0;
    for (const vehicle of vehicles)
      for (const skin of vehicle.skins.slice(1)) {
        if (!skin.modelUrl) continue;
        count++;
        expect(skin.modelUrl).toBe(vehicle.skins[0].modelUrl);
        expect(skin.skinUvUrl).toBeTruthy();
        const model = asset(skin.modelUrl);
        const uv = asset(skin.skinUvUrl!);
        expect(Object.keys(uv).sort()).toEqual(["baseModel", "faces"]);
        const skinned = applySkinUvs(model, uv);
        const [original] = buildModelBuffers(model, 1, () => 0);
        const [variant] = buildModelBuffers(skinned, 1, () => 0);
        expect(variant.position).toEqual(original.position);
        expect(variant.normal).toEqual(original.normal);
        if (vehicle.id === "biplane") expect(skin.textures!["1"]).toBe(vehicle.skins[0].textures!["1"]);
        if (existsSync(sourceRoot)) {
          const source = read(join(sourceRoot, `${skin.id}.bbmodel`));
          for (const element of skinned.elements) {
            const cube = source.elements.find((item: any) => item.uuid === element.sourceUuid);
            // Match the skin atlas coordinates without importing any skin transforms.
            for (const [direction, face] of Object.entries<any>(element.faces)) {
              const originalFace = cube.faces[direction];
              const texture = source.textures[originalFace.texture];
              originalFace.uv.forEach((value: number, i: number) =>
                expect(face.uv[i]).toBeCloseTo((value * 16) / (i % 2 ? texture.uv_height : texture.uv_width), 4),
              );
            }
          }
        }
      }
    expect(count).toBe(16);
  });
});
