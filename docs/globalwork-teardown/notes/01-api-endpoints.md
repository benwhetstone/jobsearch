# GlobalWork.ai — API endpoint inventory
Source: static extraction from /v2/assets/index-BPiZ4L5P.js (Vite bundle, 2,637,648 bytes)

Base: https://rjf-gateway-prod.globalwork.ai/api/v1   (globalwork.ai/api/v1 returns 404 for these paths)

## Auth
/api/v1/auth/login
/api/v1/auth/refresh
/api/v1/auth/password/forgot

## DCP (Data Collection Profile)
/api/v1/user/dcp
/api/v1/user/dcp/blocks/{blockName}/fields
/api/v1/user/dcp/completion

## User / profile
/api/v1/user-profile
/api/v1/user-profile/password
/api/v1/user/interaction-state
/api/v1/user/interaction-state/{interactionKey}
/api/v1/user/notification/unread/count
/api/v1/user/notification/unread/read

## CV
/api/v1/cv
/api/v1/cv/default
/api/v1/cv/{uuid}
/api/v1/cv/{uuid}/default
/api/v1/cv/{uuid}/processing
/api/v1/cv/{uuid}/download-pdf
/api/v1/cv/process/v2
/api/v1/cv/phrases/ai
/api/v1/cv/text/ai
/api/v1/cv/{uuid}/professional-summary/ai

## Cover letter
/api/v1/cover-letter/{uuid}

## Taxonomy (controlled vocabularies)
/api/v1/taxonomy/titles
/api/v1/taxonomy/skills
/api/v1/taxonomy/industries

## Jobs
/api/v1/jobs/recommended/v2
/api/v1/jobs/{uuid}
/api/v1/jobs/type/{uuid}
/api/v1/public/company/{uuid}
/api/v1/salary-stats/chart

## Auto-apply
/api/v1/auto-apply/applications
/api/v1/auto-apply/applications/summary
/api/v1/auto-apply/applications/approve
/api/v1/auto-apply/applications/{applicationUuid}/details
/api/v1/auto-apply/applications/{applicationUuid}/job-forms
/api/v1/auto-apply/applications/{applicationUuid}/approve
/api/v1/auto-apply/application-funnel
/api/v1/auto-apply/activity-tracker
/api/v1/auto-apply/quota/monthly-applications

## Email / inbox
/api/v1/email/accounts
/api/v1/email/messages
/api/v1/email/messages/summary
/api/v1/email/messages/{messageId}
/api/v1/email/messages/{messageId}/read
/api/v1/email/messages/{messageId}/reply
/api/v1/email/threads/{threadId}

## Billing
/api/v1/products/pricing
/api/v1/subscriptions/product
/api/v1/subscriptions/suspend
