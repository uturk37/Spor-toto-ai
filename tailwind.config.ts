import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#05080f", 900: "#0a1020", 800: "#0f1830", 700: "#16223f", 600: "#22335a", 500: "#3a4d78" },
        pitch: { 400: "#4ade80", 500: "#22c55e", 600: "#16a34a" },
        gold: { 300: "#fde047", 400: "#facc15", 500: "#eab308" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
