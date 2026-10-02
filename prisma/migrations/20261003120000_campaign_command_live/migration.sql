-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "commandId" TEXT,
ADD COLUMN     "matchLive" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command"("id") ON DELETE SET NULL ON UPDATE CASCADE;
