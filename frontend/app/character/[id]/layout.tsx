import CharacterIdLayoutClient from "./CharacterIdLayoutClient";

export default function CharacterIdLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-8">
      <CharacterIdLayoutClient>{children}</CharacterIdLayoutClient>
    </main>
  );
}
