# Changelog

## 0.1.0 (2026-10-09)

First version. Source only, not installed in an Attio workspace yet.

- Three record actions: "Enrich company with looot" on companies, "Find work email" and "Verify email" on people.
- Every action reads the record, shows the price from the public looot catalog and asks to confirm before it runs.
- Results are written to the record: the email to `email_addresses`, the verification result to `looot_email_status`, industry and size to `looot_industry` and `looot_company_size`.
- The looot token is a workspace connection secret read with `getWorkspaceConnection()`.
- 55 tests with looot and Attio's REST API replaced by stand-ins.
