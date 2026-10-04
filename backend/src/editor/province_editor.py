import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import random
import re
import os

TERRAINS = {
    "plains": (60, 80),
    "forest": (30, 40),
    "jungle": (70, 90),
    "hills": (15, 30),
    "highlands": (20, 35),
    "mountain": (0, 5),
    "bog": (0, 5),
    "drylands": (0, 5),
    "water": (0, 0),
    "sea": (0, 0)
}
def hex_to_rgb(hex_code: str):
    hex_code = hex_code.strip().lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", hex_code):
        raise ValueError("Invalid hex color")
    return tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))

def reid_file(file_path):
    """
    Rewrites the province file so IDs are continuous starting at 1.
    Returns (new_existing_rgbs, next_id)
    """
    entries = []

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Match: id = r,g,b;terrain;fertility
            match = re.match(
                r"\d+\s*=\s*(\d+,\d+,\d+);([^;]+);(\d+)",
                line
            )
            if not match:
                continue

            rgb = match.group(1)
            terrain = match.group(2)
            fertility = match.group(3)
            entries.append((rgb, terrain, fertility))

    # Rewrite file
    existing_rgbs = set()
    with open(file_path, "w", encoding="utf-8") as f:
        for idx, (rgb, terrain, fertility) in enumerate(entries, start=1):
            r, g, b = map(int, rgb.split(","))
            existing_rgbs.add((r, g, b))
            f.write(f"{idx} = {rgb};{terrain};{fertility}\n")

    return existing_rgbs, len(entries) + 1

def parse_existing(file_path):
    existing_rgbs = set()
    highest_id = 0

    if not os.path.exists(file_path):
        return existing_rgbs, 0

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            match = re.match(r"(\d+)\s*=\s*(\d+),(\d+),(\d+)", line)
            if match:
                pid = int(match.group(1))
                rgb = (int(match.group(2)), int(match.group(3)), int(match.group(4)))
                highest_id = max(highest_id, pid)
                existing_rgbs.add(rgb)

    return existing_rgbs, highest_id

def fill_missing_terrain(file_path, default_terrain="plains", default_fertility=50):
    """
    Adds default terrain and fertility to provinces missing them.
    Returns number of updated lines.
    """
    updated = 0
    new_lines = []

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                new_lines.append(line)
                continue

            # Full format already present
            if ";" in stripped:
                new_lines.append(line)
                continue

            # Province rows use id = r,g,b.
            match = re.match(r"(\d+)\s*=\s*(\d+,\d+,\d+)", stripped)
            if match:
                new_line = (
                    f"{match.group(1)} = {match.group(2)};"
                    f"{default_terrain};{default_fertility}\n"
                )
                new_lines.append(new_line)
                updated += 1
            else:
                new_lines.append(line)

    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    return updated


class ProvinceGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Province Editor")

        self.file_path = None
        self.existing_rgbs = set()
        self.next_id = 1

        self.build_ui()

    def build_ui(self):
        frm = ttk.Frame(self.root, padding=10)
        frm.grid()

        ttk.Button(frm, text="Select provinces.txt", command=self.select_file).grid(column=0, row=0, columnspan=2, pady=5)

        ttk.Label(frm, text="RGB (r,g,b):").grid(column=0, row=1, sticky="e")
        self.rgb_entry = ttk.Entry(frm, width=20)
        self.rgb_entry.grid(column=1, row=1)

        ttk.Label(frm, text="Terrain:").grid(column=0, row=2, sticky="e")
        self.terrain = tk.StringVar(value="plains")
        ttk.Combobox(frm, textvariable=self.terrain, values=list(TERRAINS.keys()), state="readonly").grid(column=1, row=2)

        ttk.Label(frm, text="Fertility (optional):").grid(column=0, row=3, sticky="e")
        self.fertility_entry = ttk.Entry(frm, width=20)
        self.fertility_entry.grid(column=1, row=3)

        ttk.Button(frm, text="Add Province", command=self.add_province).grid(column=0, row=4, columnspan=2, pady=10)

        ttk.Button(
            frm,
            text="Re-ID Provinces",
            command=self.reid_provinces
        ).grid(column=0, row=5, columnspan=2, pady=5)

        ttk.Button(
            frm,
            text="Fill Missing Terrain/Fertility",
            command=self.fill_missing
        ).grid(column=0, row=6, columnspan=2, pady=5)

    def fill_missing(self):
        if not self.file_path:
            messagebox.showerror("Error", "Select provinces.txt first")
            return

        updated = fill_missing_terrain(self.file_path)

        messagebox.showinfo(
            "Completed",
            f"Updated {updated} province(s) with default terrain 'plains' and fertility 50."
        )

    def select_file(self):
        path = filedialog.askopenfilename(filetypes=[("Text files", "*.txt")])
        if not path:
            return

        self.file_path = path
        self.existing_rgbs, highest_id = parse_existing(path)
        self.next_id = highest_id + 1

        messagebox.showinfo("Loaded", f"Loaded {path}\nNext ID: {self.next_id}")

    def reid_provinces(self):
        if not self.file_path:
            messagebox.showerror("Error", "Select provinces.txt first")
            return

        confirm = messagebox.askyesno(
            "Confirm Re-ID",
            "This will renumber ALL province IDs to be continuous.\n\nContinue?"
        )
        if not confirm:
            return

        self.existing_rgbs, self.next_id = reid_file(self.file_path)

        messagebox.showinfo(
            "Re-ID Complete",
            f"Re-numbered provinces successfully.\nNext ID: {self.next_id}"
        )

    def add_province(self):
        if not self.file_path:
            messagebox.showerror("Error", "Select provinces.txt first")
            return

        raw = self.rgb_entry.get().strip()
        try:
            if "," in raw:
                # r,g,b format
                r, g, b = map(int, raw.split(","))
                rgb = (r, g, b)
            else:
                # hex format
                rgb = hex_to_rgb(raw)
                r, g, b = rgb
        except Exception:
            messagebox.showerror(
                "Error",
                "RGB must be either:\n• r,g,b\n• 6-digit hex (e.g. 924f4f)"
            )
            return


        if rgb in self.existing_rgbs:
            messagebox.showerror("Error", "Province with this RGB already exists")
            return

        terrain = self.terrain.get()

        fertility_text = self.fertility_entry.get().strip()
        if fertility_text:
            fertility = int(fertility_text)
        else:
            lo, hi = TERRAINS[terrain]
            fertility = random.randint(lo, hi)

        line = f"{self.next_id} = {r},{g},{b};{terrain};{fertility}\n"

        with open(self.file_path, "a", encoding="utf-8") as f:
            f.write(line)

        self.existing_rgbs.add(rgb)
        self.next_id += 1

        messagebox.showinfo("Added", line.strip())


if __name__ == "__main__":
    root = tk.Tk()
    ProvinceGUI(root)
    root.mainloop()
