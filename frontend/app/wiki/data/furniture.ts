import type { WikiCommandSet, WikiSection } from "./types";

export type FurnitureRow = { name:string; id:string; surface:string; rotate:boolean; pickup:boolean; carry:boolean; solid:boolean; slots:string };
const cooking = (name:string,id:string,carry=false,solid=false,slots="Cooking-controlled or configured slots"): FurnitureRow => ({name,id:`tfmc_cooking:${id}`,surface:"Floor",rotate:true,pickup:true,carry,solid,slots});
export const furniture: FurnitureRow[] = [
  cooking("Frying Pan","frying_pan",true,false,"2 clickable (cut vegetables / meats); butter display-only"),
  cooking("Saucepan","saucepan",true,false,"No clickable slots; Cooking controls 2 inputs + liquid"),
  cooking("Pot","pot",true,false,"Ladle slot only; 5 inputs + liquid are hidden"),
  cooking("Bowl","bowl",true,false,"No clickable slots; Cooking controls all inputs"),
  cooking("Cutting Board","cutting_board"), cooking("Butter Churn","butter_churn"),
  cooking("Butter Plate","butter_plate",true), cooking("Plate","plate",true), cooking("Bucket","bucket"),
  cooking("Fire Pit","fire_pit",false,false,"Configured to place items inside"),
  {...cooking("Meat Hook","meat_hook"),surface:"None configured"}, cooking("Mixing Bowl","mixing_bowl"),
  cooking("Milling Stone","milling_stone"), cooking("Oven Bottom","oven_bottom",false,true),
  cooking("Bread Tray","bread_tray",true), cooking("Oven Top","oven_top"),
  cooking("Liquid Container","liquid_container",false,true), cooking("Sausage Maker","sausage_maker"),
  cooking("Trough","trough",true,true,"4 display-only feed slots; fill it with any vegetable mix to make Universal Feed"),
  {name:"Tool Shelf",id:"tfmc_cooking:tool_shelf",surface:"Wall",rotate:false,pickup:true,carry:false,solid:false,slots:"3: cutting knife, ladle or masher only"},
  {name:"Pedestal",id:"tfmc:pedestal",surface:"Floor",rotate:true,pickup:true,carry:false,solid:true,slots:"1; any item"},
  {name:"Artifact Display",id:"tfmc:artifact_display",surface:"Floor",rotate:true,pickup:true,carry:false,solid:true,slots:"1; any item"},
  {name:"Lure",id:"tfmc:lure",surface:"Floor",rotate:true,pickup:true,carry:false,solid:false,slots:"None"},
];

export const furnitureRecipes = [
  {pieces:"Cutting Knife, Ladle, Masher, Frying Pan, Saucepan, Pot, Meat Hook, Sausage Maker, Liquid Container, Bread Tray",station:"Meal Prep Station",cost:"1 Iron Ingot each",time:"2 s"},
  {pieces:"Oven Bottom, Oven Top, Milling Stone",station:"Meal Prep Station",cost:"1 Stone each",time:"2 s"},
  {pieces:"Trough",station:"Animal Station",cost:"1 Oak Planks",time:"2 s"},
  {pieces:"Tool Shelf, Fire Pit, Cutting Board, Butter Churn, Butter Plate, Mixing Bowl, Empty Cup, Plate, Bowl",station:"Meal Prep Station",cost:"1 Oak Planks each",time:"2 s"},
  {pieces:"Pedestal, Artifact Display",station:"Block Station",cost:"2 Cobblestone each",time:"5 s"},
  {pieces:"Lure",station:"Block Station",cost:"2 Oak Planks",time:"2 s"},
];
export const furnitureCommands: WikiCommandSet = {system:"InteractibleFurniture",href:"/wiki/furniture",commands:[],excludedStaffCommands:["/if reload","/if nested attach|detach","/if debug <on|off>"]};
export const furnitureSection: WikiSection = {nav:{href:"/wiki/furniture",label:"Interactive Furniture",category:"professions",blurb:"Place, carry and fill 26 interactive cooking and display furniture definitions."},commands:furnitureCommands};
