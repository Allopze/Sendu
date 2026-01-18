import { useTheme } from '../../context/ThemeContext';

const BoxIcon = ({ size = 80, animated = false, success = false }) => {
  const { isDark } = useTheme();
  
  if (success) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className={animated ? 'animate-float' : ''}>
        <path 
          d="M50 10 L85 30 V70 L50 90 L15 70 V30 L50 10Z" 
          fill={isDark ? "#121212" : "#ffffff"} 
          stroke={isDark ? "#333" : "#ddd"} 
          strokeWidth="2"
        />
        <path 
          d="M50 10 L50 50 M50 50 L85 30 M50 50 L15 30" 
          stroke={isDark ? "#333" : "#ddd"} 
          strokeWidth="2"
        />
        <path 
          d="M35 45 L48 58 L68 35" 
          stroke="#DC2626" 
          strokeWidth="4" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={animated ? 'animate-breathe' : ''}>
      <path 
        d="M50 5 L93.3 30 V80 L50 105 L6.7 80 V30 L50 5Z" 
        stroke={isDark ? "#333" : "#ddd"} 
        strokeWidth="2" 
        strokeLinejoin="round"
      />
      <path 
        d="M50 5 L50 55 M50 55 L93.3 30 M50 55 L6.7 30" 
        stroke={isDark ? "#333" : "#ddd"} 
        strokeWidth="2" 
        strokeLinejoin="round"
      />
      <path 
        d="M50 55 L93.3 30 V80 L50 105 V55Z" 
        fill="#DC2626" 
        fillOpacity="0.8" 
        className="transition-all duration-300"
      />
      <path 
        d="M50 5 L93.3 30 L50 55 L6.7 30 L50 5Z" 
        fill={isDark ? "#333" : "#fff"} 
        fillOpacity="0.1"
      />
    </svg>
  );
};

export default BoxIcon;
