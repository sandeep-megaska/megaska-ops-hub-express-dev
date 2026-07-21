import {
  generateSessionToken,
  hashSessionToken,
} from "./session.ts";

type SessionRecord = {
  id: string;
  customerProfileId: string;
  expiresAt: Date;
};

type SessionTransaction = {
  authSession: {
    findFirst(args: unknown): Promise<{ id: string; customerProfileId: string } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<SessionRecord>;
  };
};

type SessionDatabase = SessionTransaction & {
  $transaction<T>(callback: (tx: SessionTransaction) => Promise<T>): Promise<T>;
};

type ReplacementDependencies = {
  generateToken: () => string;
  hashToken: (token: string) => string;
  now: () => Date;
};

const defaults: ReplacementDependencies = {
  generateToken: generateSessionToken,
  hashToken: hashSessionToken,
  now: () => new Date(),
};

/** Replaces only the session presented by this browser; other devices stay signed in. */
export async function replaceCustomerSessionAfterOtp(
  input: { customerProfileId: string; previousSessionToken?: string | null },
  db: SessionDatabase,
  dependencies: ReplacementDependencies = defaults,
) {
  const now = dependencies.now();
  const sessionToken = dependencies.generateToken();
  const sessionTokenHash = dependencies.hashToken(sessionToken);
  const previousSessionTokenHash = input.previousSessionToken
    ? dependencies.hashToken(input.previousSessionToken)
    : null;
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return db.$transaction(async (tx) => {
    const previousSession = previousSessionTokenHash
      ? await tx.authSession.findFirst({
          where: { sessionTokenHash: previousSessionTokenHash, revokedAt: null },
          select: { id: true, customerProfileId: true },
        })
      : null;

    if (previousSessionTokenHash) {
      await tx.authSession.updateMany({
        where: { sessionTokenHash: previousSessionTokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    const session = await tx.authSession.create({
      data: {
        customerProfileId: input.customerProfileId,
        sessionTokenHash,
        expiresAt,
        lastSeenAt: now,
      },
    });

    return { sessionToken, session, previousSession };
  });
}
