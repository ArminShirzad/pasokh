-- Password sign-in: self-hosters should not need an SMTP server just to log in.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
