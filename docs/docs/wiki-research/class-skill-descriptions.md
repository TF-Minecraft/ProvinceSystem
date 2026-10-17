# Class skill behavior audit

**Snapshot:** 2026-09-11
**Scope:** The 40 skill IDs in `frontend/app/wiki/data/classes.ts`. Descriptions below intentionally omit damage, duration, cooldown, mana, and other stat values.

Thirty-nine IDs have exact, case-insensitive root matches in the active MythicMobs class definitions. Mage and Musketeer have no class skills in the current class data. Display names below are the title form corroborated by the configured ID, nearby heading, and matching root skill. `PALADIN_SMITE` is unresolved: the class assigns that ID, but the searched behavior definitions contain only a root named `Smite`, and no source establishes that they are aliases.

## Player-facing mapping

### Archer

| ID | Display name | Concise behavior |
|---|---|---|
| `ARCHER_STEP` | Archer Step | Leaps backward to quickly create distance. |
| `DECOY` | Decoy | Creates copies of you that move toward players, then grants you a short burst of speed. |
| `ARROW_VOLLEY` | Arrow Volley | Empowers your next shot to release a wide volley of arrows. |
| `POISON_ARROW` | Poison Arrow | Empowers your next shot to damage and poison the target. |
| `TOTEM_MINE` | Totem Mine | Throws a mine that ignites and damages nearby targets when it activates. |
| `HAWK_EYE` | Hawk Eye | Empowers your next shot to reveal and slow targets around where the arrow lands. |
| `FREEZING_SHOT` | Freezing Shot | Empowers your next shot to immobilize the target. |
| `ARCHER_CLOAK` | Archer Cloak | Makes you invisible and faster until you attack, take damage, interact, or alter a block. |

Evidence: MythicMobs `skills/TFMC/Classes/tfmc_class_skills.yml:460-636`; decoy copy behavior in MythicMobs `mobs/TFMC/Classes/tfmc_skills_mobs.yml:1-24`.

### Bard

| ID | Display name | Concise behavior |
|---|---|---|
| `SOUND_WAVE` | Sound Wave | Fires three spreading sound waves that damage and slow enemies they hit. |
| `MEMENTO_MORI` | Memento Mori | Fires a homing musical projectile that blinds and withers its target. |
| `VIBRATIVE_STRIKE` | Vibrative Strike | Fires a sequence of accelerating waves that immobilize enemies around each impact. |
| `SHIELD_OF_HARMONY` | Shield of Harmony | Surrounds you with musical notes that repeatedly grant damage resistance to nearby players. |
| `ANGELIC_SERENADE` | Angelic Serenade | Summons a healing aura that restores nearby players over time. |
| `RHAPSODY` | Rhapsody | Grants Speed to you and nearby allies. |
| `SYMPHONY_OF_DESTRUCTION` | Symphony of Destruction | Sends a musical effect forward that erupts later, damaging and lifting enemies in the area. |
| `TELEPORT` | Teleport | Channels briefly, then teleports nearby players and you toward the targeted location. |

Evidence: `C:\Users\MSI\Desktop\plugins\MythicMobs\skills\3rd Party\SamusDev\Skills\bard_skills_mmoitems.yml:3-332`. Visual helper mobs are defined in `C:\Users\MSI\Desktop\plugins\MythicMobs\mobs\3rd Party\SamusDev\Skills\bard_mobs.yml`.

### Guardian

| ID | Display name | Concise behavior |
|---|---|---|
| `MENDING` | Mending | Roots and weakens you while repeatedly restoring your health. |
| `TREMORS` | Tremors | Sends repeated tremors around you that damage nearby enemies while limiting your movement. |
| `GUARDIAN_ANGEL` | Guardian Angel | Protects a targeted player by restoring part of the damage they take. |
| `GROUND_SMASH` | Ground Smash | Leaps and smashes down, immobilizing nearby targets when you land. |
| `GROUP_UP` | Group Up | Grants absorption to you and nearby players. |
| `SUBSTITUTE` | Substitute | Swaps places with your target. |
| `SHIELD_WALL` | Shield Wall | Roots you behind a protective wall, grants resistance, and blocks damage to nearby players. |
| `TANK_PULL` | Tank Pull | Pulls targets in a cone toward you and slows them. |

Evidence: `C:\Users\MSI\Desktop\plugins\MythicMobs\skills\TFMC\Classes\tfmc_class_skills.yml:1-167`.

### Paladin

| ID | Display name | Concise behavior |
|---|---|---|
| `SHIELD_UP` | Shield Up | Slows you while granting damage resistance. |
| `HEALING_STRIKE` | Healing Strike | Strikes in front of you, damaging and launching the target upward. |
| `BULK_UP` | Bulk Up | Slows you while increasing your melee strength. |
| `HEAL_AURA` | Heal Aura | Repeatedly restores health to you and nearby players. |
| `WAR_CRY` | War Cry | Weakens and reveals targets in a cone ahead of you. |
| `PALADIN_SMITE` | Paladin Smite | Unresolved. Do not publish a behavior description from this snapshot. |
| `BLESS` | Bless | Repeatedly clears slowing, weakness, poison, wither, and blindness from you and nearby players. |
| `CHALLENGE` | Challenge | Relocates you and a targeted player together while protecting both during the move. |

Evidence: `C:\Users\MSI\Desktop\plugins\MythicMobs\skills\TFMC\Classes\tfmc_class_skills.yml:169-318`. Healing Strike's active healing line is commented out at line 194, so the player description follows its active damage and launch mechanics rather than its name. The `Smite` root at lines 247-258 is not treated as proof for the differently named `PALADIN_SMITE` assignment.

### Warrior

| ID | Display name | Concise behavior |
|---|---|---|
| `WARRIOR_DASH` | Warrior Dash | Dashes forward and damages enemies along your path. |
| `WARRIOR_STRIKE` | Warrior Strike | Delivers a focused physical strike directly ahead. |
| `WARRIOR_HOOK` | Warrior Hook | Fires a chain that pulls the first enemy it catches toward you. |
| `WARRIOR_SWEEP` | Warrior Sweep | Sweeps nearby enemies away, damages them, and briefly limits their movement after they land. |
| `WARRIOR_LUNGE` | Warrior Lunge | Leaps to the targeted location and damages nearby enemies on arrival. |
| `WARRIOR_HEAL` | Warrior Heal | Restores your own health. |
| `WARRIOR_SHIELD` | Warrior Shield | Raises a temporary barrier that blocks the next hit against you. |
| `WARRIOR_BEAM` | Warrior Beam | Fires a physical beam that damages enemies along its path and near its impact. |

Evidence: `C:\Users\MSI\Desktop\plugins\MythicMobs\skills\TFMC\Classes\tfmc_class_skills.yml:320-458`.

## Class assignment evidence

The live assignments and modifiers are in:

- `C:\Users\MSI\Desktop\plugins\MMOCore\classes\archer.yml:57-130`
- `C:\Users\MSI\Desktop\plugins\MMOCore\classes\bard.yml:55-136`
- `C:\Users\MSI\Desktop\plugins\MMOCore\classes\guardian.yml:57-138`
- `C:\Users\MSI\Desktop\plugins\MMOCore\classes\paladin.yml:58-137`
- `C:\Users\MSI\Desktop\plugins\MMOCore\classes\warrior.yml:58-137`

The behavior descriptions trace the invoked root skills and their active child skills. Commented mechanics were excluded. Class level limits and skill statistics are outside this behavior mapping.

The unrelated files under `C:\Users\MSI\Desktop\plugins\MythicLib\skill` were excluded from this mapping because their skill IDs, such as `QUICK_SHOT` and `BACKSTEP`, do not match the 40 IDs assigned by the live MMOCore class files.
