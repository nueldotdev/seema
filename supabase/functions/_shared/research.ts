interface TavilySearchResult {
  title?: string
  url?: string
  content?: string
  score?: number
}

interface TavilyResponse {
  results?: TavilySearchResult[]
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

interface GroundedResource {
  title: string
  source_index: number
}

interface StructuredResearchResult {
  explanation: string
  resources: GroundedResource[]
  self_test: string
}

export interface ResearchResult {
  explanation: string
  resources: Array<{ title: string; url: string; source?: string }>
  self_test: string
}

export async function researchCapture(captureText: string, context: string): Promise<ResearchResult> {
  const tavilyApiKey = Deno.env.get('TAVILY_API_KEY')
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
  const model = Deno.env.get('GEMINI_MODEL')
  if (!tavilyApiKey || !geminiApiKey || !model) {
    throw new Error('TAVILY_API_KEY, GEMINI_API_KEY, and GEMINI_MODEL must be configured')
  }

  const searchResponse = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: `${captureText} educational explanation`,
      search_depth: 'basic',
      topic: 'general',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    }),
  })
  if (!searchResponse.ok) {
    throw new Error(`Tavily search failed (${searchResponse.status}): ${await searchResponse.text()}`)
  }

  const searchData = await searchResponse.json() as TavilyResponse
  const sources = (searchData.results ?? [])
    .filter((result): result is TavilySearchResult & { title: string; url: string; content: string } =>
      typeof result.title === 'string' &&
      typeof result.url === 'string' &&
      /^https?:\/\//i.test(result.url) &&
      typeof result.content === 'string' &&
      result.content.length > 0,
    )
    .slice(0, 5)
  if (sources.length === 0) throw new Error('Tavily returned no usable web sources')

  const prompt = `You are a careful study tutor. The learner's preferences are: ${context}

Explain this exact topic/question: ${captureText}

Use the web search evidence below. Return only valid JSON with:
- explanation: 3-4 clear, accurate sentences suited to the learner.
- resources: 2-3 useful sources chosen from the evidence, each with a concise title and source_index (the zero-based index of its source).
- self_test: one short question that checks understanding.

Never invent, change, or return URLs. Only choose source_index values that exist in the evidence. If fewer than two sources are useful, return only the useful sources.

Web search evidence:
${sources.map((source, index) => `[${index}] ${source.title}\nURL: ${source.url}\nSnippet: ${source.content}`).join('\n\n')}`

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  })
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${await response.text()}`)
  const payload = await response.json() as GeminiResponse
  const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')
  if (!output) throw new Error('Gemini returned no research content')

  let parsed: Partial<StructuredResearchResult>
  try {
    parsed = JSON.parse(output) as Partial<StructuredResearchResult>
  } catch {
    throw new Error('Gemini returned invalid structured JSON')
  }
  if (typeof parsed.explanation !== 'string' || typeof parsed.self_test !== 'string') {
    throw new Error('Gemini response is missing required explanation or self-test')
  }

  const resources = Array.isArray(parsed.resources)
    ? parsed.resources.flatMap((resource) => {
      if (
        !resource ||
        typeof resource.title !== 'string' ||
        !Number.isInteger(resource.source_index) ||
        resource.source_index < 0 ||
        resource.source_index >= sources.length
      ) return []
      const source = sources[resource.source_index]
      return [{ title: resource.title, url: source.url, source: source.title }]
    }).slice(0, 3)
    : []

  return { explanation: parsed.explanation, resources, self_test: parsed.self_test }
}
