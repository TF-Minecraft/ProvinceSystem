"use client";

import { useEffect, useState } from "react";

import { getGameServer, type GameServer } from "@/lib/diagnostic/api";

const DEFAULT_ADDRESS = "play.tfminecraft.net";
const REFRESH_MS = 60_000;

/** The address players type, without the default port. */
function joinAddress(address: string): string {
  return address.replace(/:25565$/, "");
}

function statusLabel(server: GameServer | null, failed: boolean): { text: string; dot: string } {
  if (failed || server?.online === false) return { text: "Offline", dot: "bg-[#c97a6a]" };
  if (!server) return { text: "Checking…", dot: "bg-[var(--tfmc-mist)] opacity-60" };
  const count = server.players_online ?? 0;
  return {
    text: `${count} ${count === 1 ? "player" : "players"} online`,
    dot: "bg-[#7fd18b] shadow-[0_0_8px_#7fd18b]",
  };
}

/** Server address with a copy button and the live player count. */
export default function JoinServer() {
  const [server, setServer] = useState<GameServer | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const address = server ? joinAddress(server.address) : DEFAULT_ADDRESS;
  const status = statusLabel(server, failed);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-stretch overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_70%,transparent)] shadow-[0_8px_30px_rgb(0_0_0/0.25)] backdrop-blur-sm">
        <span className="flex items-center px-4 font-mono text-base tracking-wide text-[var(--tfmc-cream)] select-all sm:px-5 sm:text-lg">
          {address}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(address).then(() => setCopied(true));
          }}
          className="min-w-[5.5rem] border-l border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="flex items-center gap-2 text-sm text-[var(--tfmc-mist)]" aria-live="polite">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
        <span>{status.text}</span>
        {server ? <span aria-hidden>·</span> : null}
        {server ? <span>Java {server.game_version}</span> : null}
      </p>
    </div>
  );
}
