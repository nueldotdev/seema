interface GroundingChunk {
  web?: { uri?: string; title?: string }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    groundingMetadata?: { groundingChunks?: GroundingChunk[] }
  }>
}

export interface ResearchResult {
  explanation: string
  resources: Array<{ title: string; url: string; source?: string }>
  self_test: string
}

export async function researchCapture(captureText: string, context: string): Promise<ResearchResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const model = Deno.env.get('GEMINI_MODEL')
  if (!apiKey || !model) throw new Error('GEMINI_API_KEY and GEMINI_MODEL must be configured')

  const prompt = `You are a careful study tutor. The learner's preferences are: ${context}\n\nResearch this exact topic/question: ${captureText}\n\nReturn only valid JSON with keys: explanation (3-4 clear sentences), resources (2-3 items with title and source matching the supplied search evidence), self_test (one short question). Do not invent URLs or citations.`
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  })
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${await response.text()}`)
  const payload = await response.json() as GeminiResponse
  const candidate = payload.candidates?.[0]
  const output = candidate?.content?.parts?.map((part) => part.text ?? '').join('')
  if (!output) throw new Error('Gemini returned no research content')

  let parsed: Partial<ResearchResult>
  try {
    parsed = JSON.parse(output) as Partial<ResearchResult>
  } catch {
    throw new Error('Gemini returned invalid structured JSON')
  }

  const sources = (candidate.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web)
    .filter((web): web is { uri: string; title?: string } => Boolean(web?.uri && /^https?:\/\//i.test(web.uri)))
  const resources = Array.isArray(parsed.resources)
    ? parsed.resources.flatMap((resource) => {
      if (!resource || typeof resource.title !== 'string') return []
      const referenced = sources.find((source) =>
        source.uri === (resource as { url?: string }).url ||
        (source.title && source.title.toLowerCase() === resource.title!.toLowerCase()),
      )
      if (!referenced) return []
      return [{ title: resource.title, url: referenced.uri, source: referenced.title }]
    }).slice(0, 3)
    : []
  for (const source of sources) {
    if (resources.length >= 2) break
    if (!resources.some((resource) => resource.url === source.uri)) {
      resources.push({ title: source.title ?? source.uri, url: source.uri, source: source.title })
    }
  }

  if (typeof parsed.explanation !== 'string' || typeof parsed.self_test !== 'string') {
    throw new Error('Gemini response is missing required explanation or self-test')
  }
  return { explanation: parsed.explanation, resources, self_test: parsed.self_test }
}
