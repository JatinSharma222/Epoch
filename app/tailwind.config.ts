import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bp: {
          bg: "#0b0e11",
          panel: "#0e1217",
          surface: "#12161a",
          card: "#181d24",
          input: "#12161c",
          hover: "#1c222c",
          green: "#0ecb81",
          greenBg: "rgba(14, 203, 129, 0.12)",
          red: "#f6465d",
          redBg: "rgba(246, 70, 93, 0.12)",
          crimson: "#e54040",
          text: "#f0f3f6",
          textMuted: "#848e9c",
          textDark: "#4b5563",
          sol: "#9945ff",
          amber: "#eab308",
        },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      animation: {
        "marquee": "marquee 25s linear infinite",
        "pulse-fast": "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
