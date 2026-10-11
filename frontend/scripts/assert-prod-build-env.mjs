const isProd = process.env.PS_PRODUCTION?.trim() === "1";
const uiDev = process.env.NEXT_PUBLIC_CHARACTER_UI_DEV?.trim() === "1";

if (isProd && uiDev) {
  console.error("Production build refused: NEXT_PUBLIC_CHARACTER_UI_DEV must not be set when PS_PRODUCTION=1");
  process.exit(1);
}
