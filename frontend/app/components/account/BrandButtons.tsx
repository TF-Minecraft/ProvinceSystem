/* eslint-disable @next/next/no-img-element -- small fixed brand files from /public; next/image adds nothing here. */
import type { ButtonHTMLAttributes } from "react";

/**
 * Sign-in buttons in each service's own style. The logo files are the services'
 * official marks, served from /public so the page loads nothing from them:
 * Microsoft's dark "Sign in with Microsoft" button, Discord's white symbol on
 * Blurple, and Patreon's symbol in white on black.
 */

const brandClass =
  "inline-flex h-[41px] items-center gap-3 rounded-[3px] px-4 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)] disabled:opacity-50";

export function DiscordSignInLink({ href }: { href: string }) {
  return (
    <a href={href} className={`${brandClass} self-start bg-[#5865F2]`}>
      <img src="/brand/discord-symbol-white.svg" alt="" width={22} height={17} />
      Sign in with Discord
    </a>
  );
}

/** Microsoft's own artwork, which already carries the logo and the words. */
export function MicrosoftSignInButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      aria-label="Sign in with Microsoft"
      className="inline-flex self-start transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)] disabled:opacity-50"
    >
      <img src="/brand/microsoft-sign-in-dark.svg" alt="" width={215} height={41} />
    </button>
  );
}

export function PatreonConnectButton({ children = "Connect Patreon", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`${brandClass} border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-black`}
    >
      <img src="/brand/patreon-symbol-white.svg" alt="" width={16} height={16} />
      {children}
    </button>
  );
}
