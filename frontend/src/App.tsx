import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import AuthPage from './pages/AuthPage';
import ForceChangePasswordPage from './pages/ForceChangePasswordPage';
import UploadPage from './pages/UploadPage';
import TranscriptPage from './pages/TranscriptPage';
import TranscriptListPage from './pages/TranscriptListPage';
import { AudioPlayerProvider } from './hooks/useAudioPlayer';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <AudioPlayerProvider>
        <div className="app">
          <Navbar />
          <Routes>
            <Route path="/" element={<AuthPage />} />
            <Route path="/force-change-password" element={<ForceChangePasswordPage />} />
            <Route
              path="/upload"
              element={
                <ProtectedRoute>
                  <UploadPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transcripts"
              element={
                <ProtectedRoute>
                  <TranscriptListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transcripts/:jobId"
              element={
                <ProtectedRoute>
                  <TranscriptPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </AudioPlayerProvider>
    </AuthProvider>
  );
}

export default App;
