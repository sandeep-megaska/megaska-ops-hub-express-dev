-- Contact-form submissions from the public marketing website (loopdesk-website).
-- Stored in the shared app database under a clearly-identifiable, website-scoped
-- table name; this is website enquiry data, not app/merchant data, and has no
-- relation to Shop.
CREATE TABLE "WebsiteContactSubmission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "shopDomain" TEXT,
    "enquiryType" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "sourceIpHash" TEXT,
    "userAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',

    CONSTRAINT "WebsiteContactSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteContactSubmission_createdAt_idx" ON "WebsiteContactSubmission"("createdAt");

-- CreateIndex
CREATE INDEX "WebsiteContactSubmission_status_idx" ON "WebsiteContactSubmission"("status");
