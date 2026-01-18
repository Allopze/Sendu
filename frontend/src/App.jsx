import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { BrandingProvider } from './context/BrandingContext';
import { ToastProvider } from './context/ToastContext';
import { UploadProvider } from './context/UploadContext';
import Layout from './components/layout/Layout';
import { ProtectedRoute, AdminRoute, GuestRoute } from './components/auth/ProtectedRoute';
import UploadProgressToast from './components/ui/UploadProgressToast';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import DownloadPage from './pages/DownloadPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';


function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrandingProvider>
          <ToastProvider>
            <BrowserRouter>
              <UploadProvider>
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
