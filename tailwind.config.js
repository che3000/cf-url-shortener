/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    // 響應式類別
    'sm:grid-cols-2', 'md:grid-cols-4', 'sm:col-span-2', 'md:col-span-4',
    'sm:flex-row', 'sm:items-center',
    'sm:inline', 'sm:ml-3', 'sm:mt-0',
    'sm:w-auto', 'sm:w-24', 'sm:w-28', 'sm:w-32', 'sm:w-40',
    'sm:max-w-[200px]', 'md:max-w-[300px]',
    'sm:gap-4', 'sm:p-5', 'sm:px-0', 'sm:px-2', 'sm:px-3', 'sm:py-2',
    'sm:text-sm', 'sm:mx-0',
    'md:table-cell', 'lg:table-cell', 'xl:table-cell',
    // 隱藏類別
    'hidden',
    // 寬度和最大寬度
    'max-w-[100px]', 'max-w-[120px]', 'max-w-[200px]', 'max-w-[300px]',
    // 其他常用類別
    'text-xs', 'text-sm', 'truncate', 'break-all', 'block',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
