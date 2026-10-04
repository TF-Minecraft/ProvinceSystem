import { stationRecipe } from "./station-recipes";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";
export type GunPart={part:string;kind:string;for:string;tier:string;stats:string;cost:string;rank:string};
export const gunParts:GunPart[]=[
{part:"Smoothbore Barrel (Long)",kind:"Barrel",for:"Rifle",tier:"I",stats:"Acc +5; speed 10; ironshot",cost:"4 Iron Ingot",rank:"iron"},{part:"Rifled Barrel (Long)",kind:"Barrel",for:"Rifle",tier:"II",stats:"Acc +10; reload −4; speed 8; iron/steelshot",cost:"4 Steel Ingot",rank:"steel"},{part:"Smoothbore Barrel (Short)",kind:"Barrel",for:"Pistol",tier:"I",stats:"Acc +3; speed 8; ironshot",cost:"4 Iron Ingot",rank:"iron"},{part:"Rifled Barrel (Short)",kind:"Barrel",for:"Pistol",tier:"II",stats:"Acc +7; reload −4; speed 7; iron/steelshot",cost:"4 Steel Ingot",rank:"steel"},{part:"Spread Barrel",kind:"Barrel",for:"Shotgun",tier:"II",stats:"Acc −8; reload −10; spreadshot",cost:"4 Steel Ingot",rank:"steel"},{part:"Launcher Barrel",kind:"Barrel",for:"Launcher",tier:"III",stats:"Acc −6; fire +16; reload −10; rocket",cost:"4 Abyssalite Ingot",rank:"abyssalite"},
{part:"Muzzle Loader",kind:"Loader",for:"All",tier:"I",stats:"Acc +4; fire +2; reload +4; speed 4",cost:"2 Iron Ingot",rank:"iron"},{part:"Breech Loader",kind:"Loader",for:"Rifle/Shotgun/Launcher",tier:"IV",stats:"Acc +2; fire +5; reload +12; speed 3",cost:"2 Mythril Ingot",rank:"mythril"},
{part:"Single Shot",kind:"Chamber",for:"Rifle/Pistol/Shotgun",tier:"I",stats:"Capacity 1; acc +2; reload +2; speed 3",cost:"2 Iron Ingot",rank:"iron"},{part:"Single Shot (launcher)",kind:"Chamber",for:"Launcher",tier:"III",stats:"Capacity 1; acc +8; reload +4; speed 4",cost:"2 Abyssalite Ingot",rank:"abyssalite"},{part:"Quad Shot",kind:"Chamber",for:"Launcher",tier:"IV",stats:"Capacity 4; acc +2; reload −10; speed 3",cost:"2 Mythril Ingot",rank:"mythril"},{part:"Revolver",kind:"Chamber",for:"Rifle/Pistol",tier:"III",stats:"Capacity 6; acc −1; fire +4; reload −12; speed 1; dmg −3",cost:"2 Abyssalite Ingot",rank:"abyssalite"},
{part:"Steamlock",kind:"Action",for:"Rifle/Pistol",tier:"I",stats:"Acc +1; fire +4; speed −3; forces ironshot; smokeless",cost:"2 Iron Ingot",rank:"iron"},{part:"Matchlock",kind:"Action",for:"Rifle/Pistol/Shotgun",tier:"II",stats:"Acc +1; fire +1",cost:"2 Steel Ingot",rank:"steel"},{part:"Flintlock",kind:"Action",for:"Rifle/Pistol/Shotgun",tier:"III",stats:"Acc +2; fire +2",cost:"2 Abyssalite Ingot",rank:"abyssalite"},{part:"Rocketlock",kind:"Action",for:"Launcher",tier:"III",stats:"Acc +3; fire −10; reload −6",cost:"2 Abyssalite Ingot",rank:"abyssalite"},{part:"Experimental Arclock",kind:"Action",for:"Rifle",tier:"IV",stats:"Acc +8; fire −12; reload −10; speed 8; forces bronzeshot",cost:"2 Mythril Ingot",rank:"mythril"},
{part:"Oak Stock",kind:"Stock",for:"Rifle/Shotgun",tier:"I",stats:"Acc +3",cost:"2 Refined Barkwood",rank:"iron"},{part:"Maplewood Stock",kind:"Stock",for:"Rifle/Shotgun",tier:"II",stats:"Acc +4",cost:"2 Refined Maplewood",rank:"steel"},{part:"Elderwood Stock",kind:"Stock",for:"Rifle/Shotgun",tier:"III",stats:"Acc +5",cost:"2 Refined Elderwood",rank:"abyssalite"},{part:"Demonwood Stock",kind:"Stock",for:"Rifle/Shotgun",tier:"IV",stats:"Acc +6",cost:"2 Refined Demonwood",rank:"mythril"}];
// Mirrors GunsAndGadgets/ammunition.yml. Each id is also the Alchemy Station recipe that makes it.
export const gunAmmo=[
{ammo:"Iron Shot",id:"ironshot",damage:6,accuracy:-1,pierce:4,projectiles:1},
{ammo:"Steel Shot",id:"steelshot",damage:10,accuracy:2,pierce:6,projectiles:1},
{ammo:"Bronze Shot",id:"bronzeshot",damage:14,accuracy:4,pierce:8,projectiles:1},
{ammo:"Mythril Shot",id:"mythrilshot",damage:18,accuracy:6,pierce:10,projectiles:1},
{ammo:"Iron Spreadshot",id:"ironspreadshot",damage:1,range:20,projectiles:16},
{ammo:"Steel Spreadshot",id:"steelspreadshot",damage:1,range:22,projectiles:18},
{ammo:"Bronze Spreadshot",id:"bronzespreadshot",damage:1,range:24,projectiles:20},
{ammo:"Mythril Spreadshot",id:"mythrilspreadshot",damage:1,range:26,projectiles:22},
{ammo:"Iron Rocket",id:"ironrocket",damage:14,accuracy:1,pierce:10,projectiles:1,rocket:true},
{ammo:"Steel Rocket",id:"steelrocket",damage:16,accuracy:1,pierce:12,projectiles:1,rocket:true},
{ammo:"Bronze Rocket",id:"bronzerocket",damage:18,accuracy:2,pierce:13,projectiles:1,rocket:true},
{ammo:"Mythril Rocket",id:"mythrilrocket",damage:20,accuracy:2,pierce:14,projectiles:1,rocket:true},
{ammo:"Powered Iron Shot",id:"ironshot_powered",damage:8,accuracy:0,pierce:5,projectiles:1},
{ammo:"Powered Steel Shot",id:"steelshot_powered",damage:12,accuracy:3,pierce:7,projectiles:1},
{ammo:"Powered Bronze Shot",id:"bronzeshot_powered",damage:16,accuracy:5,pierce:9,projectiles:1},
{ammo:"Powered Mythril Shot",id:"mythrilshot_powered",damage:20,accuracy:7,pierce:11,projectiles:1},
{ammo:"Powered Iron Spreadshot",id:"ironspreadshot_powered",damage:1,range:21,projectiles:17},
{ammo:"Powered Steel Spreadshot",id:"steelspreadshot_powered",damage:1,range:23,projectiles:19},
{ammo:"Powered Bronze Spreadshot",id:"bronzespreadshot_powered",damage:1,range:25,projectiles:21},
{ammo:"Powered Mythril Spreadshot",id:"mythrilspreadshot_powered",damage:1,range:27,projectiles:23},
{ammo:"Powered Iron Rocket",id:"ironrocket_powered",damage:15,accuracy:1,pierce:11,projectiles:1,rocket:true},
{ammo:"Powered Steel Rocket",id:"steelrocket_powered",damage:17,accuracy:1,pierce:13,projectiles:1,rocket:true},
{ammo:"Powered Bronze Rocket",id:"bronzerocket_powered",damage:19,accuracy:2,pierce:14,projectiles:1,rocket:true},
{ammo:"Powered Mythril Rocket",id:"mythrilrocket_powered",damage:21,accuracy:2,pierce:15,projectiles:1,rocket:true}];
// Keyed by part name, not by array index: an unmapped part renders its name in the
// output slot instead of silently borrowing the neighbouring part's texture.
// GunsAndGadgets/parts.yml configures demonwood_stock with the same GRAY_DYE
// model 30 and display model as elderwood_stock, so both intentionally use the
// server pack's elderwood stock sprite.
const partTextureIds: Record<string,string> = {"Smoothbore Barrel (Long)":"smoothbore_barrel_long","Rifled Barrel (Long)":"rifled_barrel_long","Smoothbore Barrel (Short)":"smoothbore_barrel_short","Rifled Barrel (Short)":"rifled_barrel_short","Spread Barrel":"spread_barrel","Launcher Barrel":"launcher_barrel","Muzzle Loader":"muzzle_loader","Breech Loader":"breech_loader","Single Shot":"single_shot","Single Shot (launcher)":"single_shot_rocket","Quad Shot":"quad_shot_rocket","Revolver":"revolver","Steamlock":"steamlock","Matchlock":"matchlock","Flintlock":"flintlock","Rocketlock":"rocketlock","Experimental Arclock":"arclock","Oak Stock":"oak_stock","Maplewood Stock":"maplewood_stock","Elderwood Stock":"elderwood_stock","Demonwood Stock":"elderwood_stock"};
const materialTextures: Record<string,string> = {"Iron Ingot":"/wiki/textures/vanilla/iron_ingot.png","Steel Ingot":"/wiki/textures/materials/steel_ingot.png","Abyssalite Ingot":"/wiki/textures/materials/abyssalite_ingot.png","Mythril Ingot":"/wiki/textures/materials/mythril_ingot.png","Refined Barkwood":"/wiki/textures/materials/refined_barkwood.png","Refined Maplewood":"/wiki/textures/materials/refined_maplewood.png","Refined Elderwood":"/wiki/textures/materials/refined_elderwood.png","Refined Demonwood":"/wiki/textures/materials/refined_demonwood.png","Gravel":"/wiki/textures/vanilla/gravel.png","Gunpowder":"/wiki/textures/vanilla/gunpowder.png","Bronze Ingot":"/wiki/textures/materials/bronze_ingot.png"};
function ingredients(text:string){return text.split(" + ").map(value=>{const match=value.match(/^(\d+) (.+)$/);return {qty:Number(match?.[1]??1),name:match?.[2]??value};});}
export const gunPartRecipes: Recipe[] = gunParts.map(part => ({key:`gun-part-${part.part}`,title:part.part,station:"Gunsmithing Station",requirement:`Musketeer + ${part.rank[0].toUpperCase()+part.rank.slice(1)} Smith`,ingredients:ingredients(part.cost).map(item=>({...item,texture:materialTextures[item.name]})),output:{name:part.part,qty:1,sourceId:`gunsandgadgets:part:${part.part === "Demonwood Stock" ? "demonwood_stock" : part.part === "Single Shot (launcher)" ? "single_shot_launcher" : part.part === "Quad Shot" ? "quad_shot" : partTextureIds[part.part]}`,texture:`/wiki/textures/gun-parts/${partTextureIds[part.part]}.png`}}));
export const gunAmmoRecipes: Recipe[] = gunAmmo.map(ammo => stationRecipe(`gen-alchemy-station-${ammo.id.replace("_", "-")}`));
export const gunsCommands:WikiCommandSet={system:"GunsAndGadgets",href:"/wiki/guns",commands:[],excludedStaffCommands:["/gg reload","/gg refresh"]};
export const gunsSection:WikiSection={nav:{href:"/wiki/guns",label:"Guns & Gunsmithing",category:"combat",blurb:"Build Musketeer firearms from parts, then compare ammunition, spread, reload and armour penetration."},recipes:gunPartRecipes,commands:gunsCommands};
