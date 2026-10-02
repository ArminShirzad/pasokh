-- The test lab: a simulated Instagram account whose sends are recorded.
ALTER TYPE "InstagramProvider" ADD VALUE 'SIMULATOR';

CREATE TABLE "SimulatorEvent" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SimulatorEvent_instagramAccountId_createdAt_idx" ON "SimulatorEvent"("instagramAccountId", "createdAt");
CREATE INDEX "SimulatorEvent_commentId_idx" ON "SimulatorEvent"("commentId");
ALTER TABLE "SimulatorEvent" ADD CONSTRAINT "SimulatorEvent_instagramAccountId_fkey"
    FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SimulatorFan" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "follows" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SimulatorFan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SimulatorFan_instagramAccountId_igsid_key" ON "SimulatorFan"("instagramAccountId", "igsid");
ALTER TABLE "SimulatorFan" ADD CONSTRAINT "SimulatorFan_instagramAccountId_fkey"
    FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
