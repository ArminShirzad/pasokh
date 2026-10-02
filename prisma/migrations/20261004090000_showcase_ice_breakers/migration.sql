-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "iceBreakersError" TEXT,
ADD COLUMN     "iceBreakersSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Showcase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Showcase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IceBreaker" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,

    CONSTRAINT "IceBreaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Showcase_instagramAccountId_idx" ON "Showcase"("instagramAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "IceBreaker_instagramAccountId_position_key" ON "IceBreaker"("instagramAccountId", "position");

-- AddForeignKey
ALTER TABLE "Showcase" ADD CONSTRAINT "Showcase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showcase" ADD CONSTRAINT "Showcase_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IceBreaker" ADD CONSTRAINT "IceBreaker_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IceBreaker" ADD CONSTRAINT "IceBreaker_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

