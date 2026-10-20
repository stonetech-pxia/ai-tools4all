import { describe, expect, it } from "vitest";
import { freeComboTargets, freeOpenRouterModels } from "../../src/core/freeModels";
import { getProvider } from "../../src/providers";

describe("freeOpenRouterModels (strict)", () => {
  it("keeps only ':free' ids whose every price is zero", () => {
    expect(
      freeOpenRouterModels([
        { id: "meta/llama:free", pricing: { prompt: "0", completion: "0", request: "0", image: "0" } },
        { id: "meta/llama", pricing: { prompt: "0.0000002", completion: "0.0000002" } }, // paid
        { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } }, // routes to paid models
        { id: "x/zero-but-not-free", pricing: { prompt: "0", completion: "0" } }, // no ':free' suffix
        { id: "x/became-paid:free", pricing: { prompt: "0", completion: "0.000001" } }, // any non-zero price
        { id: "x/unknown-price:free", pricing: {} }, // no prices reported
        { id: "x/null-price:free", pricing: { prompt: "0", completion: null } },
      ]),
    ).toEqual(["meta/llama:free"]);
  });
});

describe("freeComboTargets", () => {
  const groq = getProvider("groq");
  const openrouter = { ...getProvider("openrouter"), freeModels: { priority: 2, openRouterCatalog: "http://catalog.test/models" } };
  const catalog = (status = 200) =>
    (async () => new Response(JSON.stringify({ data: [{ id: "a/b:free", pricing: { prompt: "0", completion: "0" } }, { id: "c/d", pricing: { prompt: "1", completion: "1" } }] }), { status })) as unknown as typeof fetch;

  it("lists Groq's curated models first, then OpenRouter's confirmed-free ones", async () => {
    const { targets, problems } = await freeComboTargets([openrouter, groq], catalog()); // input order doesn't matter
    expect(targets).toEqual(["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b", "groq/qwen/qwen3.8-27b", "groq/qwen/qwen3.6-27b", "openrouter/a/b:free"]);
    expect(problems).toEqual([]);
  });

  it("adds nothing for a provider whose free list can't be confirmed", async () => {
    const { targets, problems } = await freeComboTargets([openrouter], catalog(503));
    expect(targets).toEqual([]);
    expect(problems).toHaveLength(1);
  });
});
