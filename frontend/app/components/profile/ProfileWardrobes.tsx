"use client";

import { useRouter } from "next/navigation";
import type {
  ProfileDrinkSubmission,
  ProfileSkinSubmission,
} from "../../../lib/profile/api";
import type { StartAllowance } from "../../../lib/profile/start";
import { startSkinFromProfile } from "../../../lib/skins/api";
import { setSession as setSkinsSession, skinsSessionFrom } from "../../../lib/skins/session";
import { startDrinkFromProfile } from "../../../lib/drinks/api";
import { drinksSessionFrom, setSession as setDrinksSession } from "../../../lib/drinks/session";
import DrinkRedeemForm from "../drinks/RedeemForm";
import SkinRedeemForm from "../skins/RedeemForm";
import { kindLabel } from "../skins/KindPicker";
import Wardrobe from "./Wardrobe";
import { DrinkPicture, SkinPicture } from "./WardrobePictures";

type Props<Row> = {
  rows: Row[];
  allowance?: StartAllowance;
  sessionToken: string;
};

export function SkinWardrobe({ rows, allowance, sessionToken }: Props<ProfileSkinSubmission>) {
  const router = useRouter();
  return (
    <Wardrobe
      noun="skin"
      allowance={allowance}
      onStart={async () => {
        const result = await startSkinFromProfile(sessionToken);
        setSkinsSession({ ...skinsSessionFrom(result), from_profile: true });
        router.push("/skins");
      }}
      codeForm={<SkinRedeemForm compact onRedeemed={() => router.push("/skins")} />}
      items={rows.map((row) => ({
        id: row.id,
        href: `/skins/${encodeURIComponent(row.id)}`,
        name: row.display_name || "Untitled skin",
        detail: kindLabel(row.kind),
        status: row.status,
        denyReason: row.deny_reason,
        picture: <SkinPicture id={row.id} sessionToken={sessionToken} />,
      }))}
    />
  );
}

export function DrinkWardrobe({ rows, allowance, sessionToken }: Props<ProfileDrinkSubmission>) {
  const router = useRouter();
  return (
    <Wardrobe
      noun="drink"
      allowance={allowance}
      onStart={async () => {
        const result = await startDrinkFromProfile(sessionToken);
        setDrinksSession({ ...drinksSessionFrom(result), from_profile: true });
        router.push("/drinks");
      }}
      codeForm={<DrinkRedeemForm compact onRedeemed={() => router.push("/drinks")} />}
      items={rows.map((row) => ({
        id: row.id,
        href: `/drinks/${encodeURIComponent(row.id)}`,
        name: row.display_name || "Untitled drink",
        detail: "Drink",
        status: row.status,
        denyReason: row.deny_reason,
        picture: <DrinkPicture color={row.recipe?.color ?? null} />,
      }))}
    />
  );
}
