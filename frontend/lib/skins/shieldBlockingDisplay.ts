import type { DisplayTab } from "./displayTransform";
import constants from "../../../shared/skins/pack_model_constants.json";

type Vec3 = [number, number, number];

const ROUND_IDLE_TP = constants.shield.round_idle as unknown as Record<
  "thirdperson_righthand" | "thirdperson_lefthand",
  Required<DisplayTab>
>;

const ROUND_BLOCKING_DELTA_TP = constants.shield.round_blocking_delta as unknown as Record<
  "thirdperson_righthand" | "thirdperson_lefthand",
  { rotation: Vec3; translation: Vec3 }
>;

function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (![x, y, z].every(Number.isFinite)) return fallback;
  return [x, y, z];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function resolveIdleTab(
  json: { display?: Record<string, unknown>; elements?: unknown },
  tabName: "thirdperson_righthand" | "thirdperson_lefthand",
): Required<DisplayTab> {
  const fallback = ROUND_IDLE_TP[tabName];
  const raw = json.display?.[tabName];
  if (!raw || typeof raw !== "object") {
    return {
      rotation: [...fallback.rotation] as Vec3,
      translation: [...fallback.translation] as Vec3,
      scale: [...fallback.scale] as Vec3,
    };
  }
  const src = raw as Record<string, unknown>;
  return {
    rotation: asVec3(src.rotation, [0, 0, 0]),
    translation: asVec3(src.translation, [0, 0, 0]),
    scale: asVec3(src.scale, [1, 1, 1]),
  };
}

/**
 * Idle + round blocking Δ from shared pack_model_constants.json
 * (matches ProvinceSystem pack_models.shield).
 */
export function resolveShieldBlockingTab(
  json: { display?: Record<string, unknown>; elements?: unknown },
  tabName: "thirdperson_righthand" | "thirdperson_lefthand" = "thirdperson_righthand",
): Required<DisplayTab> {
  const idle = resolveIdleTab(json, tabName);
  const delta = ROUND_BLOCKING_DELTA_TP[tabName];
  return {
    rotation: addVec3(idle.rotation as Vec3, delta.rotation),
    translation: addVec3(idle.translation as Vec3, delta.translation),
    scale: [...idle.scale] as Vec3,
  };
}
