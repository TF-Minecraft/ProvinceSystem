"use client";

import { useEffect, useRef, useState } from "react";

import { getGameServer, type GameServer } from "@/lib/diagnostic/api";

const DEFAULT_ADDRESS = "play.tfminecraft.net";
const REFRESH_MS = 60_000;

/** The address players type, without the default port. */
function joinAddress(address: string): string {
  return address.replace(/:25565$/, "");
}

function statusLabel(server: GameServer | null, failed: boolean): string {
  if (failed || server?.online === false) return "Offline";
  if (!server) return "Checking…";
  const count = server.players_online;
  if (count === null) return "Online";
  return `${count} ${count === 1 ? "player" : "players"} online`;
}

/** Server address with a copy button and the live player count. */
export default function JoinServer() {
  const [server, setServer] = useState<GameServer | null>(null);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const addressRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getGameServer()
        .then((next) => {
          if (!active) return;
          setServer(next);
          setFailed(false);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (copy === "idle") return;
    const timer = window.setTimeout(() => setCopy("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copy]);

  const address = server ? joinAddress(server.address) : DEFAULT_ADDRESS;
  const status = statusLabel(server, failed);

  async function copyAddress() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(address);
      setCopy("copied");
    } catch {
      // No clipboard access (plain http, old browsers, denied): select the address to copy by hand.
      const node = addressRef.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      setCopy("failed");
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-stretch overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_70%,transparent)] shadow-[0_8px_30px_rgb(0_0_0/0.25)] backdrop-blur-sm">
        <span
          ref={addressRef}
          className="flex items-center px-4 text-base font-semibold tracking-wide text-[var(--tfmc-cream)] select-all sm:px-5 sm:text-lg"
        >
          {address}
        </span>
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="min-w-[5.5rem] border-l border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
        >
          {copy === "copied" ? "Copied" : copy === "failed" ? "Copy by hand" : "Copy"}
        </button>
      </div>
      <p className="flex items-center gap-2 text-sm text-[var(--tfmc-mist)]" aria-live="polite">
        <span>{status}</span>
        {server ? <span aria-hidden>·</span> : null}
        {server ? <span>Java {server.game_version}</span> : null}
      </p>
    </div>
  );
}
