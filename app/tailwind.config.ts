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
          base: '#0B0E11',
          panel: '#0E1217',
          surface: '#12161C',
          elevated: '#181D24',
          hover: '#1F2633',
          overlay: '#272A2E',
          green: '#00C087',
          'green-hover': '#00A372',
          'green-bg': 'rgba(0, 192, 135, 0.12)',
          'green-text': '#0ECB81',
          red: '#F23645',
          'red-hover': '#D92D3B',
          'red-bg': 'rgba(242, 54, 69, 0.12)',
          'red-text': '#F6465D',
          brand: '#E54040',
          'brand-hover': '#D03838',
          accent: '#00F0FF',
          amber: '#EAB308',
          sol: '#9945FF',
          text: '#FFFFFF',
          'text-secondary': '#B7BDC6',
          'text-muted': '#848E9C',
          'text-disabled': '#4B5563',
        },
      },
      fontFamily: {
        sans: ['Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xxs': ['10px', '14px'],
        'xs': ['11px', '14px'],
        'sm': ['12px', '16px'],
        'base': ['13px', '18px'],
        'lg': ['14px', '20px'],
        'xl': ['15px', '20px'],
        '2xl': ['16px', '20px'],
        '3xl': ['18px', '24px'],
        '4xl': ['24px', '32px'],
      },
      borderRadius: {
        'sm': '2px',
        'DEFAULT': '4px',
        'md': '6px',
        'lg': '8px',
      },
      spacing: {
        'gutter': '4px',
      },
      animation: {
        'marquee': 'marquee 30s linear infinite',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      boxShadow: {
        'popup': '0 8px 24px rgba(0, 0, 0, 0.60)',
      },
    },
  },
  plugins: [],
};

export default config;
