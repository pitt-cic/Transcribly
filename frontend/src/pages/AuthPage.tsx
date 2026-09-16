import { useState } from 'react';
import { Mail, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ForgotPassword from '../components/ForgotPassword';

const AuthPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const { login, isLoading, error, clearError } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      const result = await login(email, password);
      if (result.status === 'newPasswordRequired') {
        navigate('/force-change-password');
      } else {
        navigate('/upload');
      }
    } catch {
      // error surfaced via context
    }
  };

  const handleForgotPasswordSuccess = () => {
    setShowForgotPassword(false);
  };

  if (showForgotPassword) {
    return (
      <ForgotPassword
        onBack={() => setShowForgotPassword(false)}
        onSuccess={handleForgotPasswordSuccess}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-[#0A0A0B] to-bg-dark">
      <div className="w-full max-w-[420px] bg-panel-dark border border-border-gray rounded-xl p-12 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 bg-primary-teal rounded-[10px] flex items-center justify-center relative">
            <div className="w-4 h-4 bg-bg-dark rounded"></div>
            <div className="w-2 h-2 bg-accent-red rounded-full absolute -top-0.5 -right-0.5 pulse-animation"></div>
          </div>
          <span className="text-xl font-bold text-text-primary">Transcribly</span>
        </div>

        <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Welcome back</h1>
        <p className="text-sm text-text-secondary text-center mb-8">Sign in to continue transcribing</p>

        {error && (
          <div className="mb-4 p-3 rounded-md text-sm bg-accent-red/10 text-accent-red border border-accent-red/30">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">EMAIL</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
              <input
                type="email"
                className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">PASSWORD</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
              <input
                type="password"
                className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="text-xs text-primary-teal float-right -mt-3 mb-6 hover:underline"
          >
            Forgot password?
          </button>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 bg-primary-teal text-bg-dark text-sm font-semibold rounded-md hover:bg-[#0ea998] transition-all hover:-translate-y-0.5 mt-2 disabled:opacity-50 disabled:cursor-not-allowed clear-both"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuthPage;
