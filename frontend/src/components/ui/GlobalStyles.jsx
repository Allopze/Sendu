import { useTheme } from '../../context/ThemeContext';

const GlobalStyles = () => {
  const { isDark } = useTheme();
  
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

      body {
        font-family: 'Inter', sans-serif;
        overflow-x: hidden;
        transition: background-color 0.4s ease, color 0.4s ease;
      }

      /* FONDO DIAGONAL SUTIL - IDENTIDAD DE MARCA */
      .bg-pattern {
        background-color: ${isDark ? '#222222' : '#f8f9fa'};
        background-image: repeating-linear-gradient(
          45deg,
          ${isDark ? '#1e1e1e' : '#f1f2f4'} 0px,
          ${isDark ? '#1e1e1e' : '#f1f2f4'} 1px,
          transparent 1px,
          transparent 24px
        );
        background-size: 34px 34px;
      }

      /* GLASSMORPHISM TÉCNICO */
      .glass-panel {
        background: ${isDark ? 'rgba(18, 18, 18, 0.85)' : 'rgba(255, 255, 255, 0.85)'};
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.6)'};
        box-shadow: ${isDark ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 20px 40px -12px rgba(0, 0, 0, 0.05)'};
      }

      /* ANIMACIONES */
      @keyframes breathe {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.03); }
      }
      .animate-breathe {
        animation: breathe 4s ease-in-out infinite;
      }

      @keyframes slideUpFade {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .animate-enter {
        animation: slideUpFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-5px); }
      }
      .animate-float {
        animation: float 6s ease-in-out infinite;
      }
      
      /* SCROLLBAR PERSONALIZADO */
      ::-webkit-scrollbar {
        width: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: ${isDark ? '#333' : '#ddd'};
        border-radius: 10px;
      }

      /* BARRA DE PROGRESO INDETERMINADA */
      @keyframes indeterminate {
        0% {
          transform: translateX(-100%);
          width: 50%;
        }
        50% {
          width: 30%;
        }
        100% {
          transform: translateX(400%);
          width: 50%;
        }
      }
      .animate-indeterminate {
        animation: indeterminate 1.5s ease-in-out infinite;
      }
    `}</style>
  );
};

export default GlobalStyles;
