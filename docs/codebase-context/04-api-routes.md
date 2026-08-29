# API 接口汇总

## Provider API adapters

| 模块 | 职责 | 定义位置 |
| ---- | ---- | ---- |
| Anthropic messages | Anthropic message request/stream adapter | `packages/ai/src/api/anthropic-messages.ts`, `.lazy.ts` |
| OpenAI responses/completions | OpenAI-compatible response and completion adapters | `packages/ai/src/api/openai-responses.ts`, `openai-completions.ts`, shared helpers |
| OpenAI Codex responses | Codex-specific OpenAI response adapter | `packages/ai/src/api/openai-codex-responses.ts` |
| Azure OpenAI responses | Azure-specific response adapter | `packages/ai/src/api/azure-openai-responses.ts` |
| Google Generative AI / Vertex | Google model adapters | `packages/ai/src/api/google-generative-ai.ts`, `google-vertex.ts`, `google-shared.ts` |
| Bedrock Converse stream | AWS Bedrock stream adapter | `packages/ai/src/api/bedrock-converse-stream.ts` |
| Mistral conversations | Mistral conversation adapter | `packages/ai/src/api/mistral-conversations.ts` |
| OpenRouter images | Image adapter path | `packages/ai/src/api/openrouter-images.ts` |
| Message transforms | Internal/external message mapping | `packages/ai/src/api/transform-messages.ts`, `simple-options.ts` |

## Protocol/server API surface

| 模块 | 职责 | 定义位置 |
| ---- | ---- | ---- |
| Schemas | Protocol message schemas and types | `packages/protocol/src/schemas.ts` |
| Codec/framing | Wire encoding and frame parsing | `packages/protocol/src/codec.ts`, `framing.ts`, `cbor/**` |
| Server sessions | Session lifecycle and snapshots | `packages/server/src/sessions.ts`, `snapshots.ts` |
| Listener/server | Connection accept/listen loop | `packages/server/src/listener.ts`, `server.ts`, `connection.ts` |
| Client | Protocol client | `packages/client/src/**` |

HTTP route table is not applicable: this repository primarily exposes CLI, RPC/session protocol, and provider adapter APIs rather than an app HTTP router.
