// Regenerate with: java -cp /path/to/guava.jar MetadataFixtures.java > metadata.json
// Standard ObjectOutputStream matches CoreProtect's Bukkit stream for these
// plain collections. Synthetic data only; no player records or private lore.
import java.io.*;
import java.util.*;
import java.util.zip.GZIPOutputStream;

class MetadataFixtures {
    static Map<String, String> fixtures = new LinkedHashMap<>();
    static void save(String name, Object value) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var out = new ObjectOutputStream(bytes)) { out.writeObject(value); }
        fixtures.put(name, Base64.getEncoder().encodeToString(bytes.toByteArray()));
    }
    static String custom(String type, String id) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var out = new DataOutputStream(new GZIPOutputStream(bytes))) {
            out.writeByte(10); out.writeUTF("");
            for (var e : Map.of("MMOITEMS_ITEM_TYPE", type, "MMOITEMS_ITEM_ID", id,
                    "PRIVATE_TEST_TAG", "never exposed").entrySet()) {
                out.writeByte(8); out.writeUTF(e.getKey()); out.writeUTF(e.getValue());
            }
            out.writeByte(0);
        }
        return Base64.getEncoder().encodeToString(bytes.toByteArray());
    }
    static Object item(String type, String id, String name) throws Exception {
        var meta = new LinkedHashMap<String, Object>();
        meta.put("meta-type", "UNSPECIFIC");
        if (type != null) meta.put("custom", custom(type, id));
        if (name != null) meta.put("display-name", name);
        meta.put("lore", new ArrayList<>(List.of("private lore never exposed")));
        return new ArrayList<>(List.of(new ArrayList<>(List.of(meta))));
    }
    public static void main(String[] args) throws Exception {
        save("mythril", item("MATERIALS", "MYTHRIL_INGOT", "{\"text\":\"Mythril Ingot\",\"color\":\"aqua\"}"));
        var immutable = Class.forName("com.google.common.collect.ImmutableMap").getMethod("copyOf", Map.class);
        var immutableMeta = immutable.invoke(null, Map.of("meta-type", "UNSPECIFIC", "custom", custom("MATERIALS", "MYTHRIL_INGOT"), "display-name", "Mythril Ingot"));
        save("guava", new ArrayList<>(List.of(new ArrayList<>(List.of(immutableMeta)))));
        save("renamed", item(null, null, "§bMythril Ingot"));
        save("alloy", item("CRAFTING", "ALLOY", "§6Mythril-Steel Alloy"));
        save("no_name", item("MATERIALS", "COKE", null));
        save("unicode", item("MATERIALS", "COKE", "\uD83D\uDD25 Coke"));
        save("vanilla", item(null, null, null));
        save("mob", new ArrayList<>(Arrays.asList(0, false, new ArrayList<>(), true, "§3Cursed Ghoul", null, null)));
        save("mythic", new ArrayList<>(List.of("coreprotect:mythic", "cursed_ghoul")));
        save("wrong_marker", new ArrayList<>(List.of("coreprotect:lock", "cursed_ghoul")));
        var cycle = new ArrayList<>(); cycle.add(cycle); save("cycle", cycle);
        System.out.println("{");
        var entries = new ArrayList<>(fixtures.entrySet());
        for (int i = 0; i < entries.size(); i++) {
            var e = entries.get(i);
            System.out.println("  \"" + e.getKey() + "\": \"" + e.getValue() + "\"" + (i + 1 == entries.size() ? "" : ","));
        }
        System.out.println("}");
    }
}
