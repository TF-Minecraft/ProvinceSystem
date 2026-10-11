export type CropPlantModelAsset = {
  modelUrl: string;
  textureUrls: Record<string, string>;
  sourceCropId: string;
  maturePoint: number;
  matureModelId: string;
};

/** Harvest-ready models traced from CustomCrops points to the active ItemsAdder pack. */
export const cropPlantModels: Record<string, CropPlantModelAsset> = {
  apple: {
    modelUrl: "/wiki/models/crops/apple.json",
    textureUrls: {
      "0": "/wiki/textures/vanilla/oak_log.png",
      "1": "/wiki/textures/crop-plants/apple/stage.png",
      particle: "/wiki/textures/vanilla/oak_log.png",
    },
    sourceCropId: "apple",
    maturePoint: 5,
    matureModelId: "apple_stage_6",
  },
  banana: {
    modelUrl: "/wiki/models/crops/banana.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/banana/banana_block.png",
      particle: "/wiki/textures/crop-plants/banana/banana_block.png",
    },
    sourceCropId: "banana",
    maturePoint: 4,
    matureModelId: "banana_stage_5",
  },
  "cactus-fruit": {
    modelUrl: "/wiki/models/crops/cactus-fruit.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/cactusfruit/cactusfruit_block.png",
      particle: "/wiki/textures/crop-plants/cactusfruit/cactusfruit_block.png",
    },
    sourceCropId: "cactusfruit",
    maturePoint: 4,
    matureModelId: "cactusfruit_stage_5",
  },
  cherry: {
    modelUrl: "/wiki/models/crops/cherry.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/cherry/cherry_block.png",
      particle: "/wiki/textures/crop-plants/cherry/cherry_block.png",
    },
    sourceCropId: "cherry",
    maturePoint: 4,
    matureModelId: "cherry_stage_5",
  },
  grape: {
    modelUrl: "/wiki/models/crops/grape.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/base/sprinkler_1.png",
      "1": "/wiki/textures/crop-plants/grape/stage_3.png",
      "2": "/wiki/textures/crop-plants/grape/stage_4.png",
      "3": "/wiki/textures/crop-plants/grape/grape.png",
      particle: "/wiki/textures/crop-plants/base/sprinkler_1.png",
    },
    sourceCropId: "grape",
    maturePoint: 5,
    matureModelId: "grape_stage_6",
  },
  lemon: {
    modelUrl: "/wiki/models/crops/lemon.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/lemon/lemon_block.png",
      particle: "/wiki/textures/crop-plants/lemon/lemon_block.png",
    },
    sourceCropId: "lemon",
    maturePoint: 4,
    matureModelId: "lemon_stage_5",
  },
  lime: {
    modelUrl: "/wiki/models/crops/lime.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/lime/lime_block.png",
      particle: "/wiki/textures/crop-plants/lime/lime_block.png",
    },
    sourceCropId: "lime",
    maturePoint: 4,
    matureModelId: "lime_stage_5",
  },
  orange: {
    modelUrl: "/wiki/models/crops/orange.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/orange/orange_block.png",
      particle: "/wiki/textures/crop-plants/orange/orange_block.png",
    },
    sourceCropId: "orange",
    maturePoint: 4,
    matureModelId: "orange_stage_5",
  },
  peach: {
    modelUrl: "/wiki/models/crops/peach.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/peach/peach_block.png",
      particle: "/wiki/textures/crop-plants/peach/peach_block.png",
    },
    sourceCropId: "peach",
    maturePoint: 4,
    matureModelId: "peach_stage_5",
  },
  pineapple: {
    modelUrl: "/wiki/models/crops/pineapple.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/pineapple/pineapple_blocks.png",
      particle: "/wiki/textures/crop-plants/pineapple/pineapple_blocks.png",
    },
    sourceCropId: "pineapple",
    maturePoint: 3,
    matureModelId: "pineapple_stage_4",
  },
  pistachio: {
    modelUrl: "/wiki/models/crops/pistachio.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/pistachio/pistachio_block.png",
      particle: "/wiki/textures/crop-plants/pistachio/pistachio_block.png",
    },
    sourceCropId: "pistachio",
    maturePoint: 3,
    matureModelId: "pistachio_stage_4",
  },
  plum: {
    modelUrl: "/wiki/models/crops/plum.json",
    textureUrls: {
      "0": "/wiki/textures/vanilla/oak_log.png",
      "1": "/wiki/textures/crop-plants/plum/stage.png",
      particle: "/wiki/textures/vanilla/oak_log.png",
    },
    sourceCropId: "plum",
    maturePoint: 5,
    matureModelId: "plum_stage_6",
  },
  strawberry: {
    modelUrl: "/wiki/models/crops/strawberry.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/strawberry/strawberry_block.png",
      particle: "/wiki/textures/crop-plants/strawberry/strawberry_block.png",
    },
    sourceCropId: "strawberry",
    maturePoint: 2,
    matureModelId: "strawberry_stage_3",
  },
  tomato: {
    modelUrl: "/wiki/models/crops/tomato.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/tomato/tomato_block.png",
      particle: "/wiki/textures/crop-plants/tomato/tomato_block.png",
    },
    sourceCropId: "tomato",
    maturePoint: 3,
    matureModelId: "tomato_stage_4",
  },
  corn: {
    modelUrl: "/wiki/models/crops/corn.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/corn/corn_block.png",
      particle: "/wiki/textures/crop-plants/corn/corn_block.png",
    },
    sourceCropId: "corn",
    maturePoint: 3,
    matureModelId: "corn_stage_4",
  },
  cucumber: {
    modelUrl: "/wiki/models/crops/cucumber.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/cucumber/cucumber_block.png",
      particle: "/wiki/textures/crop-plants/cucumber/cucumber_block.png",
    },
    sourceCropId: "cucumber",
    maturePoint: 3,
    matureModelId: "cucumber_stage_4",
  },
  garlic: {
    modelUrl: "/wiki/models/crops/garlic.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/garlic/stage_1.png",
      "1": "/wiki/textures/crop-plants/garlic/stage_4.png",
      particle: "/wiki/textures/crop-plants/garlic/stage_1.png",
    },
    sourceCropId: "garlic",
    maturePoint: 3,
    matureModelId: "garlic_stage_4",
  },
  lettuce: {
    modelUrl: "/wiki/models/crops/lettuce.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/lettuce/lettuce_block.png",
      particle: "/wiki/textures/crop-plants/lettuce/lettuce_block.png",
    },
    sourceCropId: "lettuce",
    maturePoint: 2,
    matureModelId: "lettuce_stage_3",
  },
  "mustard-seeds": {
    modelUrl: "/wiki/models/crops/mustard-seeds.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/mustard/mustard_block.png",
      particle: "/wiki/textures/crop-plants/mustard/mustard_block.png",
    },
    sourceCropId: "mustard",
    maturePoint: 4,
    matureModelId: "mustard_stage_5",
  },
  olive: {
    modelUrl: "/wiki/models/crops/olive.json",
    textureUrls: {
      "0": "/wiki/textures/vanilla/oak_log.png",
      "1": "/wiki/textures/crop-plants/olive/stage.png",
      particle: "/wiki/textures/vanilla/oak_log.png",
    },
    sourceCropId: "olive",
    maturePoint: 4,
    matureModelId: "olive_stage_5",
  },
  onion: {
    modelUrl: "/wiki/models/crops/onion.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/moolis/moolis_block.png",
      particle: "/wiki/textures/crop-plants/moolis/moolis_block.png",
    },
    sourceCropId: "onion",
    maturePoint: 2,
    matureModelId: "onion_stage_3",
  },
  rhubarb: {
    modelUrl: "/wiki/models/crops/rhubarb.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/rhubarb/rhubarb_block.png",
      particle: "/wiki/textures/crop-plants/rhubarb/rhubarb_block.png",
    },
    sourceCropId: "rhubarb",
    maturePoint: 2,
    matureModelId: "rhubarb_stage_3",
  },
  rice: {
    modelUrl: "/wiki/models/crops/rice.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/rice/rice_block.png",
      particle: "/wiki/textures/crop-plants/rice/rice_block.png",
    },
    sourceCropId: "rice",
    maturePoint: 3,
    matureModelId: "rice_stage_4",
  },
  yeast: {
    modelUrl: "/wiki/models/crops/yeast.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/yeast/yeast_block.png",
      particle: "/wiki/textures/crop-plants/yeast/yeast_block.png",
    },
    sourceCropId: "yeast",
    maturePoint: 3,
    matureModelId: "yeast_stage_4",
  },
  basil: {
    modelUrl: "/wiki/models/crops/basil.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/basil/basil_block.png",
      particle: "/wiki/textures/crop-plants/basil/basil_block.png",
    },
    sourceCropId: "basil",
    maturePoint: 3,
    matureModelId: "basil_stage_4",
  },
  "black-pepper": {
    modelUrl: "/wiki/models/crops/black-pepper.json",
    textureUrls: {
      "0": "/wiki/textures/crop-plants/blackpepper/blackpepper_block.png",
      particle: "/wiki/textures/crop-plants/blackpepper/blackpepper_block.png",
    },
    sourceCropId: "blackpepper",
    maturePoint: 3,
    matureModelId: "blackpepper_stage_4",
  },
  cinnamon: {
    modelUrl: "/wiki/models/crops/cinnamon.json",
    textureUrls: {
      "1": "/wiki/textures/crop-plants/vanilla/stage_5.png",
      particle: "/wiki/textures/crop-plants/vanilla/stage_5.png",
    },
    sourceCropId: "cinnamon",
    maturePoint: 4,
    matureModelId: "cinnamon_stage_5",
  },
  nutmeg: {
    modelUrl: "/wiki/models/crops/nutmeg.json",
    textureUrls: {
      "1": "/wiki/textures/crop-plants/vanilla/stage_5.png",
      particle: "/wiki/textures/crop-plants/vanilla/stage_5.png",
    },
    sourceCropId: "nutmeg",
    maturePoint: 4,
    matureModelId: "nutmeg_stage_5",
  },
  "spice-leaf": {
    modelUrl: "/wiki/models/crops/spice-leaf.json",
    textureUrls: { particle: "/wiki/textures/crop-plants/spiceleaf/spiceleaf_block.png" },
    sourceCropId: "spiceleaf",
    maturePoint: 2,
    matureModelId: "spiceleaf_stage_3",
  },
  vanilla: {
    modelUrl: "/wiki/models/crops/vanilla.json",
    textureUrls: {
      "1": "/wiki/textures/crop-plants/vanilla/stage_5.png",
      particle: "/wiki/textures/crop-plants/vanilla/stage_5.png",
    },
    sourceCropId: "vanilla",
    maturePoint: 4,
    matureModelId: "vanilla_stage_5",
  },
};
