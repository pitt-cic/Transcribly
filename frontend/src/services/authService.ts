import {
  CognitoUser,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { userPool } from '../config/cognito';

export interface AuthError {
  message: string;
  code?: string;
}

/**
 * Sign out the current user
 */
export const signOut = (): Promise<void> => {
  return new Promise((resolve) => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    resolve();
  });
};

/**
 * Get the current authenticated user session
 */
export const getCurrentSession = (): Promise<CognitoUserSession> => {
  const cognitoUser = userPool.getCurrentUser();

  if (!cognitoUser) {
    return Promise.reject({
      message: 'No user found',
      code: 'NoUserFound',
    } as AuthError);
  }

  return new Promise((resolve, reject) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) {
        reject({
          message: err.message || 'Failed to get session',
        } as AuthError);
        return;
      }
      if (session && session.isValid()) {
        resolve(session);
      } else {
        reject({
          message: 'Session is invalid',
          code: 'InvalidSession',
        } as AuthError);
      }
    });
  });
};

/**
 * Get current user attributes
 */
export const getUserAttributes = (): Promise<Record<string, string>> => {
  const cognitoUser = userPool.getCurrentUser();

  if (!cognitoUser) {
    return Promise.reject({
      message: 'No user found',
      code: 'NoUserFound',
    } as AuthError);
  }

  return new Promise((resolve, reject) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        reject({
          message: 'Failed to get session',
        } as AuthError);
        return;
      }

      cognitoUser.getUserAttributes((err, attributes) => {
        if (err) {
          reject({
            message: err.message || 'Failed to get user attributes',
          } as AuthError);
          return;
        }

        const attributesMap: Record<string, string> = {};
        attributes?.forEach((attr) => {
          attributesMap[attr.Name] = attr.Value;
        });

        resolve(attributesMap);
      });
    });
  });
};

/**
 * Initiate forgot password flow
 */
export const forgotPassword = (email: string): Promise<void> => {
  const userData = {
    Username: email,
    Pool: userPool,
  };

  const cognitoUser = new CognitoUser(userData);

  return new Promise((resolve, reject) => {
    cognitoUser.forgotPassword({
      onSuccess: () => {
        resolve();
      },
      onFailure: (err) => {
        reject({
          message: err.message || 'Failed to initiate password reset',
          code: (err as any).code,
        } as AuthError);
      },
    });
  });
};

/**
 * Confirm forgot password with verification code
 */
export const confirmPassword = (
  email: string,
  code: string,
  newPassword: string
): Promise<string> => {
  const userData = {
    Username: email,
    Pool: userPool,
  };

  const cognitoUser = new CognitoUser(userData);

  return new Promise((resolve, reject) => {
    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess: () => {
        resolve('SUCCESS');
      },
      onFailure: (err) => {
        reject({
          message: err.message || 'Failed to reset password',
          code: (err as any).code,
        } as AuthError);
      },
    });
  });
};
