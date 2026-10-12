"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ArmorPreview from "../skins/ArmorPreview";
import ModelPreview from "../skins/ModelPreview";
import { kindLabel } from "../skins/KindPicker";
import { getSubmissionFile, type SubmissionPublic } from "../../../lib/skins/api";
import { armorTierLabel, baseSetLabel } from "../../../lib/skins/baseSets";
import { previewColourStopRuns } from "../../../lib/skins/namePreview";
import { ownerFileNames } from "../../../lib/skins/ownerFiles";
import { ARMOR_ICON_FIELDS } from "../../../lib/skins/sizes";
import { SkinPicture } from "./WardrobePictures";
import {
  Facts,
  formatDay,
  Heading,
  IconSlots,
  plainName,
  quietActionClass,
  Segmented,
  Showcase,
  StageNote,
  StagePicture,
  StatusBlock,
  Tooltip,
} from "./ItemShowcase";

type Files = Record<string, File | null>;

const FLAT_KINDS = ["handheld", "large_handheld", "bow", "large_bow", "crossbow"];
const ICON_LABELS: Record<string, string> = { helmet: "Helmet", chestplate: "Chest", leggings: "Legs", boots: "Boots" };

function statusMessage(row: SubmissionPublic): string {
  switch (row.status) {
    case "pending":
      return row.staff
        ? "Waiting to approve itself."
        : "Waiting for staff review. Discord tells you when it’s decided.";
    case "approved":
      return row.staff
        ? "Approved. It joins the shop pack within 24 hours."
        : "Approved. It goes live within 24 hours.";
    case "applied":
      return row.staff ? "Live in the shop pack." : "Live on the server.";
    case "denied":
    case "rejected":
      return "Denied.";
    case "revoked":
      return "Removed from the server.";
    default:
      return row.status;
  }
}

/** The skin's own uploads, fetched once per skin; null until they arrive. */
function useOwnerFiles(row: SubmissionPublic, sessionToken: string): Files | null {
  const [files, setFiles] = useState<Files | null>(null);
  // Checking the status again returns a new row; the files only change with the skin.
  const { kind, slug } = row;
  const tiers = (row.tiers ?? []).join(",");
  const names = useMemo(
    () => ownerFileNames({ kind, slug, tiers: tiers ? tiers.split(",") : [] }),
    [kind, slug, tiers],
  );
  useEffect(() => {
    let live = true;
    setFiles(null);
    const entries = Object.entries(names);
    void Promise.all(entries.map(([, name]) => getSubmissionFile(row.id, name, sessionToken).catch(() => null))).then(
      (found) => {
        if (live) setFiles(Object.fromEntries(entries.map(([field], i) => [field, found[i] ?? null])));
      },
    );
    return () => {
      live = false;
    };
  }, [names, row.id, sessionToken]);
  return files;
}

/** Object URLs for the armour icons, revoked when the set changes. */
function useIconUrls(files: (File | null)[]): (string | null)[] {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [a, b, c, d] = files;
  useEffect(() => {
    const next = [a, b, c, d].map((file) => (file ? URL.createObjectURL(file) : null));
    setUrls(next);
    return () => next.forEach((url) => url && URL.revokeObjectURL(url));
  }, [a, b, c, d]);
  return urls;
}

function Turnable({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <StageNote>Drag to turn</StageNote>
    </>
  );
}

type ViewProps = { row: SubmissionPublic; files: Files; fallback: ReactNode; children: ReactNode };

function ArmourView({ row, files, fallback, children }: ViewProps) {
  const tiers = row.tiers ?? [];
  const [tier, setTier] = useState(tiers[0] ?? "");
  const file = (field: string) => files[`${tier}_${field}`] ?? null;
  const iconUrls = useIconUrls(ARMOR_ICON_FIELDS.map((field) => file(field)));
  const layers = file("layer_1") || file("layer_2");
  return (
    <Showcase
      stage={
        layers ? (
          <Turnable>
            <ArmorPreview
              key={tier}
              stage
              className="h-full"
              layer1File={file("layer_1")}
              layer2File={file("layer_2")}
              helmet3d={Boolean(file("helmet_model") && file("helmet_texture"))}
              helmetModelFile={file("helmet_model")}
              helmetTextureFile={file("helmet_texture")}
            />
          </Turnable>
        ) : (
          fallback
        )
      }
      controls={
        <>
          {tiers.length > 1 ? (
            <Segmented
              label="Armour set"
              options={tiers.map((t) => ({ id: t, label: row.tier_aliases?.[t] || armorTierLabel(t) }))}
              value={tier}
              onChange={setTier}
            />
          ) : null}
          <IconSlots
            icons={ARMOR_ICON_FIELDS.map((field, i) => ({ label: ICON_LABELS[field]!, src: iconUrls[i] ?? null }))}
          />
        </>
      }
    >
      {children}
    </Showcase>
  );
}

function BookView({ files, fallback, children }: Omit<ViewProps, "row">) {
  const [cover, setCover] = useState<"unsigned" | "signed">("unsigned");
  const texture = files[cover];
  return (
    <Showcase
      stage={
        texture ? (
          <Turnable>
            <ModelPreview key={cover} stage kind="book" textureFile={texture} className="h-full p-3" />
          </Turnable>
        ) : (
          fallback
        )
      }
      controls={
        files.signed ? (
          <Segmented
            label="Book"
            options={[
              { id: "unsigned", label: "Unsigned" },
              { id: "signed", label: "Signed" },
            ]}
            value={cover}
            onChange={setCover}
          />
        ) : null
      }
    >
      {children}
    </Showcase>
  );
}

function ItemView({ row, files, fallback, children }: ViewProps) {
  const [failed, setFailed] = useState(false);
  const { kind } = row;
  const flat = FLAT_KINDS.includes(kind);
  const grip = row.grip_preset != null ? Number(row.grip_preset) : NaN;
  const stage =
    files.texture && !failed ? (
      <Turnable>
        <ModelPreview
          stage
          className="h-full p-3"
          kind={kind}
          textureFile={files.texture}
          modelFile={files.model ?? null}
          gunModels={
            kind === "gun"
              ? { carry: files.carry_model ?? null, reload: files.reload_model ?? null, aim: files.aim_model ?? null }
              : undefined
          }
          flatTextureFile={flat ? files.texture : null}
          flatFrames={
            flat
              ? {
                  texture: files.texture,
                  pull_0: files.pull_0 ?? null,
                  pull_1: files.pull_1 ?? null,
                  pull_2: files.pull_2 ?? null,
                  charged: files.charged ?? null,
                }
              : undefined
          }
          gripY={kind === "large_handheld" && Number.isFinite(grip) ? grip : null}
          onPreviewError={(message) => message && setFailed(true)}
        />
      </Turnable>
    ) : (
      fallback
    );
  return <Showcase stage={stage}>{children}</Showcase>;
}

export default function SkinShowcase({
  row,
  sessionToken,
  onRefresh,
}: {
  row: SubmissionPublic;
  /** The owner's skins or Profile session. */
  sessionToken: string;
  onRefresh: () => void;
}) {
  const files = useOwnerFiles(row, sessionToken);
  const fallback = (
    <StagePicture>
      <SkinPicture id={row.id} sessionToken={sessionToken} />
    </StagePicture>
  );
  const name = row.name_colours?.length
    ? previewColourStopRuns(row.display_name, row.name_colours, row.name_styles ?? [])
    : plainName(row.display_name);
  const waiting = row.status === "pending" || row.status === "approved";
  const sets = row.tiers?.length ? row.tiers.map((t) => row.tier_aliases?.[t] || armorTierLabel(t)).join(", ") : null;

  const aside = (
    <>
      <Heading
        title={row.display_name || "Skin"}
        detail={`${kindLabel(row.kind)}${row.base_set && !sets ? ` · ${baseSetLabel(row.base_set)}` : ""}`}
      />
      <StatusBlock
        status={row.status}
        message={statusMessage(row)}
        reason={
          row.status === "denied" || row.status === "rejected" ? row.deny_reason?.trim() || "No reason given." : null
        }
        action={
          waiting ? (
            <button type="button" onClick={onRefresh} className={quietActionClass}>
              Check again
            </button>
          ) : null
        }
      />
      {row.add_name || row.name_colours?.length ? <Tooltip name={name} /> : null}
      <Facts
        facts={[
          sets ? { label: row.tiers!.length === 1 ? "Armour set" : "Armour sets", value: sets } : null,
          formatDay(row.created_at) ? { label: "Made", value: formatDay(row.created_at) } : null,
          formatDay(row.reviewed_at) ? { label: "Reviewed", value: formatDay(row.reviewed_at) } : null,
          formatDay(row.applied_at) ? { label: "Live since", value: formatDay(row.applied_at) } : null,
        ]}
      />
    </>
  );

  if (!files) return <Showcase stage={fallback}>{aside}</Showcase>;
  const props = { row, files, fallback, children: aside };
  if (row.kind === "armor_set") return <ArmourView {...props} />;
  if (row.kind === "book") return <BookView {...props} />;
  return <ItemView {...props} />;
}
