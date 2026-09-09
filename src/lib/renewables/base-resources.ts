import type { GuideResource } from "./types";

const naturalItems = new Set(
  (
    "cobblestone stone granite diorite andesite deepslate cobbled_deepslate basalt blackstone " +
    "dirt coarse_dirt rooted_dirt grass_block mud clay clay_ball sand red_sand gravel sandstone " +
    "netherrack end_stone obsidian soul_sand soul_soil ice packed_ice blue_ice snow snowball " +
    "coal charcoal diamond emerald lapis_lazuli redstone glowstone_dust quartz amethyst_shard " +
    "flint iron_ingot gold_ingot copper_ingot netherite_ingot raw_iron raw_gold raw_copper " +
    "sugar_cane bamboo cactus kelp dried_kelp wheat wheat_seeds carrot potato beetroot beetroot_seeds " +
    "pumpkin pumpkin_seeds melon melon_slice melon_seeds cocoa_beans sweet_berries glow_berries " +
    "apple nether_wart brown_mushroom red_mushroom crimson_fungus warped_fungus moss_block " +
    "vine lily_pad azalea flowering_azalea sea_pickle pink_petals dandelion poppy blue_orchid " +
    "allium azure_bluet oxeye_daisy cornflower lily_of_the_valley wither_rose sunflower lilac " +
    "rose_bush peony spore_blossom bone bone_meal rotten_flesh string spider_eye gunpowder " +
    "ender_pearl blaze_rod blaze_powder slime_ball magma_cream leather feather egg ink_sac " +
    "glow_ink_sac prismarine_shard prismarine_crystals ghast_tear phantom_membrane shulker_shell " +
    "rabbit_hide rabbit_foot honeycomb honey_bottle scute nether_star beef porkchop chicken " +
    "mutton rabbit cod salmon tropical_fish pufferfish sugar"
  ).split(" "),
);

// Browsing policy only: excluded components remain in the production graph.
export function isBaseResource(resource: GuideResource): boolean {
  if (resource.kind === "fluid") return true;
  if (resource.kind !== "item") return false;
  const [namespace, name] = resource.id.split(":");
  if (namespace === "minecraft")
    return (
      naturalItems.has(name) ||
      /_(log|wood|stem|hyphae|sapling|leaves|coral|coral_fan|tulip|wool)$/.test(name)
    );
  if (/^(tiny|small|hot|chipped|flawed|flawless|exquisite)_/.test(name)) return false;
  if (
    [
      "gtceu",
      "monilabs",
      "kubejs",
      "thermal",
      "enderio",
      "ad_astra",
      "nuclearcraft",
      "ae2",
    ].includes(namespace)
  )
    return (
      /_(dust|ingot|gem|crystal|powder|raw_ore)$/.test(name) ||
      ["ae2:silicon", "ae2:matter_ball", "ae2:singularity", "gtceu:sticky_resin"].includes(
        resource.id,
      )
    );
  return false;
}
