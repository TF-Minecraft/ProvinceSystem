"use client";

import {
  isSectionName,
  SECTION_LABELS,
  SECTION_ORDER,
  type SectionName,
} from "@/lib/patchnotes/notes";

import { reviewButtonClass, reviewInputClass } from "./ReviewLine";

type AddLineProps = {
  section: SectionName;
  text: string;
  disabled: boolean;
  onSectionChange: (section: SectionName) => void;
  onTextChange: (text: string) => void;
  onAdd: () => void;
};

export default function AddLine({
  section,
  text,
  disabled,
  onSectionChange,
  onTextChange,
  onAdd,
}: AddLineProps) {
  return (
    <section className="mt-5 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] pt-3">
      <h3 className="text-sm font-semibold text-[var(--tfmc-cream)]">Add a line</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          aria-label="New line section"
          className={reviewInputClass}
          value={section}
          disabled={disabled}
          onChange={(event) => {
            if (isSectionName(event.target.value)) onSectionChange(event.target.value);
          }}
        >
          {SECTION_ORDER.map((item) => (
            <option key={item} value={item}>
              {SECTION_LABELS[item]}
            </option>
          ))}
        </select>
        <input
          aria-label="New line text"
          className={`${reviewInputClass} min-w-48 flex-1`}
          value={text}
          disabled={disabled}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <button
          className={reviewButtonClass}
          type="button"
          disabled={disabled || !text.trim()}
          onClick={onAdd}
        >
          Add line
        </button>
      </div>
    </section>
  );
}
