-- People who commented on or messaged a connected account; lastInboundAt
-- tracks Instagram's 24-hour messaging window.
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "lastCommentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contact_instagramAccountId_igsid_key" ON "Contact"("instagramAccountId", "igsid");
CREATE INDEX "Contact_instagramAccountId_lastInboundAt_idx" ON "Contact"("instagramAccountId", "lastInboundAt");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instagramAccountId_fkey"
    FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
