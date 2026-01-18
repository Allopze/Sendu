import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import { useBranding } from '../../context/BrandingContext';
import { useTheme } from '../../context/ThemeContext';
import GlobalStyles from '../ui/GlobalStyles';

const Layout = () => {
    const { settings } = useBranding();
    const { isDark } = useTheme();
    const location = useLocation();

    const panelPresets = {
        small: {
            container: 'max-w-[520px] min-h-[520px]',
            inner: ''
        },
        home: {
            container: 'max-w-[620px] h-[70vh] min-h-[500px]',
            inner: ''
        },
        large: {
            container: 'max-w-[1600px] w-[98vw] h-[85vh] min-h-[550px]',
            inner: 'overflow-hidden'
        }
    };

    // Pages that use the small centered glass panel
    const smallPanelPages = ['/login', '/register', '/forgot-password', '/reset-password', '/verify'];
    const isDownloadPage = location.pathname.startsWith('/share/');
    const isSmallPanel = smallPanelPages.includes(location.pathname) || isDownloadPage;
    
    // Pages that use the large centered glass panel
    const largePanelPages = ['/dashboard', '/admin'];
    const isLargePanel = largePanelPages.includes(location.pathname);
    
    // Home page uses medium panel
    const isHomePage = location.pathname === '/';

    const renderPanel = (variant) => {
        const preset = panelPresets[variant];
        return (
            <div className={`glass-panel w-full ${preset.container} rounded-[32px] p-1 transition-all duration-500 ease-out animate-enter`}>
                <div className={`h-full w-full rounded-[28px] p-6 sm:p-8 flex flex-col ${preset.inner}`}>
                    <Outlet />
                </div>
            </div>
        );
    };

    return (
        <div className={`h-screen w-full bg-pattern relative transition-colors duration-500 overflow-hidden ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            <GlobalStyles />
            
            {/* Navbar */}
            <Navbar />

            {/* Main Content */}
            <main className="flex items-center justify-center h-[calc(100vh-100px)] -mt-8 px-4 sm:px-6 lg:px-8">
                {isSmallPanel
                    ? renderPanel('small')
                    : isLargePanel
                        ? renderPanel('large')
                        : isHomePage
                            ? renderPanel('home')
                            : <Outlet />
                }
            </main>

            {/* Footer */}
            <footer className={`absolute bottom-0 left-0 right-0 py-8 text-center text-xs font-medium tracking-wide ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                {settings.footerText || `© ${new Date().getFullYear()} Sendu — Secure File Sharing`}
            </footer>
        </div>
    );
};

export default Layout;
