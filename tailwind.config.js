/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        resource: {
          primary: '#FFCF00',
          pink: '#f91155',
          bg: '#f2f5f9',
          text: '#2b2b2b',
          border: '#e0e5ed',
        }
      }
    },
  },
  plugins: [],
}
