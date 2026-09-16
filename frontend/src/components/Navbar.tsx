import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Upload, FileText, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, userEmail, userName, signOut } = useAuth();
  const isAuthPage = location.pathname === '/';
  const [showConfirm, setShowConfirm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showConfirm) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showConfirm]);

  if (isAuthPage || !isAuthenticated) return null;

  const handleConfirmSignOut = async () => {
    setShowConfirm(false);
    await signOut();
    navigate('/');
  };

  return (
    <nav className="bg-bg-dark border-b border-border-gray sticky top-0 z-50 h-14">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Logo - Left Aligned */}
        <Link to="/transcripts" className="flex items-center gap-2.5 no-underline text-text-primary">
          <div className="w-7 h-7 bg-primary-teal rounded-[7px] flex items-center justify-center relative">
            <div className="w-3 h-3 bg-bg-dark rounded-[3px]"></div>
            <div className="w-[7px] h-[7px] bg-accent-red rounded-full absolute -top-0.5 -right-0.5 pulse-animation"></div>
          </div>
          <span className="text-[15px] font-bold">Transcribly</span>
        </Link>

        {/* Right Side: Navigation Links + Actions */}
        <div className="flex items-center gap-3">
          {/* Navigation Links */}
          <Link
            to="/upload"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-all ${
              location.pathname === '/upload'
                ? 'bg-primary-teal/12 text-primary-teal border border-primary-teal'
                : 'text-text-secondary hover:bg-panel-dark hover:text-text-primary'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload
          </Link>
          <Link
            to="/transcripts"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-all ${
              location.pathname === '/transcripts'
                ? 'bg-primary-teal/12 text-primary-teal border border-primary-teal'
                : 'text-text-secondary hover:bg-panel-dark hover:text-text-primary'
            }`}
          >
            <FileText className="w-4 h-4" />
            My Transcripts
          </Link>

          {/* Divider */}
          <div className="w-px h-6 bg-border-gray"></div>

          {/* User dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowConfirm((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-text-secondary text-xs transition-colors hover:text-text-primary hover:bg-panel-dark"
            >
              <span>{userName || userEmail}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${showConfirm ? 'rotate-180' : ''}`} />
            </button>

            {showConfirm && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-panel-dark border border-border-gray rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden">
                <p className="text-[11px] text-text-secondary px-4 pt-3 pb-2">
                  Sign out of Transcribly?
                </p>
                <div className="px-3 pb-3">
                  <button
                    onClick={handleConfirmSignOut}
                    className="w-full py-1.5 bg-accent-red/10 text-accent-red border border-accent-red/30 rounded-md text-xs font-semibold hover:bg-accent-red/20 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
