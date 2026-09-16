import { useState } from 'react';
import { Mail, Lock } from 'lucide-react';
import { forgotPassword, confirmPassword } from '../services/authService';

interface ForgotPasswordProps {
  onBack: () => void;
  onSuccess: () => void;
}

const ForgotPassword = ({ onBack, onSuccess }: ForgotPasswordProps) => {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPasswordValue, setConfirmPasswordValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await forgotPassword(email);
      setStep('reset');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPasswordValue) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      await confirmPassword(email, code, newPassword);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

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

        {step === 'email' ? (
          <>
            <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Reset password</h1>
            <p className="text-sm text-text-secondary text-center mb-8">
              Enter your email and we'll send you a reset code
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-md text-sm bg-accent-red/10 text-accent-red border border-accent-red/30">
                {error}
              </div>
            )}

            <form onSubmit={handleSendCode}>
              <div className="mb-6">
                <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">
                  EMAIL
                </label>
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

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-primary-teal text-bg-dark text-sm font-semibold rounded-md hover:bg-[#0ea998] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {loading ? 'Sending...' : 'Send Reset Code'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Create new password</h1>
            <p className="text-sm text-text-secondary text-center mb-8">
              Enter the code sent to <span className="text-primary-teal">{email}</span>
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-md text-sm bg-accent-red/10 text-accent-red border border-accent-red/30">
                {error}
              </div>
            )}

            <form onSubmit={handleResetPassword}>
              <div className="mb-5">
                <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">
                  VERIFICATION CODE
                </label>
                <input
                  type="text"
                  className="w-full text-[13px] py-3 px-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all text-center tracking-widest"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  required
                />
              </div>

              <div className="mb-5">
                <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">
                  NEW PASSWORD
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
                  <input
                    type="password"
                    className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">
                  CONFIRM PASSWORD
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
                  <input
                    type="password"
                    className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                    placeholder="••••••••"
                    value={confirmPasswordValue}
                    onChange={(e) => setConfirmPasswordValue(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-primary-teal text-bg-dark text-sm font-semibold rounded-md hover:bg-[#0ea998] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          </>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={onBack}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
