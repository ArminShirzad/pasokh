-- Smart reply commands and their per-trigger runs.
CREATE TABLE "Command" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "matchMode" TEXT NOT NULL DEFAULT 'EXACT',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storyScope" TEXT NOT NULL DEFAULT 'ALL',
    "storyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onStoryMention" BOOLEAN NOT NULL DEFAULT false,
    "likeTrigger" BOOLEAN NOT NULL DEFAULT false,
    "responses" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Command_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Command_instagramAccountId_isActive_idx" ON "Command"("instagramAccountId", "isActive");
ALTER TABLE "Command" ADD CONSTRAINT "Command_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Command" ADD CONSTRAINT "Command_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommandRun" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "contactIgsid" TEXT NOT NULL,
    "triggerMessageId" TEXT NOT NULL,
    "triggerText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "sent" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommandRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommandRun_commandId_triggerMessageId_key" ON "CommandRun"("commandId", "triggerMessageId");
CREATE INDEX "CommandRun_commandId_createdAt_idx" ON "CommandRun"("commandId", "createdAt");
ALTER TABLE "CommandRun" ADD CONSTRAINT "CommandRun_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command"("id") ON DELETE CASCADE ON UPDATE CASCADE;
