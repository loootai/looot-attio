# App Store listing text

Draft text for the Developer console, written to Attio's listing rules
(https://docs.attio.com/share/app-listings, read 2026-10-09): each section is between 100 and 3,000
characters, the tagline is sentence case, and "records", "objects", "lists" and "people" are lower
case. Nothing here was submitted.

- App name: `looot` (the service's exact name; the name must not contain "Attio")
- Tagline: Find work emails, verify them and enrich companies from any record
- Website URL: https://looot.ai
- Documentation URL: https://github.com/loootai/looot-attio
- Terms of service: https://looot.ai/terms
- Contact email: support@looot.ai

## Overview

looot gives your workspace one key and one prepaid balance for 2,500+ data endpoints from 90+
providers. This app uses three of them on your people and companies records: it finds a person's
work email, checks whether an email address can receive mail, and fills in a company's industry
and size. You pay per lookup from your looot balance. There is no subscription, and a lookup that
fails costs nothing.

## How it works

Open a person or a company, press Cmd+K or the record's action menu, and pick one of the looot
actions.

- Find work email reads the person's name, their company's domain and their LinkedIn URL, then adds
  the email it finds to the person's email addresses.
- Verify email checks the person's first email address and saves the result in the "Email status
  (looot)" attribute.
- Enrich company with looot sends the company's domain and name and fills the "Industry (looot)" and
  "Company size (looot)" attributes. It never overwrites a value that is already there.

Before anything runs, the action shows the current price of the lookup and asks you to confirm.
If the first provider finds nothing, looot tries the next one, and one lookup never costs more
than $0.05.

## Configure

1. Create a looot account at https://looot.ai and add credit (from $5).
2. In the looot dashboard open Settings, Agent tokens, and create a token with `catalog.read`,
   `runs.read`, `runs.execute` and `usage.read`.
3. Install the app in Attio. A workspace admin pastes the token when Attio asks for the looot
   connection. The token is stored by Attio as a workspace connection secret.
4. Open any person or company and run a looot action from Cmd+K.
