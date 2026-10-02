-- Since late August 2026 Instagram refuses buttons, cards and attachments in a
-- comment private reply to someone who does not follow the account, and the
-- refused call still uses up the comment's single private reply. Comments now
-- get a plain-text reply; this table remembers what their answer should do.
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationSession_instagramAccountId_contactId_kind_autom_key"
    ON "ConversationSession"("instagramAccountId", "contactId", "kind", "automationId");
CREATE INDEX "ConversationSession_instagramAccountId_contactId_consumedAt_idx"
    ON "ConversationSession"("instagramAccountId", "contactId", "consumedAt");

ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_instagramAccountId_fkey"
    FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
