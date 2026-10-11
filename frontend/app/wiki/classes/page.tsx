import {
  Callout,
  CommandTable,
  DataTable,
  SeeAlso,
  WikiItemText,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { classSkills, classes, classesCommands, professions } from "../data/classes";

const skillName = (id: string) =>
  id
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export default function ClassesPage() {
  return (
    <WikiPage
      lastModified="2026-09-18"
      title="Classes and Character"
      intro="Choose one of seven combat classes, gain class levels, improve attributes, and level three gathering professions."
      width="lg"
    >
      <WikiSectionHeading id="start" intro="New characters are taken to class selection during creation.">
        Choose and play a class
      </WikiSectionHeading>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Read each class description and choose the equipment style you want to use.</li>
        <li>
          Open <code className="text-[var(--tfmc-accent)]">/player</code> to review your level, professions, attributes
          and party information.
        </li>
        <li>
          Open <code className="text-[var(--tfmc-accent)]">/attributes</code> to spend attribute points and{" "}
          <code className="text-[var(--tfmc-accent)]">/skills</code> to manage class skills.
        </li>
        <li>
          In the skills menu, shift-left-click a skill, then left-click a skill slot to bind it. Right-click a slot to
          unbind it.
        </li>
        <li>Press F, the swap-hands key, then press the number shown on the action bar to cast a bound skill.</li>
      </ol>
      <Callout variant="note" className="mt-4">
        Musketeer and Mage do not have class-skills.
      </Callout>

      <WikiSectionHeading id="classes" intro="Seven selectable classes cover different equipment and play styles.">
        Classes
      </WikiSectionHeading>
      <DataTable
        columns={[
          { header: "Class" },
          { header: "Equipment" },
          { header: "Class skills", align: "right" },
          { header: "Play style" },
        ]}
        rows={classes.map((c) => [
          c.name,
          <WikiItemText key={`${c.id}-equipment`} text={c.equipment} />,
          c.skillCount,
          <WikiItemText key={`${c.id}-lore`} text={c.lore} />,
        ])}
      />

      <WikiSectionHeading id="acts" intro="The active story act sets the highest class level you can reach.">
        Acts and level caps
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Act" }, { header: "Class level cap", align: "right" }]}
        rows={[
          ["Prologue", 6],
          ["Act 1", 11],
          ["Act 2", 16],
          ["Act 3", 21],
        ]}
      />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        When the server advances to a new act, the class level cap rises. Some item drops are also limited by act, so
        later materials may become available as the story progresses.
      </p>

      <WikiSectionHeading id="skills" intro="Listed class skills unlock at class level 2 and can reach skill level 4.">
        Skill reference
      </WikiSectionHeading>
      {Object.entries(classSkills).map(
        ([classId, skills]) =>
          skills.length > 0 && (
            <div key={classId} className="mt-5">
              <h3 className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
                {classes.find((c) => c.id === classId)?.name ?? classId}
              </h3>
              <DataTable
                className="mt-2"
                columns={[{ header: "Skill" }, { header: "What it does" }]}
                rows={skills.map((s) => [
                  s.displayName ?? skillName(s.id),
                  <WikiItemText key={`${classId}-${s.id}`} text={s.description ?? ""} />,
                ])}
              />
            </div>
          ),
      )}
      <WikiSectionHeading id="professions" intro="Professions level separately through their listed activities.">
        Professions
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Profession" }, { header: "How to level it" }]}
        rows={professions.map((p) => [p.displayName, <WikiItemText key={p.id} text={p.howItLevels} />])}
      />
      <h3 className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">How to earn EXP</h3>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {professions.map((p) => (
          <section
            key={p.id}
            id={`profession-${p.id}`}
            className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)] p-4"
          >
            <h4 className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
              {p.displayName}
            </h4>
            {p.activities.map((group) => (
              <div key={group.label} className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--tfmc-stone)]">{group.label}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="rounded border border-[color-mix(in_srgb,var(--tfmc-accent)_30%,transparent)] px-2 py-0.5 text-xs text-[var(--tfmc-mist)]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable commands={classesCommands.commands} />
      <SeeAlso
        hrefs={[
          "/wiki/characters",
          "/wiki/advanced-crafting",
          "/wiki/equipment-slots",
          "/wiki/gathering",
          "/wiki/commands",
        ]}
      />
    </WikiPage>
  );
}
