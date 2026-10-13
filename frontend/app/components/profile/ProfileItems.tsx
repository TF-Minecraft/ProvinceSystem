"use client";

import LoadingSkeleton from "@/app/components/shared/LoadingSkeleton";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import UploadForm from "../skins/UploadForm";
import BrewForm from "../drinks/BrewForm";
import DrinkShowcase from "./DrinkShowcase";
import SkinShowcase from "./SkinShowcase";
import { getPlayerMeta, getSubmission as getSkin, type SubmissionPublic } from "../../../lib/skins/api";
import * as skins from "../../../lib/skins/session";
import { getSubmission as getDrink, type DrinkSubmissionPublic } from "../../../lib/drinks/api";
import * as drinks from "../../../lib/drinks/session";
import { profileHref } from "../../../lib/profile/paths";
import { resolveOwnerToken, type WardrobeSessionStore } from "../../../lib/profile/session";

type Props = {
  /** "new" for the editor, else a submission id. */
  id: string;
  /** ← back to the wardrobe. */
  onBack: () => void;
  /** Back to the wardrobe in place, when there's nothing to show. */
  onLeave: () => void;
  /** Swaps this view for one skin or drink, in place (after a submit). */
  onShow: (id: string) => void;
};

const quietClass = "text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline";

const BACK_LABELS = { characters: "Characters", skins: "Skins", drinks: "Drinks", items: "Custom items" } as const;

/** An item inside its Profile tab: back to the tab's list, a title if the item has none of its own, then the item. */
export function ItemFrame({
  tab,
  title,
  onBack,
  backHref,
  children,
}: {
  tab: keyof typeof BACK_LABELS;
  title?: ReactNode;
  onBack: () => void;
  /** Staff uses the same frame with a back address inside the staff panel. */
  backHref?: string;
  children: ReactNode;
}) {
  function back(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onBack();
  }
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <a href={backHref || profileHref(tab)} onClick={back} className={quietClass}>
          ← {BACK_LABELS[tab]}
        </a>
        {title ? (
          <h2 className="min-w-0 font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">{title}</h2>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function Loading() {
  return <LoadingSkeleton variant="form" className="mt-6" />;
}

/** The skin editor, for a session Profile started or an in-game code opened. */
function NewSkin({ onBack, onLeave, onShow }: Omit<Props, "id">) {
  const [session, setSessionState] = useState<skins.SkinsSession | null>(null);
  const [metaSynced, setMetaSynced] = useState(true);

  useEffect(() => {
    const existing = skins.getSession();
    if (!skins.isSessionValid(existing)) {
      if (existing) skins.clearSession();
      onLeave();
      return;
    }
    // Back to a submitted skin's editor: its code is spent, so show the skin instead.
    const lastId = skins.getLastSubmissionId();
    if (lastId) {
      onShow(lastId);
      return;
    }
    setSessionState(existing);
  }, [onLeave, onShow]);

  const token = session?.session_token;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPlayerMeta(token)
      .then((meta) => {
        if (cancelled) return;
        const current = skins.getSession();
        if (!current || current.session_token !== token) return;
        const next: skins.SkinsSession = {
          ...current,
          name_colour_stops: meta.name_colour_stops,
          max_3d_pair_bytes: meta.max_3d_pair_bytes,
          skin_token_cooldown_days: meta.skin_token_cooldown_days,
          skin_kinds: meta.skin_kinds,
          allow_armor_3d_helmet: meta.allow_armor_3d_helmet,
        };
        skins.setSession(next);
        setSessionState(next);
        setMetaSynced(meta.meta_synced !== false);
      })
      .catch(() => {
        // Keep the redeem-time snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <ItemFrame tab="skins" title="New skin" onBack={onBack}>
      {session ? (
        <UploadForm
          sessionToken={session.session_token}
          staff={session.staff === true}
          nameColourStops={session.name_colour_stops}
          max3dPairBytes={session.max_3d_pair_bytes}
          skinKinds={session.skin_kinds ?? null}
          allowArmor3dHelmet={session.allow_armor_3d_helmet === true}
          colourLockedMessage={
            !metaSynced && (session.name_colour_stops ?? 0) <= 0
              ? "Join the server once to unlock your rank perks."
              : undefined
          }
          onSubmitted={onShow}
        />
      ) : (
        <Loading />
      )}
    </ItemFrame>
  );
}

/** The drink editor, for a session Profile started or an in-game code opened. */
function NewDrink({ onBack, onLeave, onShow }: Omit<Props, "id">) {
  const [session, setSessionState] = useState<drinks.DrinksSession | null>(null);

  useEffect(() => {
    const existing = drinks.getSession();
    if (!drinks.isSessionValid(existing)) {
      if (existing) drinks.clearSession();
      onLeave();
      return;
    }
    // Back to a submitted drink's editor: its code is spent, so show the drink instead.
    const lastId = drinks.getLastSubmissionId();
    if (lastId) {
      onShow(lastId);
      return;
    }
    setSessionState(existing);
  }, [onLeave, onShow]);

  return (
    <ItemFrame tab="drinks" title="New drink" onBack={onBack}>
      {session ? <BrewForm session={session} onSubmitted={onShow} /> : <Loading />}
    </ItemFrame>
  );
}

/** One skin or drink and where it is in review, loaded with Profile's session or a code's. */
function useOwnedItem<Row, S extends { session_token: string }>(
  id: string,
  store: WardrobeSessionStore<S>,
  get: (id: string, token: string) => Promise<Row>,
  onLeave: () => void,
) {
  const [row, setRow] = useState<Row | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Checking again keeps the item on screen; only the first load shows Loading.
  const load = useCallback(async () => {
    const owner = resolveOwnerToken(store);
    if (!owner) {
      onLeave();
      return;
    }
    setError(null);
    try {
      setRow(await get(id, owner));
      setToken(owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [get, id, onLeave, store]);

  useEffect(() => {
    void load();
  }, [load]);

  return { row, token, error, loading, load };
}

function ItemBody({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (loading) return <Loading />;
  if (error) {
    return (
      <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
        {error}
      </p>
    );
  }
  return children;
}

function SkinView({ id, onBack, onLeave }: Omit<Props, "onShow">) {
  const { row, token, error, loading, load } = useOwnedItem<SubmissionPublic, skins.SkinsSession>(
    id,
    skins,
    getSkin,
    onLeave,
  );
  return (
    <ItemFrame tab="skins" onBack={onBack}>
      <ItemBody loading={loading} error={error}>
        {row && token ? <SkinShowcase row={row} sessionToken={token} onRefresh={() => void load()} /> : null}
      </ItemBody>
    </ItemFrame>
  );
}

function DrinkView({ id, onBack, onLeave }: Omit<Props, "onShow">) {
  const { row, token, error, loading, load } = useOwnedItem<DrinkSubmissionPublic, drinks.DrinksSession>(
    id,
    drinks,
    getDrink,
    onLeave,
  );
  return (
    <ItemFrame tab="drinks" onBack={onBack}>
      <ItemBody loading={loading} error={error}>
        {row && token ? <DrinkShowcase row={row} sessionToken={token} onRefresh={() => void load()} /> : null}
      </ItemBody>
    </ItemFrame>
  );
}

export function SkinItem({ id, ...nav }: Props) {
  return id === "new" ? <NewSkin {...nav} /> : <SkinView key={id} id={id} {...nav} />;
}

export function DrinkItem({ id, ...nav }: Props) {
  return id === "new" ? <NewDrink {...nav} /> : <DrinkView key={id} id={id} {...nav} />;
}
