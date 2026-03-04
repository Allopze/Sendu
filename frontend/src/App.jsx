import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';
import { ToastProvider } from './context/ToastContext';
import { UploadProvider } from './context/UploadContext';
import Layout from './components/layout/Layout';
import { ProtectedRoute, AdminRoute, GuestRoute } from './components/auth/ProtectedRoute';
import UploadProgressToast from './components/ui/UploadProgressToast';
import { Loader2 } from 'lucide-react';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const DownloadPage = lazy(() => import('./pages/DownloadPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));

const RouteLoader = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
  </div>
);


function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrandingProvider>
          <ToastProvider>
            <BrowserRouter>
              <UploadProvider>
                <Suspense fallback={<RouteLoader />}>
                  <Routes>
                    <Route path="/" element={<Layout />}>
                      <Route index element={<HomePage />} />
                      <Route path="login" element={<GuestRoute><LoginPage /></GuestRoute>} />
                      <Route path="register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
                      <Route path="forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
                      <Route path="reset-password" element={<ResetPasswordPage />} />
                      <Route path="verify" element={<VerifyEmailPage />} />
                      <Route path="dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
                      <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
                      <Route path="share/:id" element={<DownloadPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                  </Routes>
                </Suspense>
                <UploadProgressToast />
              </UploadProvider>
            </BrowserRouter>
          </ToastProvider>
        </BrandingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
