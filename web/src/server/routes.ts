import { handleSharingApiRequest, type SharingEnv } from '@nkzw/codiff-service/api';
import { createRequestDb } from '@nkzw/codiff-service/db';
import { defineVoidFateLiveRoute } from 'void-fate/server';
import { getRequestAuth } from './auth.ts';
import { fateServer } from './fate.ts';
import { fateLive, fateStream, live } from './live.ts';

export const handleApiRequest = (request: Request, env: SharingEnv, auth: unknown) =>
  fateLive.withContext({ env, stream: fateStream }, () =>
    handleSharingApiRequest(request, env, {
      auth: getRequestAuth(auth),
      enforceDailyQuota: true,
      onUploadIntentUpdated: ({ changed, id, walkthroughSlug }) =>
        live.update('UploadIntent', id, {
          changed,
          eventId: `upload-intent:${id}:${walkthroughSlug}`,
        }),
    }),
  );

export const handleFateRequest = async (request: Request, env: SharingEnv, auth: unknown) => {
  const database = createRequestDb(env.DB, request);
  return database.withBookmark(
    await fateLive.withContext({ env, stream: fateStream }, () =>
      fateServer.handleRequest(request, {
        auth: getRequestAuth(auth),
        db: database.db,
        env,
        request,
      }),
    ),
  );
};

export const fateLiveRoute = defineVoidFateLiveRoute(fateStream);
