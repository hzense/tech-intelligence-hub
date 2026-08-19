# ADR 0005 — AI provider abstraction

Status: Accepted.

HZense may start with OpenAI, but generation, embedding, classification and entity extraction must sit behind provider interfaces. Business logic must not depend directly on one model vendor.
