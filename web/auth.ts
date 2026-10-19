import { defineAuth } from 'void/auth';

export const mapGitHubProfileToUser = (profile: { login: string }) => ({
  displayUsername: profile.login,
  username: profile.login,
});

export default defineAuth(({ defaults }) => {
  const github = defaults.socialProviders?.github;

  return {
    ...defaults,
    account: {
      ...defaults.account,
      encryptOAuthTokens: true,
    },
    session: {
      ...defaults.session,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 60,
        strategy: 'jwe',
      },
    },
    ...(github && typeof github !== 'function'
      ? {
          socialProviders: {
            ...defaults.socialProviders,
            github: {
              ...github,
              mapProfileToUser: mapGitHubProfileToUser,
            },
          },
        }
      : {}),
    user: {
      ...defaults.user,
      additionalFields: {
        ...(defaults.user?.additionalFields ?? {}),
        displayUsername: {
          required: false,
          returned: true,
          type: 'string',
        },
        username: {
          required: false,
          returned: true,
          type: 'string',
          unique: true,
        },
      },
    },
  };
});
