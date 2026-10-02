-- CreateTable
CREATE TABLE "AiAssistant" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'ANTHROPIC',
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKey" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT '',
    "tone" INTEGER NOT NULL DEFAULT 2,
    "knowledge" TEXT NOT NULL DEFAULT '',
    "dailyLimitPerPerson" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAssistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReply" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAssistant_instagramAccountId_key" ON "AiAssistant"("instagramAccountId");

-- CreateIndex
CREATE INDEX "AiReply_assistantId_igsid_createdAt_idx" ON "AiReply"("assistantId", "igsid", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiReply_assistantId_triggerId_key" ON "AiReply"("assistantId", "triggerId");

-- AddForeignKey
ALTER TABLE "AiAssistant" ADD CONSTRAINT "AiAssistant_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReply" ADD CONSTRAINT "AiReply_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "AiAssistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

