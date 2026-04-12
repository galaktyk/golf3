---
description: Describe when these instructions should be loaded by the agent based on task context
# applyTo: 'Describe when these instructions should be loaded by the agent based on task context' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.

- when writing function please provide a docstring and comments for any non-obvious code sections
- encourage to re-arrange file or folder structure since this app is still in early stage and there is no established structure yet.
- dont run python or try to start the server, it already start by me, ask me if you want to test the code you generate