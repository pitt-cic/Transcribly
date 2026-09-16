import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const passwordRequirements = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /\d/.test(p) },
];

const ForceChangePasswordPage = () => {
  const navigate = useNavigate();
  const { completeNewPasswordChallenge, isLoading, error, clearError } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setValidationError('First name and last name are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    if (!passwordRequirements.every((req) => req.test(newPassword))) {
      setValidationError('Password does not meet all requirements');
      return;
    }

    try {
      await completeNewPasswordChallenge(newPassword, {
        givenName: firstName.trim(),
        familyName: lastName.trim(),
      });
      navigate('/upload');
    } catch {
      // error surfaced via context
    }
  };

  const displayError = validationError ?? error;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-[#0A0A0B] to-bg-dark">
      <div className="w-full max-w-[480px] bg-panel-dark border border-border-gray rounded-xl p-12 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary-teal rounded-[10px] flex items-center justify-center relative">
            <div className="w-4 h-4 bg-bg-dark rounded"></div>
            <div className="w-2 h-2 bg-accent-red rounded-full absolute -top-0.5 -right-0.5 pulse-animation"></div>
          </div>
          <span className="text-xl font-bold text-text-primary">Transcribly</span>
        </div>

        <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Complete your profile</h1>
        <p className="text-sm text-text-secondary text-center mb-8">
          Please provide your name and create a new password
        </p>

        {displayError && (
          <div className="mb-4 p-3 rounded-md text-sm bg-accent-red/10 text-accent-red border border-accent-red/30">
            {displayError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">FIRST NAME</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
                <input
                  type="text"
                  className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">LAST NAME</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
                <input
                  type="text"
                  className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">NEW PASSWORD</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
              <input
                type="password"
                className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">CONFIRM PASSWORD</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
              <input
                type="password"
                className="w-full text-[13px] py-3 pl-10 pr-3.5 bg-panel-dark border border-border-gray rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-teal focus:ring-[3px] focus:ring-primary-teal/10 transition-all"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <div className="rounded-md p-4 bg-bg-dark border border-border-gray">
            <p className="text-[9px] font-semibold text-text-secondary mb-2 tracking-[1.4px]">PASSWORD REQUIREMENTS</p>
            <ul className="space-y-1">
              {passwordRequirements.map((req) => {
                const met = req.test(newPassword);
                return (
                  <li key={req.label} className={`text-[13px] flex items-center gap-2 ${met ? 'text-primary-teal' : 'text-text-muted'}`}>
                    {met ? (
                      <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="10" cy="10" r="3" />
                      </svg>
                    )}
                    {req.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 bg-primary-teal text-bg-dark text-sm font-semibold rounded-md hover:bg-[#0ea998] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Setting up...
              </>
            ) : 'Complete setup'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForceChangePasswordPage;
