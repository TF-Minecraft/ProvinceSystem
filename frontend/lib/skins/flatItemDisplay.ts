import type { DisplayTab, DisplayTabName } from "./displayTransform";
import constants from "../../../shared/skins/pack_model_constants.json";

/** Thirdperson grip Y range (model units). Former presets: 2.5 / 4.0 / 5.5. */
export const GRIP_Y_MIN = constants.large_handheld.grip_y_min;
export const GRIP_Y_MAX = constants.large_handheld.grip_y_max;
export const GRIP_Y_DEFAULT = constants.large_handheld.grip_y_default;

type HandTabs = Record<"thirdperson_righthand" | "thirdperson_lefthand", Required<DisplayTab>>;

const HANDHELD_TP = constants.preview.handheld_tp as unknown as HandTabs;
const GENERATED_TP_FALLBACK: HandTabs = {
  thirdperson_righthand: {
    rotation: [0, 0, 0],
    translation: [0, 3, 1],
    scale: [0.55, 0.55, 0.55],
  },
  thirdperson_lefthand: {
    rotation: [0, 0, 0],
    translation: [0, 3, 1],
    scale: [0.55, 0.55, 0.55],
  },
};

const GENERATED_TP =
  ((constants.preview as { generated_tp?: unknown }).generated_tp as unknown as HandTabs | undefined) ??
  GENERATED_TP_FALLBACK;
const BOW_TP = constants.preview.bow_tp as unknown as HandTabs;
const CROSSBOW_TP = constants.preview.crossbow_tp as unknown as HandTabs;
const LARGE_BOW_TP = constants.large_bow.display as unknown as HandTabs;

function clampGripY(y: number): number {
  if (!Number.isFinite(y)) return GRIP_Y_DEFAULT;
  return Math.min(GRIP_Y_MAX, Math.max(GRIP_Y_MIN, y));
}

/** Large handheld thirdperson tabs — scale/rot from shared constants, Y from slider. */
function gripTp(gripY: number): HandTabs {
  const y = clampGripY(gripY);
  const rh = constants.large_handheld.thirdperson_righthand;
  const lh = constants.large_handheld.thirdperson_lefthand;
  return {
    thirdperson_righthand: {
      rotation: rh.rotation as [number, number, number],
      translation: [rh.translation_xz[0], y, rh.translation_xz[1]],
      scale: rh.scale as [number, number, number],
    },
    thirdperson_lefthand: {
      rotation: lh.rotation as [number, number, number],
      translation: [lh.translation_xz[0], y, lh.translation_xz[1]],
      scale: lh.scale as [number, number, number],
    },
  };
}

export type FlatDisplayKind = "handheld" | "generated" | "large_handheld" | "bow" | "large_bow" | "crossbow" | string;

/**
 * Resolve thirdperson display for extruded flat items (pack-accurate where we ship templates).
 * @param gripY thirdperson translation Y for large_handheld
 */
export function resolveFlatDisplayTab(
  kind: FlatDisplayKind,
  tabName: Extract<DisplayTabName, "thirdperson_righthand" | "thirdperson_lefthand">,
  gripY?: number | null,
): Required<DisplayTab> {
  if (kind === "large_handheld") {
    return { ...gripTp(gripY ?? GRIP_Y_DEFAULT)[tabName] };
  }
  if (kind === "generated" || kind === "book") {
    const tab = GENERATED_TP[tabName];
    if (tab) return { ...tab };
    return { ...GENERATED_TP_FALLBACK[tabName] };
  }
  if (kind === "large_bow") {
    return { ...LARGE_BOW_TP[tabName] };
  }
  if (kind === "bow") {
    return { ...BOW_TP[tabName] };
  }
  if (kind === "crossbow") {
    return { ...CROSSBOW_TP[tabName] };
  }
  return { ...HANDHELD_TP[tabName] };
}
