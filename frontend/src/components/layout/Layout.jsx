import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import { useBranding } from '../../context/BrandingContext';

const Layout = () => {
    const { settings } = useBranding();

    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200 relative overflow-hidden">
            {/* Background Gradients */}
            <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-red-600/20 blur-[120px]" />
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-blue-600/10 blur-[120px]" />
                <div className="absolute -bottom-[10%] left-[20%] w-[30%] h-[30%] rounded-full bg-orange-500/10 blur-[100px]" />
            </div>
            <Navbar />
            <main className="flex-grow container mx-auto px-4 py-8">
                <Outlet />
            </main>
            <footer className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                {settings.footerText || `© ${new Date().getFullYear()} Sendu. Secure File Sharing.`}
            </footer>
        </div>
    );
};

export default Layout;
