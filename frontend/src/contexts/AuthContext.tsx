import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react';
import {
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { getCurrentSession, getUserAttributes, signOut as authSignOut } from '../services/authService';
import { userPool } from '../config/cognito';

type LoginResult =
  | { status: 'success' }
  | { status: 'newPasswordRequired' };

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  userEmail: string | null;
  userName: string | null;
  userId: string | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  checkAuth: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
  completeNewPasswordChallenge: (
    newPassword: string,
    attributes?: { givenName?: string; familyName?: string },
  ) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [cognitoUser, setCognitoUser] = useState<CognitoUser | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const checkAuth = async () => {
    try {
      const session = await getCurrentSession();
      if (session.isValid()) {
        const attributes = await getUserAttributes();
        setUserEmail(attributes.email || null);
        setUserName(attributes.name || null);
        setUserId(attributes.sub || null);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUserEmail(null);
        setUserName(null);
        setUserId(null);
      }
    } catch {
      setIsAuthenticated(false);
      setUserEmail(null);
      setUserName(null);
      setUserId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    setError(null);

    const user = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    return new Promise((resolve, reject) => {
      user.authenticateUser(authDetails, {
        onSuccess: (_session: CognitoUserSession) => {
          setIsAuthenticated(true);
          setCognitoUser(user);
          setIsLoading(false);
          resolve({ status: 'success' });
        },
        onFailure: (err) => {
          setIsLoading(false);
          const message = err.message || 'Authentication failed';
          setError(message);
          reject(new Error(message));
        },
        newPasswordRequired: () => {
          setCognitoUser(user);
          setIsLoading(false);
          resolve({ status: 'newPasswordRequired' });
        },
      });
    });
  }, []);

  const completeNewPasswordChallenge = useCallback(
    async (
      newPassword: string,
      attributes?: { givenName?: string; familyName?: string },
    ): Promise<void> => {
      if (!cognitoUser) throw new Error('No active session');

      setIsLoading(true);
      setError(null);

      const requiredAttributes: Record<string, string> = {};
      if (attributes?.givenName) requiredAttributes.given_name = attributes.givenName;
      if (attributes?.familyName) requiredAttributes.family_name = attributes.familyName;

      return new Promise((resolve, reject) => {
        cognitoUser.completeNewPasswordChallenge(newPassword, requiredAttributes, {
          onSuccess: () => {
            setIsAuthenticated(true);
            setIsLoading(false);
            resolve();
          },
          onFailure: (err) => {
            setIsLoading(false);
            const message = err.message || 'Password change failed';
            setError(message);
            reject(new Error(message));
          },
        });
      });
    },
    [cognitoUser],
  );

  const signOut = async () => {
    await authSignOut();
    setIsAuthenticated(false);
    setUserEmail(null);
    setUserName(null);
    setUserId(null);
    setCognitoUser(null);
  };

  const getAccessToken = async (): Promise<string> => {
    const session = await getCurrentSession();
    return session.getAccessToken().getJwtToken();
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        error,
        userEmail,
        userName,
        userId,
        login,
        checkAuth,
        signOut,
        getAccessToken,
        completeNewPasswordChallenge,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
