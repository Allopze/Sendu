/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                primary: {
                    50: '#fef2f2',
                    100: '#fee2e2',
                    500: '#ef4444',
                    600: '#dc2626',
                    700: '#b91c1c',
                    900: '#7f1d1d',
                },
                dark: {
                    bg: '#121212',
                    surface: '#222222',
                }
            },
            animation: {
                'fade-in': 'fadeIn 0.3s ease-out',
                'bounce-in': 'bounceIn 0.3s ease-out',
                'indeterminate': 'indeterminate 1.5s ease-in-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                bounceIn: {
                    '0%': { opacity: '0', transform: 'scale(0.9)' },
                    '50%': { transform: 'scale(1.02)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                indeterminate: {
                    '0%': { transform: 'translateX(-100%)', width: '30%' },
                    '50%': { transform: 'translateX(100%)', width: '50%' },
                    '100%': { transform: 'translateX(300%)', width: '30%' },
                },
            },
        }
    },
    plugins: []
};
