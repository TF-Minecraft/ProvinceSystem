"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import ModelPreview from "../../components/skins/ModelPreview";
import { isCharacterUiDev } from "../../../lib/characters/uiDev";

export default function DrinksDevPreviewPage() {
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState("#C45A12");

  if (!isCharacterUiDev()) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 px-6 py-16">
      <h1 className="text-2xl text-[var(--tfmc-cream)]">Drinks preview (dev)</h1>
      <label className="flex items-center gap-2 text-sm text-[var(--tfmc-stone)]">
        Color
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <code>{color}</code>
      </label>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <ModelPreview
        kind="handheld"
        flatDisplayPreset="generated"
        potionTintColor={color}
        textureFile={null}
        onPreviewError={setError}
      />
    </main>
  );
}
